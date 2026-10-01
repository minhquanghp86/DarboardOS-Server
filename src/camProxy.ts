// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/10/2026) UNG DUNG CAMERA cua panel: trang public/camera.html (chay trong Chrome cua addon) goi /api/cam/<duong>,
// server chuyen tiep toi HTTP cua firmware (component cam_app, chi P4) tai IP cua CHINH thiet bi da bao ?cam=<cong> luc
// ket noi WebSocket. Khong nhan dia chi tuy y (khong thanh proxy mo); chi duong cua cam_app; chi tu 127.0.0.1.
import http from 'node:http';

const hosts = new Map<string, { ip: string; port: number }>();

/** Goi luc thiet bi ket noi WS: nho IP + cong ung dung Camera (0 = khong co -> quen). */
export function noteCameraHost(deviceId: string, remoteAddress: string | undefined, port: number): void {
  const ip = (remoteAddress || '').replace(/^::ffff:/, '');
  if (port > 0 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) hosts.set(deviceId, { ip, port });
  else hosts.delete(deviceId);
}

export function cameraHost(): { ip: string; port: number } | undefined {
  return hosts.values().next().value;
}

const ALLOWED = /^\/(cam\/(status|photo|last\.jpg|rec)|sd\/(list|file|del))$/;

/** true = da xu ly yeu cau (pathname bat dau /api/cam/). */
export function handleCamProxy(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, search: string): boolean {
  if (!pathname.startsWith('/api/cam/')) return false;
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const local = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
  const sub = pathname.slice('/api/cam'.length);
  if (!local) { send(403, { error: 'Chỉ dùng được từ màn hình.' }); return true; }
  if (!ALLOWED.test(sub) || (req.method !== 'GET' && req.method !== 'POST')) { send(404, { error: 'khong co' }); return true; }
  const h = cameraHost();
  if (!h) { send(503, { error: 'Màn hình có camera chưa kết nối.' }); return true; }
  const up = http.request({ host: h.ip, port: h.port, path: sub + search, method: req.method, timeout: 20_000 }, (r) => {
    const headers: http.OutgoingHttpHeaders = { 'cache-control': 'no-store' };
    if (r.headers['content-type']) headers['content-type'] = r.headers['content-type'];
    if (r.headers['content-length']) headers['content-length'] = r.headers['content-length'];
    res.writeHead(r.statusCode || 502, headers);
    r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('het gio')));
  up.on('error', (e) => { if (!res.headersSent) send(502, { error: `Không gọi được camera (${e.message}).` }); else res.destroy(); });
  req.on('close', () => { if (!res.writableEnded) up.destroy(); });
  up.end();
  return true;
}
