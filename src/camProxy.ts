// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/10/2026) UNG DUNG CAMERA cua panel: trang public/camera.html (chay trong Chrome cua addon) goi /api/cam/<duong>,
// server chuyen tiep toi HTTP cua firmware (component cam_app, chi P4) tai IP cua CHINH thiet bi da bao ?cam=<cong> luc
// ket noi WebSocket. Khong nhan dia chi tuy y (khong thanh proxy mo); chi duong cua cam_app; chi tu 127.0.0.1.
import http from 'node:http';

/** (08/10/2026) auth = base64("user:pass") cho HTTP Basic Auth cua cam_app / av_stream (firmware gui ?ca=<hex(user:pass)>). */
export type CamHost = { ip: string; port: number; auth?: string };
const hosts = new Map<string, CamHost>();

/**
 * Goi luc thiet bi ket noi WS: nho IP + cong ung dung Camera (0 = khong co -> quen). (08/10/2026) auth: tai khoan HTTP
 * cua P4 (firmware gui ?ca=) — CHI giu trong bo nho de gan header khi goi P4; khong log, khong vao /metrics.
 */
export function noteCameraHost(deviceId: string, remoteAddress: string | undefined, port: number, authHex?: string | null): void {
  const ip = (remoteAddress || '').replace(/^::ffff:/, '');
  // Firmware gui hex (khoi ma hoa + / = trong URL) -> base64 cho header Basic.
  const a = authHex && /^(?:[0-9a-f]{2}){3,150}$/i.test(authHex) ? Buffer.from(authHex, 'hex').toString('base64') : undefined;
  if (port > 0 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) hosts.set(deviceId, { ip, port, ...(a ? { auth: a } : {}) });
  else hosts.delete(deviceId);
}

export function cameraHost(): CamHost | undefined {
  return hosts.values().next().value;
}

/** Header Authorization cho moi lan goi cam_app cua P4 (firmware chua bat mat khau -> rong, chay nhu cu). */
export function camAuth(h: CamHost): Record<string, string> {
  return h.auth ? { authorization: 'Basic ' + h.auth } : {};
}

/** (02/10/2026) Id thiet bi co camera/the SD (Quan ly file). */
export function cameraDeviceId(): string | undefined {
  return hosts.keys().next().value;
}

// (01/10/2026) + ung dung Tep / Thu vien: sd/ls (duyet), sd/get (tai, co Range de tua video), sd/rm (xoa), sd/thumb.
const ALLOWED = /^\/(cam\/(status|photo|last\.jpg|rec)|sd\/(list|file|del|ls|get|rm|thumb|format))$/;

// Panel chi mo 5 socket HTTP (cam_app) — luoi anh thu nho tai 30 o cung luc se day mat luong video dang phat. Hai hang
// doi: yeu cau nho (ls/thumb/status...) toi da 2, tai tep (get) toi da 3.
class Gate {
  private busy = 0;
  private q: (() => void)[] = [];
  constructor(private max: number) { }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy >= this.max) await new Promise<void>((r) => this.q.push(r));
    this.busy++;
    try { return await fn(); } finally { this.busy--; this.q.shift()?.(); }
  }
}
export const smallGate = new Gate(2), fileGate = new Gate(3);

// Anh thu nho tu tao (sharp) cho anh KHONG co .thumb tren the (chep tu may tinh...). Bo nho dem nho theo duong+co+gio.
const thumbCache = new Map<string, Buffer | null>();
const THUMB_MAX = 300;
function cacheThumb(k: string, v: Buffer | null): void {
  thumbCache.delete(k); thumbCache.set(k, v);
  while (thumbCache.size > THUMB_MAX) thumbCache.delete(thumbCache.keys().next().value!);
}

function fetchBuf(h: CamHost, path: string, max: number, method = 'GET'): Promise<{ code: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const up = http.request({ host: h.ip, port: h.port, path, method, timeout: 20_000, headers: camAuth(h) }, (r) => {
      const parts: Buffer[] = []; let n = 0;
      r.on('data', (c: Buffer) => { n += c.length; if (n > max) { up.destroy(new Error('qua lon')); return; } parts.push(c); });
      r.on('end', () => resolve({ code: r.statusCode || 502, type: String(r.headers['content-type'] || ''), body: Buffer.concat(parts) }));
      r.on('error', reject);
    });
    up.on('timeout', () => up.destroy(new Error('het gio')));
    up.on('error', reject);
    up.end();
  });
}

export async function serveThumb(h: { ip: string; port: number }, search: string, res: http.ServerResponse): Promise<void> {
  const q = new URLSearchParams(search);
  const p = q.get('p') || '';
  const key = `${p}|${q.get('s') || ''}|${q.get('t') || ''}`;
  const send = (b: Buffer | null) => {
    if (!b) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length, 'cache-control': 'private, max-age=86400' });
    res.end(b);
  };
  if (thumbCache.has(key)) { send(thumbCache.get(key)!); return; }
  const qs = '?p=' + encodeURIComponent(p);
  const t = await smallGate.run(() => fetchBuf(h, '/sd/thumb' + qs, 512 * 1024));
  if (t.code === 200 && t.body.length) { cacheThumb(key, t.body); send(t.body); return; }
  // Khong co .thumb: anh thuong -> tu thu nho (<= 20 MB); video/khac -> 404 (trang ve bieu tuong).
  if (!/\.(jpe?g|png|webp|gif|bmp)$/i.test(p)) { cacheThumb(key, null); send(null); return; }
  const full = await fileGate.run(() => fetchBuf(h, '/sd/get' + qs, 20 * 1024 * 1024));
  if (full.code !== 200) { send(null); return; }
  const sharp = (await import('sharp')).default;
  const out = await sharp(full.body, { failOn: 'none' }).rotate().resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  cacheThumb(key, out); send(out);
}

/** (01/10/2026) Cho server (Tin nhan: gui anh tu the SD / chup ngay). Toi da 200 MB. */
export async function camFetch(pathAndQuery: string, method = 'GET'): Promise<{ code: number; type: string; body: Buffer }> {
  const h = cameraHost();
  if (!h) throw new Error('Màn hình có camera chưa kết nối.');
  const big = pathAndQuery.startsWith('/sd/get');
  return (big ? fileGate : smallGate).run(() => fetchBuf(h, pathAndQuery, 200 * 1024 * 1024, method));
}

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
  if (sub === '/sd/thumb') {
    serveThumb(h, search, res).catch((e) => { if (!res.headersSent) send(502, { error: (e as Error).message }); else res.destroy(); });
    return true;
  }
  const isFile = sub === '/sd/get' || sub === '/sd/file';
  const gate = isFile ? fileGate : smallGate;
  gate.run(() => new Promise<void>((done) => {
    const fwd: http.OutgoingHttpHeaders = {};
    if (isFile && req.headers.range) fwd.range = req.headers.range;
    const up = http.request({ host: h.ip, port: h.port, path: sub + search, method: req.method, timeout: 20_000, headers: { ...fwd, ...camAuth(h) } }, (r) => {
      const headers: http.OutgoingHttpHeaders = { 'cache-control': 'no-store' };
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const) if (r.headers[k]) headers[k] = r.headers[k];
      // cam_app chi gui kieu chunked; do dai that nam o X-Body-Length -> Content-Length cho trinh phat video.
      const bl = Number(r.headers['x-body-length']);
      if (Number.isFinite(bl) && bl >= 0 && (r.statusCode === 200 || r.statusCode === 206)) headers['content-length'] = bl;
      res.writeHead(r.statusCode || 502, headers);
      r.pipe(res);
      r.on('end', done); r.on('error', done); r.on('close', done);
    });
    up.on('timeout', () => up.destroy(new Error('het gio')));
    up.on('error', (e) => { if (!res.headersSent) send(502, { error: `Không gọi được camera (${e.message}).` }); else res.destroy(); done(); });
    req.on('close', () => { if (!res.writableEnded) up.destroy(); done(); });
    up.end();
  })).catch(() => { });
  return true;
}

// ── (09/10/2026) LUONG CAMERA CHO FRIGATE QUA SERVER: P4 doi Cap mang <-> Wi-Fi thi doi IP (hai cong khac MAC); Frigate tro
// vao http://172.30.32.1:18080/cam/live/<id thiet bi> (dia chi co dinh) va server chuyen tiep toi av_stream :8080/live
// tai IP HIEN TAI cua thiet bi. CHI nhan tu mang noi bo cua Home Assistant (172.30.32.0/23 — Frigate, go2rtc) va may chu:
// khong mo duong vuot mat khau camera cho may khac trong LAN. Server la may chu tin cay cua P4 (khong can mat khau).
const AV_PORT = Number(process.env.RWV_AV_PORT || 8080);
const INTERNAL = /^(::ffff:)?(127\.0\.0\.1|172\.30\.3[23]\.\d{1,3})$|^::1$/;
export function isInternalPeer(addr: string | undefined): boolean { return INTERNAL.test(addr || ''); }

export function handleCamLive(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  const m = /^\/cam\/live\/([A-Za-z0-9_-]{1,40})$/.exec(pathname);
  if (!m) return false;
  const txt = (code: number, msg: string) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg); };
  if (!isInternalPeer(req.socket.remoteAddress)) { txt(403, 'Chi Frigate / Home Assistant noi bo.'); return true; }
  const h = hosts.get(m[1]);
  if (!h) { txt(503, 'Man hinh chua ket noi.'); return true; }
  const up = http.request({ host: h.ip, port: AV_PORT, path: '/live', method: 'GET', headers: camAuth(h) }, (r) => {
    res.writeHead(r.statusCode || 502, { 'content-type': r.headers['content-type'] || 'video/x-matroska', 'cache-control': 'no-store' });
    r.pipe(res);
  });
  up.setTimeout(20_000, () => up.destroy(new Error('het gio')));   // khong co du lieu 20 s -> dong (go2rtc tu noi lai)
  up.on('error', (e) => { if (!res.headersSent) txt(502, `Khong goi duoc camera (${e.message}).`); else res.destroy(); });
  const stop = () => up.destroy();
  req.on('close', stop); res.on('close', stop);
  up.end();
  console.log(`[cam-live] ${req.socket.remoteAddress?.replace(/^::ffff:/, '')} -> ${m[1]} @ ${h.ip}:${AV_PORT}`);
  return true;
}
