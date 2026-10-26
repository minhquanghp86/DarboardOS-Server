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
import os from 'node:os';
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
// (26/10/2026) 55 ms -> 0: do that (P4 dang phat YouTube) captureScreenshot ton 50-68 ms, cong them gap
// 55 ms thi nhip chi con 8-10 fps. Bo gap => 14.7 fps (P4) / ~19 fps (S3). Nhip gio do CHINH thoi gian
// chup quyet dinh; chong ton dong van co san (SSE/MJPEG: writableLength > 1 MB; WS: bufferedAmount).
const FRAME_GAP_MS = 0;
const QUALITY = 35;
const SCALE = 0.65;   // 0.75 -> 0.65 (26/10/2026): khung nho ~35% byte, dien thoai qua ingress/WiFi nhe hon
// (26/10/2026) UU TIEN THAO TAC: moi khung JPEG 19-53 KB (base64 +33%) nen o 15-25 fps luong stream chiem
// 0,5-1,4 MB/s. Tren duong ingress/WiFi, cac POST /control/input bi nghen phia sau -> vuot khong an
// (khong mo khoa duoc man hinh). Trong ~800 ms sau moi lenh cham/vuot, ha luong khung xuong ~3 fps
// de lenh dieu khien di truoc.
const inputAt = new Map<string, number>();

export function handleControlUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || '/', 'http://x');
  if (!url.pathname.endsWith('/control/ws')) return false;
  if (!isLocal(req) && !fromIngress(req) && !isLan(req)) { socket.destroy(); return true; }
  const dev = url.searchParams.get('dev') || '';
  wss.handleUpgrade(req, socket, head, (ws) => void startLive(ws, dev));
  return true;
}

function lanUrl(): string {
  try {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets) as any[]) {
      for (const ni of (list || []) as any[]) {
        if (ni.family !== 'IPv4' || ni.internal) continue;
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) return `http://${ni.address}:18080`;
      }
    }
  } catch { /* ignore */ }
  return '';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * (22/10/2026) Chup khung co timeout. Khi thiet bi dang phat video nang, lenh CDP captureScreenshot co the
 * treo (xep sau screencast) -> vong SSE/WS se dung im vinh vien va trang bao "0/0 · DUNG". Nay treo > timeout
 * thi bo khung do va thu lai o vong sau (khong dung vong, khong ngat ket noi).
 */
function captureJpeg(d: { cdp: { send: (...a: any[]) => Promise<any> } }, timeoutMs = 1200): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    d.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY })
      .then((r: any) => { if (!done) { done = true; clearTimeout(t); resolve((r as { data?: string })?.data ?? null); } })
      .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
  });
}


// (22/10/2026) MOT vong chup cho MOI THIET BI, chia khung cho MOI socket dang xem.
// Truoc day moi ket noi mo mot vong chup rieng -> mo 2 tab la 2 vong tranh CPU, nhip tut va
// vong kia co the loi/ngat. Nay: vong chup chi chay khi co it nhat 1 nguoi xem, tat khi het.
type LiveEntry = { peers: Set<WebSocket>; run: Promise<void> | null; stop: boolean; sse?: number };
// (26/10/2026) MOT vong chup/thiet bi (nhu 2.9.207), MOI nguoi xem (WS lan SSE) dung chung khung moi nhat.
// Truoc day /control/sse tu chay vong captureJpeg RIENG cho tung ket noi -> mo 2 tab la 2 vong tranh CDP voi
// lenh cham -> hinh dung yen khi keo. Nay SSE chi doc buffer, khong goi CDP.
const latestFrame = new Map<string, Buffer>();
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
    while (!e.stop && (e.peers.size > 0 || (e.sse || 0) > 0)) {
      const t = Date.now();
      try {
        const data = await captureJpeg(dev);
        if (!data) { await sleep(150); continue; }
        const buf = Buffer.from(data, 'base64');
        latestFrame.set(id, buf);
        for (const ws of e.peers) {
          if (ws.readyState !== WebSocket.OPEN) { e.peers.delete(ws); continue; }
          // Bo gap 55 ms thi phai tu chan ton dong: dien thoai mang cham khong xep hang vo han.
          if (ws.bufferedAmount > 1_048_576) continue;
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
  // (26/10/2026) INPUT QUA WS (giong panel that: remote_webview gui TouchType qua WS). Mot ket noi, khong
  // round-trip cho tung diem -> tren LAN/Tailscale do tre ~vai ms. Du phong: van nhan POST /control/input.
  ws.on('message', (raw) => {
    const txt = raw.toString();
    if (txt === 'p') return;                       // heartbeat
    try {
      const m = JSON.parse(txt);
      if (m && m.t === 'touch' && (m.kind === 'down' || m.kind === 'move' || m.kind === 'up')) {
        inputAt.set(id, Date.now());
        void screenTouch(id, m.kind, Number(m.x) || 0, Number(m.y) || 0);
      }
    } catch { /* bo qua */ }
  });
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

  // (26/10/2026) Probe de trang tu chuyen sang LAN/Tailscale: tra ve IP LAN cua HA (neu co).
  // Trang mo bang ten mien se thu goi <lan>:18080/control/ping; thay duoc thi chuyen sang IP (WebSocket -> input
  // di qua WS nhu panel that, do tre ~vai ms thay vi 1 RTT ~200 ms).
  if (p === '/control/ping' && req.method === 'GET') {
    json(res, 200, { ok: true, lan: lanUrl() });
    return true;
  }

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
          const data = await captureJpeg(d);
          if (closed) break;
          if (!data) { await sleep(150); continue; }
          const b = Buffer.from(data, 'base64');
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
    // (26/10/2026) DUNG CHUNG vong chup voi WS (1 vong/thiet bi) thay vi tu chup rieng.
    let le = live.get(id);
    if (!le) { le = { peers: new Set(), run: null, stop: false, sse: 0 }; live.set(id, le); }
    le.sse = (le.sse || 0) + 1;
    pumpLive(id);
    req.on('close', () => { closed = true; le!.sse = Math.max(0, (le!.sse || 1) - 1); if ((le!.sse || 0) === 0 && le!.peers.size === 0) le!.stop = true; });
    void (async () => {
      while (!closed) {
        const t = Date.now();
        const buf = latestFrame.get(id);
        if (!buf) { await sleep(60); continue; }
        if (res.writableLength > 1_000_000) { await sleep(50); continue; }
        try { n++; res.write(`id: ${n}\ndata: ${buf.toString('base64')}\n\n`); sent++; } catch { break; }
        const spent = Date.now() - t;
        const gap = 60;   // ~16 fps, khong phu thuoc thoi gian chup nua
        if (spent < gap) await sleep(gap - spent);
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
      const devId = String(b?.dev ?? '');
      inputAt.set(devId, Date.now());
      const err = await screenTouch(devId, kind, Number(b?.x) || 0, Number(b?.y) || 0);
      json(res, err ? 400 : 200, err ? { ok: false, error: err } : { ok: true });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }

  // (26/10/2026) GUI THEO TUNG DOAN (segment) trong luc dang keo: van LIVE (khong phai doi nha tay) nhung
  // gop nhieu diem vao 1 request. Do that: 1 lenh CDP ton ~26 ms (p90 33 ms) o server; cong RTT ten mien
  // cong khai ~200 ms. Gui 60 request/giay thi hang doi sau hang giay -> keo giat. Doan 60 ms => ~16 req/s.
  // Body: { dev, points:[{x,y,t}], start?:bool, end?:bool }.
  if (p === '/control/gesture' && req.method === 'POST') {
    readJson(req, 16384).then(async (b) => {
      const devId = String(b?.dev ?? '');
      const pts = Array.isArray(b?.points) ? b.points : [];
      const start = b?.start === true;
      const end = b?.end === true;
      if (!devId || pts.length === 0) { json(res, 400, { ok: false, error: 'thiếu points' }); return; }
      inputAt.set(devId, Date.now());
      let prevT = 0;
      for (let i = 0; i < pts.length; i++) {
        const x = Number(pts[i]?.x) || 0, y = Number(pts[i]?.y) || 0;
        const t = Number(pts[i]?.t) || 0;
        if (i > 0 && t > prevT) await sleep(Math.min(600, t - prevT));
        prevT = Math.max(prevT, t);
        const err = await screenTouch(devId, i === 0 && start ? 'down' : 'move', x, y);
        if (err) { json(res, 400, { ok: false, error: err }); return; }
      }
      if (end) {
        const last = pts[pts.length - 1];
        const err = await screenTouch(devId, 'up', Number(last?.x) || 0, Number(last?.y) || 0);
        if (err) { json(res, 400, { ok: false, error: err }); return; }
      }
      inputAt.set(devId, Date.now());
      json(res, 200, { ok: true });
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
