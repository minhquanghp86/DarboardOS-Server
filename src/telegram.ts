// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

/**
 * (16/10/2026) THONG BAO TELEGRAM — add-on gui THANG qua Telegram Bot API (khong qua tich hop Telegram cua Home Assistant):
 * chuong cong nho / bi tu choi / moi lan bam chuong (kem anh khach), cuoc goi video nho. Cai dat o Dashboard → Gọi → ⚙
 * (token bot, chat ID, chon su kien, "Tìm chat ID", "Gửi thử"); luu /data/rwv-telegram.json. Token KHONG bao gio tra ve trang
 * (chi 4 ky tu cuoi) va KHONG ghi vao log.
 *
 *   GET  /telegram/config            -> { enabled, hasToken, tokenTail, chatIds, events }
 *   POST /telegram/config            -> luu (token rong = giu token cu)
 *   POST /telegram/test              -> gui tin thu toi moi chat ID
 *   POST /telegram/chats             -> chat da nhan tin cho bot gan day (getUpdates) — de lay chat ID
 * Chi trang Dashboard (ingress) hoac chinh may chu goi duoc.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export type TgEvent = 'ring' | 'missed' | 'declined' | 'call';
export interface TgConfig { enabled: boolean; token: string; chatIds: string[]; events: Record<TgEvent, boolean> }

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const CFG_FILE = process.env.TELEGRAM_FILE || path.join(DATA_DIR, 'rwv-telegram.json');
const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
const DEF_EVENTS: Record<TgEvent, boolean> = { ring: true, missed: true, declined: true, call: true };

let cfg: TgConfig = { enabled: false, token: '', chatIds: [], events: { ...DEF_EVENTS } };
try {
  const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  cfg = { ...cfg, ...j, events: { ...DEF_EVENTS, ...(j?.events ?? {}) } };
} catch { /* chua co */ }
// Docker thuan / thu: bien moi truong khi chua cai dat trong trang.
if (!cfg.token && process.env.TELEGRAM_BOT_TOKEN) cfg.token = process.env.TELEGRAM_BOT_TOKEN;
if (!cfg.chatIds.length && process.env.TELEGRAM_CHAT_ID) cfg.chatIds = process.env.TELEGRAM_CHAT_ID.split(',').map((s) => s.trim()).filter(Boolean);

const TOKEN_RE = /^\d{5,15}:[\w-]{30,60}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][\w]{3,40})$/;

function save(): void {
  try { fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg), { mode: 0o600 }); } catch { /* */ }
}
const tail = (t: string) => (t ? t.slice(-4) : '');
/** Che token trong chuoi bat ky (thong bao loi cua fetch co the chua URL). */
const mask = (s: string) => (cfg.token ? s.split(cfg.token).join('<token>') : s);

export function telegramPublic() {
  return { enabled: cfg.enabled, hasToken: !!cfg.token, tokenTail: tail(cfg.token), chatIds: cfg.chatIds, events: cfg.events };
}

/** Kiem + luu cai dat tu trang. Tra loi (tieng Viet) hoac null. */
export function setTelegramConfig(b: any): string | null {
  const token = typeof b?.token === 'string' ? b.token.trim() : '';
  if (token && !TOKEN_RE.test(token)) return 'Token bot không đúng dạng (vd 123456789:AA…, lấy từ @BotFather).';
  const ids = Array.isArray(b?.chatIds) ? b.chatIds : typeof b?.chatIds === 'string' ? b.chatIds.split(/[,\s]+/) : cfg.chatIds;
  const chatIds = [...new Set(ids.map((x: unknown) => String(x).trim()).filter(Boolean))] as string[];
  const bad = chatIds.find((c) => !CHAT_RE.test(c));
  if (bad) return `Chat ID "${bad.slice(0, 30)}" không hợp lệ (số, có thể âm cho nhóm; hoặc @tênkênh).`;
  if (chatIds.length > 10) return 'Tối đa 10 chat ID.';
  const ev = { ...cfg.events };
  for (const k of Object.keys(DEF_EVENTS) as TgEvent[]) if (typeof b?.events?.[k] === 'boolean') ev[k] = b.events[k];
  cfg = { enabled: !!b?.enabled, token: token || (b?.clearToken ? '' : cfg.token), chatIds, events: ev };
  save();
  console.log(`[telegram] cai dat: ${cfg.enabled ? 'BAT' : 'tat'}, ${cfg.chatIds.length} chat, token ${cfg.token ? '…' + tail(cfg.token) : '(chua co)'}, su kien ${(Object.keys(ev) as TgEvent[]).filter((k) => ev[k]).join(',')}`);
  return null;
}

// ── Gui (hang doi tuan tu, thu lai) ──────────────────────────────────────────────────────────────────────────────
interface Job { method: 'sendMessage' | 'sendPhoto'; chat: string; text: string; photo?: string; tries: number }
const queue: Job[] = [];
let busy = false;

async function call(method: string, body: FormData | Record<string, unknown>, token = cfg.token): Promise<any> {
  const init: RequestInit = body instanceof FormData ? { method: 'POST', body }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(`${API}/bot${token}/${method}`, { ...init, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` })) as any;
  if (!j.ok) { const e = new Error(j.description || `HTTP ${r.status}`) as Error & { retryAfter?: number; status?: number }; e.retryAfter = j.parameters?.retry_after; e.status = r.status; throw e; }
  return j.result;
}

async function runJob(j: Job): Promise<void> {
  if (j.method === 'sendPhoto' && j.photo && fs.existsSync(j.photo)) {
    const fd = new FormData();
    fd.append('chat_id', j.chat); fd.append('caption', j.text); fd.append('parse_mode', 'HTML');
    fd.append('photo', new Blob([fs.readFileSync(j.photo)], { type: 'image/jpeg' }), path.basename(j.photo));
    await call('sendPhoto', fd);
  } else {
    await call('sendMessage', { chat_id: j.chat, text: j.text, parse_mode: 'HTML', disable_web_page_preview: true });
  }
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const j = queue[0];
      try {
        await runJob(j);
        queue.shift();
      } catch (e) {
        const err = e as Error & { retryAfter?: number; status?: number };
        j.tries++;
        // Loi cau hinh (token sai 401, chat sai 400/403): khong thu lai.
        const fatal = err.status === 400 || err.status === 401 || err.status === 403 || err.status === 404;
        console.warn(`[telegram] gui ${j.method} toi ${j.chat} loi (lan ${j.tries}): ${mask(err.message)}`);
        if (fatal || j.tries >= 4) { queue.shift(); continue; }
        await new Promise((r) => setTimeout(r, err.retryAfter ? err.retryAfter * 1000 : [2000, 8000, 30000][j.tries - 1] ?? 30000));
      }
    }
  } finally { busy = false; }
}

/** Gui mot thong bao su kien (neu dang bat + su kien duoc chon). photo = duong dan JPEG (anh khach). */
export function telegramNotify(ev: TgEvent, text: string, photo?: string | null): void {
  if (!cfg.enabled || !cfg.token || !cfg.chatIds.length || !cfg.events[ev]) return;
  if (queue.length > 50) queue.splice(0, queue.length - 50);   // Telegram mat lau: khong don vo han
  for (const chat of cfg.chatIds) queue.push({ method: photo ? 'sendPhoto' : 'sendMessage', chat, text, photo: photo ?? undefined, tries: 0 });
  pump().catch(() => { });
}

// ── Dinh dang tin nhan ───────────────────────────────────────────────────────────────────────────────────────────
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** "14:05:12 · Thứ Sáu 16/10/2026" theo mui gio cua may chu (TZ add-on = mui gio Home Assistant). */
export function when(ts = Date.now()): string {
  const d = new Date(ts);
  const t = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const day = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${t} · ${day.charAt(0).toUpperCase()}${day.slice(1)}`;
}
export function tgText(ev: TgEvent, o: { door?: string; from?: string; to?: string; ringS?: number; ts?: number }): string {
  const t = `🕒 ${when(o.ts)}`;
  switch (ev) {
    case 'ring': return `🔔 <b>Có người bấm chuông</b> — ${esc(o.door ?? 'Cổng')}\n${t}`;
    case 'missed': return `🔕 <b>Chuông cổng nhỡ</b> — ${esc(o.door ?? 'Cổng')}\nKhông ai nghe${o.ringS ? ` trong ${o.ringS} giây` : ''}.\n${t}`;
    case 'declined': return `⛔ <b>Chuông cổng bị từ chối</b> — ${esc(o.door ?? 'Cổng')}\n${t}`;
    case 'call': return `📞 <b>Cuộc gọi video nhỡ</b>\nTừ: ${esc(o.from ?? '?')}\nĐến: ${esc(o.to ?? '?')}\n${t}`;
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function allowed(req: http.IncomingMessage): boolean {
  const a = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return /^(127\.0\.0\.1|::1)$/.test(a) || a === '172.30.32.2' || process.env.LAUNCHER_CONFIG_OPEN === '1';
}
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 4096) { req.destroy(); fail(new Error('quá lớn')); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { fail(new Error('JSON không hợp lệ')); } });
    req.on('error', fail);
  });
}

export function handleTelegramApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/telegram/')) return false;
  if (!allowed(req)) { json(res, 403, { ok: false, error: 'Chỉ dùng được từ trang Dashboard.' }); return true; }
  if (p === '/telegram/config' && req.method === 'GET') { json(res, 200, { ok: true, ...telegramPublic() }); return true; }
  if (p === '/telegram/config' && req.method === 'POST') {
    readJson(req).then((b) => {
      const err = setTelegramConfig(b);
      json(res, err ? 400 : 200, err ? { ok: false, error: err } : { ok: true, ...telegramPublic() });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  if (p === '/telegram/test' && req.method === 'POST') {
    (async () => {
      if (!cfg.token) throw new Error('Chưa có token bot.');
      if (!cfg.chatIds.length) throw new Error('Chưa có chat ID.');
      const out: { chat: string; ok: boolean; error?: string }[] = [];
      for (const chat of cfg.chatIds) {
        try { await call('sendMessage', { chat_id: chat, text: `✅ <b>HA Dashboard</b>: thông báo Telegram đã hoạt động.\n🕒 ${when()}`, parse_mode: 'HTML' }); out.push({ chat, ok: true }); }
        catch (e) { out.push({ chat, ok: false, error: mask((e as Error).message) }); }
      }
      json(res, 200, { ok: out.every((x) => x.ok), results: out });
    })().catch((e) => json(res, 400, { ok: false, error: mask((e as Error).message) }));
    return true;
  }
  if (p === '/telegram/chats' && req.method === 'POST') {
    readJson(req).then(async (b) => {
      const token = typeof b?.token === 'string' && b.token.trim() ? b.token.trim() : cfg.token;
      if (!token || !TOKEN_RE.test(token)) throw new Error('Nhập token bot trước.');
      const ups = await call('getUpdates', { limit: 50, timeout: 0 }, token) as any[];
      const seen = new Map<string, string>();
      for (const u of ups ?? []) {
        const c = u?.message?.chat ?? u?.channel_post?.chat ?? u?.my_chat_member?.chat;
        if (c?.id != null) seen.set(String(c.id), String(c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || c.type));
      }
      json(res, 200, { ok: true, chats: [...seen].map(([id, name]) => ({ id, name })) });
    }).catch((e) => json(res, 400, { ok: false, error: mask((e as Error).message) }));
    return true;
  }
  json(res, 404, { ok: false, error: 'Không có.' });
  return true;
}
