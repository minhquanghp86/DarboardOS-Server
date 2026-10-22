// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

/**
 * (21/10/2026) TRANG "CONTROL" (public/control.html) — dieu khien man hinh tu Darboard:
 * xem khung hinh lien tuc (CDP screencast) va gui thao tac cham/vuot/keo tha xuong dung tab
 * Chromium cua thiet bi. Chi trang Darboard (ingress HA) hoac may chu goi duoc.
 *
 *   GET  /control/frame?dev=<id>   -> JPEG khung hinh hien tai (du phong khi WebSocket loi)
 *   POST /control/input {dev, kind: down|move|up, x, y}
 *   POST /control/key   {dev, key: home|back|recents}
 *   WS   /control/ws?dev=<id>      -> day khung hinh (Page.startScreencast, toi da ~14 fps)
 */
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { getDeviceSession, screenKey, screenShot, screenTouch } from './deviceManager.js';

function isLocal(req: http.IncomingMessage): boolean { return /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || ''); }
/**
 * (22/10/2026) Mo cong 18080 ra LAN/Tailscale: trinh duyet trong nha (192.168.x / 10.x / 172.16-31.x)
 * goi thang cong nay thi khong qua ingress HA -> WS chay lien tuc. Gioi han trong mang noi bo.
 */
function isLan(req: http.IncomingMessage): boolean {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
function fromIngress(req: http.IncomingMessage): boolean {
  if (process.env.LAUNCHER_CONFIG_OPEN === '1') return true;
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';
}
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req: http.IncomingMessage, max: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > max) { req.destroy(); reject(new Error('quá lớn')); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('JSON không hợp lệ')); } });
    req.on('error', reject);
  });
}

// ── Live view: vong chup khung phia server, day JPEG qua WebSocket ─────────
// (21/10/2026) Page.startScreencast KHONG phat khung khi cua so Chromium chay an (tab cua panel),
// nen dung vong chup: do that 1 khung ~49 ms -> nhip 60 ms ~ 15 fps, du muot de thao tac.
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const FRAME_GAP_MS = 55;
const QUALITY = 35;
const SCALE = 0.75;   // khung nho hon -> ma hoa/giai ma nhanh, do tre thap (dien thoai hien thi nho hon man that)

export function handleControlUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || '/', 'http://x');
  if (!url.pathname.endsWith('/control/ws')) return false;
  if (!isLocal(req) && !fromIngress(req) && !isLan(req)) { socket.destroy(); return true; }
  const dev = url.searchParams.get('dev') || '';
  wss.handleUpgrade(req, socket, head, (ws) => void startLive(ws, dev));
  return true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// (22/10/2026) MOT vong chup cho MOI THIET BI, chia khung cho MOI socket dang xem.
// Truoc day moi ket noi mo mot vong chup rieng -> mo 2 tab la 2 vong tranh CPU, nhip tut va
// vong kia co the loi/ngat. Nay: vong chup chi chay khi co it nhat 1 nguoi xem, tat khi het.
type LiveEntry = { peers: Set<WebSocket>; run: Promise<void> | null; stop: boolean };
const live = new Map<string, LiveEntry>();

function pumpLive(id: string): void {
  const e = live.get(id);
  if (!e || e.run) return;
  e.stop = false;
  e.run = (async () => {
    const dev = getDeviceSession(id);
    if (!dev) {
      for (const ws of e.peers) { try { ws.close(4004, 'no device'); } catch { /* ignore */ } }
      live.delete(id);
      return;
    }
    let sent = 0;
    const t0 = Date.now();
    while (!e.stop && e.peers.size > 0) {
      const t = Date.now();
      try {
        const r = await dev.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY }) as { data: string };
        const buf = Buffer.from(r.data, 'base64');
        for (const ws of e.peers) {
          if (ws.readyState !== WebSocket.OPEN) { e.peers.delete(ws); continue; }
          try { ws.send(buf, { binary: true }); sent++; } catch { e.peers.delete(ws); }
        }
      } catch (err) {
        console.warn(`[control] live ${id}: loi chup khung (${(err as Error).message}) -> dung vong`);
        break;
      }
      const spent = Date.now() - t;
      if (spent < FRAME_GAP_MS) await sleep(FRAME_GAP_MS - spent);
    }
    e.run = null;
    console.log(`[control] live ${id}: dung vong — ${sent} khung / ${Math.round((Date.now() - t0) / 1000)} s`);
    if (e.peers.size === 0) live.delete(id);
  })();
}

async function startLive(ws: WebSocket, id: string): Promise<void> {
  const dev = getDeviceSession(id);
  if (!dev) { try { ws.close(4004, 'no device'); } catch { /* ignore */ } return; }
  let e = live.get(id);
  if (!e) { e = { peers: new Set(), run: null, stop: false }; live.set(id, e); }
  e.peers.add(ws);
  console.log(`[control] live ${id}: +1 nguoi xem (${e.peers.size})`);
  const drop = () => {
    e!.peers.delete(ws);
    if (e!.peers.size === 0) e!.stop = true;
  };
  ws.on('close', drop);
  ws.on('error', drop);
  // (22/10/2026) Heartbeat: proxy (HA ingress / Cloudflare) co the dong WS khi chi mot chieu nhan du lieu.
  // Client gui 'p' moi 2 s; o day chi tieu thu de khong xep hang.
  ws.on('message', () => {});
  const hb = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 3000);
  hb.unref?.();
  ws.on('close', () => clearInterval(hb));
  pumpLive(id);
}

export function handleControlApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/control/')) return false;
  if (!isLocal(req) && !fromIngress(req) && !isLan(req)) { json(res, 403, { ok: false, error: 'Chỉ dùng được từ trang Darboard.' }); return true; }

  if (p === '/control/frame' && req.method === 'GET') {
    const dev = url.searchParams.get('dev') || url.searchParams.get('id') || '';
    if (!dev) { json(res, 400, { ok: false, error: 'thiếu dev' }); return true; }
    screenShot(dev).then((b) => {
      if (!b) { json(res, 404, { ok: false, error: 'Màn hình không kết nối.' }); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'content-length': b.length });
      res.end(b);
    }).catch(() => json(res, 504, { ok: false, error: 'Không chụp được màn hình.' }));
    return true;
  }

  // MJPEG: trinh duyet tu ve tung khung trong <img> — khong can WebSocket, di qua ingress HA on dinh.
  if (p === '/control/stream' && req.method === 'GET') {
    const id = url.searchParams.get('dev') || '';
    const d = getDeviceSession(id);
    if (!d) { json(res, 404, { ok: false, error: 'Màn hình không kết nối.' }); return true; }
    res.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=frame',
      'cache-control': 'no-store, no-transform', 'connection': 'keep-alive', 'x-accel-buffering': 'no',
    });
    let closed = false, sent = 0, t0 = Date.now();
    req.on('close', () => { closed = true; });
    void (async () => {
      console.log(`[control] stream ${id}: bat dau`);
      while (!closed) {
        const t = Date.now();
        try {
          const r = await d.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY }) as { data: string };
          const b = Buffer.from(r.data, 'base64');
          if (closed) break;
          // (22/10/2026) Chong ton dong khi dien thoai/mang cham: bo khung thay vi xep hang vo han.
          if (res.writableLength > 1_000_000) { await sleep(50); continue; }
          res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${b.length}\r\n\r\n`);
          res.write(b); res.write('\r\n');
          sent++;
        } catch { break; }
        const spent = Date.now() - t;
        if (spent < FRAME_GAP_MS) await sleep(FRAME_GAP_MS - spent);
      }
      console.log(`[control] stream ${id}: ket thuc — ${sent} khung / ${Math.round((Date.now() - t0) / 1000)} s`);
      try { res.end(); } catch { /* ignore */ }
    })();
    return true;
  }

  // (22/10/2026) SSE (text/event-stream): Cloudflare + HA ingress stream duoc SSE on dinh, trong khi
  // multipart/x-mixed-replace bi dem va WebSocket bi dong sau vai khung. Moi khung = 1 dong base64 JPEG.
  if (p === '/control/sse' && req.method === 'GET') {
    const id = url.searchParams.get('dev') || '';
    const d = getDeviceSession(id);
    if (!d) { json(res, 404, { ok: false, error: 'Màn hình không kết nối.' }); return true; }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform', 'connection': 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    let closed = false, sent = 0, n = 0, t0 = Date.now();
    req.on('close', () => { closed = true; });
    void (async () => {
      while (!closed) {
        const t = Date.now();
        try {
          const r = await d.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY }) as { data: string };
          if (closed) break;
          n++;
          res.write(`id: ${n}\ndata: ${r.data}\n\n`);
          sent++;
        } catch { break; }
        // Chong ton dong: bo khung thay vi xep hang vo han khi dien thoai/mang cham.
        if (res.writableLength > 1_000_000) { await sleep(50); continue; }
        const spent = Date.now() - t;
        if (spent < FRAME_GAP_MS) await sleep(FRAME_GAP_MS - spent);
      }
      console.log(`[control] sse ${id}: ket thuc — ${sent} khung / ${Math.round((Date.now() - t0) / 1000)} s`);
      try { res.end(); } catch { /* ignore */ }
    })();
    return true;
  }

  if (p === '/control/input' && req.method === 'POST') {
    readJson(req, 2048).then(async (b) => {
      const kind = String(b?.kind ?? '');
      if (kind !== 'down' && kind !== 'move' && kind !== 'up') throw new Error('kind không hợp lệ');
      const err = await screenTouch(String(b?.dev ?? ''), kind, Number(b?.x) || 0, Number(b?.y) || 0);
      json(res, err ? 400 : 200, err ? { ok: false, error: err } : { ok: true });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }

  if (p === '/control/key' && req.method === 'POST') {
    readJson(req, 2048).then(async (b) => {
      const err = await screenKey(String(b?.dev ?? ''), String(b?.key ?? ''));
      json(res, err ? 400 : 200, err ? { ok: false, error: err } : { ok: true });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }

  json(res, 404, { ok: false, error: 'Không có.' });
  return true;
}
