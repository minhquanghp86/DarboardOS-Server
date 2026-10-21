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
const FRAME_GAP_MS = 60;
const QUALITY = 55;

export function handleControlUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || '/', 'http://x');
  if (!url.pathname.endsWith('/control/ws')) return false;
  if (!isLocal(req) && !fromIngress(req)) { socket.destroy(); return true; }
  const dev = url.searchParams.get('dev') || '';
  wss.handleUpgrade(req, socket, head, (ws) => void startLive(ws, dev));
  return true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function startLive(ws: WebSocket, id: string): Promise<void> {
  const dev = getDeviceSession(id);
  if (!dev) { try { ws.close(4004, 'no device'); } catch { /* ignore */ } return; }
  let closed = false;
  ws.on('close', () => { closed = true; });
  ws.on('error', () => { closed = true; });
  while (!closed && ws.readyState === WebSocket.OPEN) {
    const t0 = Date.now();
    try {
      const r = await dev.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY }) as { data: string };
      if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(r.data, 'base64'), { binary: true });
    } catch { closed = true; break; }
    const spent = Date.now() - t0;
    if (spent < FRAME_GAP_MS) await sleep(FRAME_GAP_MS - spent);
  }
  try { ws.close(); } catch { /* ignore */ }
}

export function handleControlApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/control/')) return false;
  if (!isLocal(req) && !fromIngress(req)) { json(res, 403, { ok: false, error: 'Chỉ dùng được từ trang Darboard.' }); return true; }

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
