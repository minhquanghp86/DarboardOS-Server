// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — API cho APP ANDROID (khong dung WebSocket, khong Firebase): dien thoai la thiet bi thuong tru
// nho 5 duong dan nay (app goi bang HttpURLConnection, poll 2 s/lan):
//   POST /app/register  body {id, name, url?, deviceKey?, model?}
//                                               -> dang ky / cap nhat (id do app sinh 1 lan, luu SharedPreferences);
//                                                  cung `deviceKey` = cung mot may -> GOP ban ghi trung va tra
//                                                  ve `id` CHUAN (app cap nhat lai Prefs), xem src/phoneStore.ts
//   GET  /app/list                              -> {ok, phones: [{id, name, lastSeen, deviceKey, model}]}
//   GET  /app/incoming?phone=<id>               -> {call: {id, from, fromName} | null}   (cuoc goi dang do chuong)
//   POST /app/answer?phone=<id>&call=<id>       -> nghe (noi voi man, xem src/calls.ts accept)
//   POST /app/decline?phone=<id>&call=<id>      -> tu choi
//   (GD3) POST /app/hangup?phone=<id>&call=<id> -> ket thuc cuoc goi dang nghe (ke ca sau khi trang call-web.html
//                                                  ?call= da "join" — luc do c.to la phien web, /app/decline khong con dung)
//
// (GD8 — 30/10/2026) QUAN LY THIET BI tu trang call-web.html (sua ten / xoa may khoi danh ba):
//   POST /app/rename    body {id, name}         -> {ok:true, phone:{...}} | 404
//   POST /app/remove    body {id}               -> {ok:true, removed:1} | 404
//
// (30/10/2026) GD4 — them GET|HEAD /app/ping de app tu TIM add-on: nguoi dung chi nhap IP/domain cua Home Assistant,
// app thu tung ung vien va dung lai o dia chi nao tra {"service":"dashboard-os"}. Endpoint nay KHONG auth, KHONG cache
// va mo CORS (de sau nay PWA trong Home Assistant cung do duoc).
//
// Khac voi /calls/* (chi 127.0.0.1), nam duong dan nay PHAI goi duoc tu LAN / ingress: dien thoai khong chay tren may
// chu. Khong co mat khau (giong /notify): chi lo ten may + dang cuoc goi, khong lo hinh/tieng.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accept, declineFromPhone, hangupFromPhone, incomingFor } from './calls.js';
import { parseId, parseRegister, phones, type Phone } from './phoneStore.js';

const BODY_MAX = 4096;

/** Phien ban add-on (doc tu package.json, giong src/deviceManager.ts) — tra trong /app/ping. */
const SERVER_VERSION = (() => {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version as string;
  } catch {
    return '?';
  }
})();

const PING_PATH = '/app/ping';

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, done: (raw: string | null) => void): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  let sent = false;
  const finish = (raw: string | null) => {
    if (sent) return;   // 'end' va 'error' co the cung chay: chi tra loi MOT lan
    sent = true;
    done(raw);
  };
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > BODY_MAX) { over = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => finish(over ? null : Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => finish(null));
}

/**
 * (30/10/2026) GD4 — GET|HEAD /app/ping: "may nay co phai Dashboard OS khong?".
 * Tra 200 + {ok, service:'dashboard-os', version, caps:['phone-api']}, Cache-Control: no-store, CORS *.
 * HEAD tra header khong body (dung chuan). Method khac -> 405 (van kem CORS de PWA doc duoc loi).
 */
function handlePing(req: http.IncomingMessage, res: http.ServerResponse): void {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...headers, allow: 'GET, HEAD' });
    res.end(JSON.stringify({ ok: false, error: 'GET/HEAD' }));
    return;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD'
    ? undefined
    : JSON.stringify({ ok: true, service: 'dashboard-os', version: SERVER_VERSION, caps: ['phone-api'] }));
}

/** Ban ghi tra ve app / trang call-web: `deviceKey` da BAM san (xem hashDeviceKey) nen khong lo ANDROID_ID tho. */
function phoneView(p: Phone): { id: string; name: string; lastSeen: number; deviceKey: string; model: string } {
  return { id: p.id, name: p.name, lastSeen: p.lastSeen, deviceKey: p.deviceKey || '', model: p.model || '' };
}

/** true = da xu ly request. */
export function handlePhoneApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  // Bo "/" cuoi (va chap nhan tien to duong dan: /b39feb53_remote_webview_server/app/ping).
  const raw = url.pathname;
  const p = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;

  // (30/10/2026) GD4 — /app/ping: phai tra 200 ca khi add-on chay sau proxy co TIEN TO duong dan, nen so khop
  // theo HAU TO chu khong phai bang dung. Khong auth, khong cache, CORS mo (PWA cua HA cung do duoc).
  if (p.endsWith(PING_PATH)) {
    handlePing(req, res);
    return true;
  }

  if (!p.startsWith('/app/')) return false;
  const q = (k: string) => url.searchParams.get(k) || '';

  if (p === '/app/register') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    readBody(req, (raw) => {
      let body: unknown;
      try { body = JSON.parse(raw || '{}'); } catch { json(res, 400, { ok: false, error: 'JSON khong hop le' }); return; }
      const r = parseRegister(body);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      const phone = phones.register(r.reg);
      // `phone.id` co the KHAC `r.reg.id` khi server GOP ban ghi trung deviceKey: app phai cap nhat lai id.
      if (phone.id !== r.reg.id) console.log(`[phones] gop ${r.reg.id} -> ${phone.id} (${phone.name}) theo deviceKey`);
      else console.log(`[phones] dang ky ${phone.id} (${phone.name})`);
      json(res, 200, { ok: true, phone: phoneView(phone) });
    });
    return true;
  }

  if (p === '/app/rename') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    readBody(req, (raw) => {
      let body: any;
      try { body = JSON.parse(raw || '{}'); } catch { json(res, 400, { ok: false, error: 'JSON khong hop le' }); return; }
      const r = parseId(body);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      const phone = phones.rename(r.id, typeof body?.name === 'string' ? body.name : '');
      if (!phone) { json(res, 404, { ok: false, error: 'khong co thiet bi' }); return; }
      console.log(`[phones] doi ten ${phone.id} -> ${phone.name}`);
      json(res, 200, { ok: true, phone: phoneView(phone) });
    });
    return true;
  }

  if (p === '/app/remove') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    readBody(req, (raw) => {
      let body: any;
      try { body = JSON.parse(raw || '{}'); } catch { json(res, 400, { ok: false, error: 'JSON khong hop le' }); return; }
      const r = parseId(body);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      if (!phones.remove(r.id)) { json(res, 404, { ok: false, error: 'khong co thiet bi' }); return; }
      console.log(`[phones] xoa ${r.id}`);
      json(res, 200, { ok: true, removed: 1 });
    });
    return true;
  }

  if (p === '/app/list') {
    if (req.method !== 'GET') { json(res, 405, { error: 'GET' }); return true; }
    json(res, 200, { ok: true, phones: phones.list().map(phoneView) });
    return true;
  }

  if (p === '/app/incoming') {
    if (req.method !== 'GET') { json(res, 405, { error: 'GET' }); return true; }
    const phone = q('phone');
    if (!phone) { json(res, 400, { error: 'can phone' }); return true; }
    json(res, 200, { call: incomingFor(phone) });
    return true;
  }

  if (p === '/app/answer' || p === '/app/decline') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    const phone = q('phone'), call = q('call');
    if (!phone || !call) { json(res, 400, { ok: false, error: 'can phone va call' }); return true; }
    const r = p === '/app/answer'
      ? accept(call, phone)
      : declineFromPhone(call, phone) ? { ok: true } : { ok: false, error: 'Cuộc gọi đã kết thúc.' };
    console.log(`[phones] ${call}: ${phone} ${p === '/app/answer' ? 'nghe' : 'tu choi'} -> ${r.ok ? 'ok' : 'khong'}`);
    json(res, r.ok ? 200 : 409, r);
    return true;
  }

  // (GD3) Ket thuc cuoc goi tu dien thoai (trang call-web.html?call= bam "Kết thúc" khi WS chua/khong con vao duoc).
  if (p === '/app/hangup') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    const phone = q('phone'), call = q('call');
    if (!phone || !call) { json(res, 400, { ok: false, error: 'can phone va call' }); return true; }
    const ok = hangupFromPhone(call, phone);
    console.log(`[phones] ${call}: ${phone} ket thuc -> ${ok ? 'ok' : 'khong'}`);
    json(res, ok ? 200 : 409, ok ? { ok: true } : { ok: false, error: 'Cuộc gọi đã kết thúc.' });
    return true;
  }

  json(res, 404, { error: 'khong co' });
  return true;
}
