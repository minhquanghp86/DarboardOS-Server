// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

/**
 * (21/10/2026) TRANG "CONTROL" (public/control.html) — dieu khien man hinh tu Darboard:
 * xem khung hinh cap nhat nhanh (thay vi preview 4 giay) va gui thao tac cham/vuot/keo tha
 * xuong dung tab Chromium cua thiet bi. Chi trang Darboard (ingress HA) hoac may chu goi duoc.
 *
 *   GET  /control/frame?dev=<id>   -> JPEG khung hinh hien tai (quality 60)
 *
 * Buoc 2 (trang control.html) se them:
 *   POST /control/input {dev, kind, x, y}
 */
import http from 'node:http';
import { screenShot } from './deviceManager.js';

function isLocal(req: http.IncomingMessage): boolean { return /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || ''); }
function fromIngress(req: http.IncomingMessage): boolean {
  if (process.env.LAUNCHER_CONFIG_OPEN === '1') return true;
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';
}
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
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

  json(res, 404, { ok: false, error: 'Không có.' });
  return true;
}
