// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/10/2026) WEB PUSH cho điện thoại — để nhận cuộc gọi từ P4 khi Chrome đã đóng tab.
//
// Thiết kế:
//   - VAPID key sinh 1 lần, lưu /data/rwv-push.json (cùng thư mục với dữ liệu add-on).
//   - Điện thoại mở call-web.html → bấm "Bật chuông" → subscribe → POST /push/subscribe.
//   - Subscription được coi là MỘT THIẾT BỊ GỌI ĐƯỢC (thường trú), hiện trong danh sách liên hệ của P4
//     ngay cả khi tab đã đóng. Khi P4 gọi, server gửi push; người dùng bấm thông báo để mở cuộc gọi
//     (KHÔNG tự nhấc máy) hoặc bỏ qua (coi như nhỡ).
//   - Không dùng FCM trực tiếp: dùng Web Push chuẩn (Chrome Android nhận qua Play Services).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import webpush from 'web-push';

export interface PushSub {
  id: string;
  name: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  at: number;
}

interface PushFile {
  publicKey: string;
  privateKey: string;
  subs: PushSub[];
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const FILE = process.env.PUSH_FILE || path.join(DATA_DIR, 'rwv-push.json');

function newKeys(): { publicKey: string; privateKey: string } {
  const k = webpush.generateVAPIDKeys();
  return { publicKey: k.publicKey, privateKey: k.privateKey };
}

function load(): PushFile {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<PushFile>;
    if (raw.publicKey && raw.privateKey) {
      return { publicKey: raw.publicKey, privateKey: raw.privateKey, subs: Array.isArray(raw.subs) ? raw.subs : [] };
    }
  } catch { /* chưa có file */ }
  const keys = newKeys();
  const data: PushFile = { ...keys, subs: [] };
  save(data);
  return data;
}

function save(d: PushFile): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(d, null, 1));
  } catch (e) {
    console.warn('[push] khong ghi duoc file:', (e as Error).message);
  }
}

let data: PushFile | null = null;
function db(): PushFile {
  data ??= load();
  return data;
}

/** Cấu hình web-push (gọi 1 lần khi khởi động). */
export function initPush(): string {
  const d = db();
  webpush.setVapidDetails('mailto:dashboard-os@localhost', d.publicKey, d.privateKey);
  console.log(`[push] san sang, ${d.subs.length} thiet bi da dang ky`);
  return d.publicKey;
}

export function vapidPublicKey(): string {
  return db().publicKey;
}

export function listSubs(): PushSub[] {
  return db().subs;
}

/** Đăng ký (hoặc cập nhật theo endpoint). `name` để hiện trong danh sách gọi của P4. */
export function subscribe(body: { name?: unknown; endpoint?: unknown; keys?: unknown }): PushSub | null {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  if (!/^https:\/\//.test(endpoint) || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  const d = db();
  const name = (typeof body.name === 'string' ? body.name : '').slice(0, 40) || 'Điện thoại';
  const old = d.subs.find((s) => s.endpoint === endpoint);
  if (old) {
    old.name = name; old.keys = { p256dh: keys.p256dh, auth: keys.auth }; old.at = Date.now();
  } else {
    d.subs.push({ id: 'phone-' + crypto.randomBytes(4).toString('hex'), name, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, at: Date.now() });
  }
  save(d);
  console.log(`[push] dang ky "${name}" (${d.subs.length} thiet bi)`);
  return d.subs.find((s) => s.endpoint === endpoint) ?? null;
}

export function unsubscribe(endpoint: string): boolean {
  const d = db();
  const n = d.subs.length;
  d.subs = d.subs.filter((s) => s.endpoint !== endpoint);
  if (d.subs.length !== n) { save(d); return true; }
  return false;
}

function dropSub(endpoint: string): void {
  unsubscribe(endpoint);
}

/** Gửi 1 thông báo push tới mọi thiết bị (hoặc 1 thiết bị theo endpoint). */
export async function pushToAll(payload: Record<string, unknown>, only?: string): Promise<number> {
  const d = db();
  const targets = only ? d.subs.filter((s) => s.endpoint === only) : d.subs;
  let ok = 0;
  for (const s of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        JSON.stringify(payload),
        { TTL: 60, urgency: 'high' },
      );
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dropSub(s.endpoint);   // subscription đã chết
      else console.warn(`[push] ${s.name}: gui loi ${code ?? ''} ${(e as Error).message}`.trim());
    }
  }
  return ok;
}

/** Cuộc gọi đang đổ chuông tới điện thoại (để hiện trong danh sách/trạng thái). */
export function ringPhone(call: { id: string; from: string; fromName?: string }): Promise<number> {
  return pushToAll({
    kind: 'call',
    call: call.id,
    from: call.from,
    title: 'Cuộc gọi đến',
    body: `${call.fromName || call.from} đang gọi`,
    // chỉ chuông + thông báo, KHÔNG tự nhấc máy
    requireInteraction: true,
    tag: 'rwv-call-' + call.id,
  });
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** API push. Trả true nếu đã xử lý. */
export function handlePushApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/push/')) return false;
  if (p === '/push/key' && req.method === 'GET') {
    json(res, 200, { ok: true, key: vapidPublicKey() });
    return true;
  }
  if (p === '/push/devices' && req.method === 'GET') {
    json(res, 200, { ok: true, devices: listSubs().map((s) => ({ id: s.id, name: s.name, at: s.at })) });
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return true; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
  req.on('end', () => {
    let b: Record<string, unknown> = {};
    try { b = JSON.parse(body || '{}'); } catch { json(res, 400, { ok: false, error: 'JSON' }); return; }
    if (p === '/push/subscribe') {
      const sub = subscribe(b);
      json(res, sub ? 200 : 400, sub ? { ok: true, device: { id: sub.id, name: sub.name } } : { ok: false, error: 'subscription không hợp lệ' });
      return;
    }
    if (p === '/push/unsubscribe') {
      json(res, 200, { ok: unsubscribe(String(b.endpoint ?? '')) });
      return;
    }
    if (p === '/push/test') {
      ringPhone({ id: 'test', from: 'test', fromName: 'Thử chuông' })
        .then((n) => json(res, 200, { ok: n > 0, sent: n }))
        .catch(() => json(res, 500, { ok: false }));
      return;
    }
    json(res, 404, { ok: false, error: 'khong co' });
  });
  return true;
}
