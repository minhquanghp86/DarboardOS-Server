// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

/**
 * (16/10/2026) TRANG DASHBOARD → "MÀN HÌNH" (public/screens.html + dai the rut gon tren trang chu launcher-config.html):
 * xem va dieu khien TUNG man hinh tu xa, khong can cham man. Chi trang Dashboard (ingress HA, da xac thuc) hoac chinh may
 * chu (127.0.0.1) goi duoc. Logic nam o deviceManager (screen* / applySetting) — file nay chi la lop HTTP.
 *
 *   GET  /screens/list               -> { screens: [tom tat + ten] }
 *   GET  /screens/info?id=           -> chi tiet (tab, ung dung, am thanh, thong bao, so do)
 *   GET  /screens/shot?id=           -> JPEG man dang hien
 *   GET  /screens/media?id=          -> trinh phat cua tab dang hien / tab phat nen
 *   GET  /screens/settings?id=       -> cai dat (thuc the HA + muc addon), giong ung dung Cai dat
 *   POST /screens/act  {id, act, …}  -> lenh (xem deviceManager.screenAct)
 *   POST /screens/set  {id, sid, v}  -> doi 1 cai dat
 */
import http from 'node:http';
import { screenAct, screenDebug, screenDetail, screenMedia, screenSettingSet, screenSettings, screenShot, screensOverview } from './deviceManager.js';
import { doorInfo } from './door.js';

let nameOf: (id: string) => string | undefined = () => undefined;
export function setScreenCtlHooks(h: { name: (id: string) => string | undefined }): void { nameOf = h.name; }

// (22/10/2026) Mo cong 18080: trang control.html vao thang tu LAN/Tailscale (khong qua ingress) van
// goi duoc /screens/info, /screens/set... Chi gioi han trong mang noi bo.
function isLan(req: http.IncomingMessage): boolean {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
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

export function handleScreenCtlApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/screens/')) return false;
  if (!isLocal(req) && !fromIngress(req) && !isLan(req)) { json(res, 403, { ok: false, error: 'Chỉ dùng được từ trang Dashboard.' }); return true; }
  const id = url.searchParams.get('id') || '';
  const named = <T extends { id: string }>(s: T) => ({ ...s, name: nameOf(s.id) || s.id });
  if (p === '/screens/dbg' && req.method === 'GET') {
    screenDebug(id).then((d) => json(res, d ? 200 : 404, d ?? { ok: false, error: 'Không có màn hình này.' }));
    return true;
  }
  if (p === '/screens/list' && req.method === 'GET') {
    const list = screensOverview().map(named).sort((a, b) => Number(b.online) - Number(a.online) || b.w * b.h - a.w * a.h);
    // (17/10/2026) Chuông cổng là một thiết bị của hệ thống: trả kèm để trang "Màn hình" vẽ thẻ như các màn.
    json(res, 200, { ok: true, screens: list, doors: doorInfo() });
    return true;
  }
  if (p === '/screens/info' && req.method === 'GET') {
    const d = screenDetail(id);
    if (!d) json(res, 404, { ok: false, error: 'Không có màn hình này.' }); else json(res, 200, { ok: true, screen: named(d) });
    return true;
  }
  if (p === '/screens/shot' && req.method === 'GET') {
    screenShot(id).then((b) => {
      if (!b) { json(res, 404, { ok: false, error: 'Màn hình không kết nối.' }); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'content-length': b.length });
      res.end(b);
    }).catch(() => json(res, 504, { ok: false, error: 'Không chụp được màn hình.' }));
    return true;
  }
  if (p === '/screens/media' && req.method === 'GET') {
    screenMedia(id).then((list) => json(res, 200, { ok: true, media: list })).catch(() => json(res, 200, { ok: true, media: [] }));
    return true;
  }
  if (p === '/screens/settings' && req.method === 'GET') {
    screenSettings(id).then((r) => {
      if (!r) json(res, 404, { ok: false, error: 'Không có màn hình này.' }); else json(res, 200, r);
    }).catch((e) => json(res, 500, { ok: false, error: (e as Error).message }));
    return true;
  }
  if (p === '/screens/act' && req.method === 'POST') {
    readJson(req, 4096).then(async (b) => {
      const err = await screenAct(String(b?.id ?? ''), b);
      json(res, err ? 400 : 200, err ? { ok: false, error: err } : { ok: true });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  if (p === '/screens/set' && req.method === 'POST') {
    readJson(req, 4096).then(async (b) => {
      if (typeof b?.sid !== 'string') throw new Error('thiếu cài đặt');
      const r = await screenSettingSet(String(b?.id ?? ''), b.sid, b.v);
      json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { ok: false, error: r.msg });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  json(res, 404, { ok: false, error: 'Không có.' });
  return true;
}
