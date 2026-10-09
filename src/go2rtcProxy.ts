// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (09/10/2026) CHUYEN TIEP go2rtc cho cac trang camera (camera.html, cam.html, cams.html) chay trong Chromium CUNG MAY:
// truoc day trang goi thang <IP may HA>:1984 — chi chay khi add-on Frigate MO cong 1984 ra may chu (may cua tac gia);
// mac dinh khong mo -> nha khac khong xem duoc camera. go2rtc cua Frigate luon nghe cong 1984 trong mang add-on
// (172.30.33.x) -> server tim dia chi do (tu tich hop Frigate) va chuyen tiep /go2rtc/* (HTTP + WebSocket video).
// Thu tu: GO2RTC_URL (bien moi truong) -> <IP Frigate>:1984 -> 127.0.0.1:1984 (cong da mo ra may chu). CHI nhan tu
// 127.0.0.1 (Chromium cua add-on) — khong mo camera cho may khac trong LAN.
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { frigateHostIp } from './frigate.js';

const LOCAL = /^(::ffff:)?127\.0\.0\.1$|^::1$/;
const PREFIX = '/go2rtc/';
type Target = { host: string; port: number };
let cache: { t: Target; at: number } | null = null;

async function probe(t: Target): Promise<boolean> {
  try {
    const r = await fetch(`http://${t.host}:${t.port}/api/streams`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

/** Dia chi go2rtc dung duoc (cache 10 phut). Khong co -> loi "Chua tim thay go2rtc". */
export async function go2rtcTarget(): Promise<Target> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.t;
  const cands: Target[] = [];
  if (process.env.GO2RTC_URL) {
    try { const u = new URL(process.env.GO2RTC_URL); cands.push({ host: u.hostname, port: Number(u.port) || 1984 }); } catch { /* sai dinh dang */ }
  }
  const fip = await frigateHostIp().catch(() => null);
  if (fip) cands.push({ host: fip, port: 1984 });
  cands.push({ host: '127.0.0.1', port: 1984 });
  for (const t of cands) {
    if (await probe(t)) {
      if (cache?.t.host !== t.host) console.log(`[go2rtc] dung ${t.host}:${t.port}`);
      cache = { t, at: Date.now() };
      return t;
    }
  }
  cache = null;
  throw new Error('Chưa tìm thấy go2rtc (cài add-on Frigate, hoặc đặt GO2RTC_URL).');
}

export async function go2rtcFetch(p: string): Promise<Response> {
  const t = await go2rtcTarget();
  return fetch(`http://${t.host}:${t.port}${p}`, { signal: AbortSignal.timeout(5000) });
}

/** HTTP /go2rtc/<duong go2rtc>. true = da xu ly. */
export function handleGo2rtcHttp(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, search: string): boolean {
  if (!pathname.startsWith(PREFIX)) return false;
  if (!LOCAL.test(req.socket.remoteAddress || '')) { res.writeHead(403); res.end('chi tu man hinh'); return true; }
  go2rtcTarget().then((t) => {
    const up = http.request({ host: t.host, port: t.port, path: '/' + pathname.slice(PREFIX.length) + search, method: req.method,
      headers: { ...req.headers, host: `${t.host}:${t.port}` } }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
    up.on('error', (e) => { if (!res.headersSent) { res.writeHead(502); res.end(e.message); } else res.destroy(); });
    req.pipe(up);
    res.on('close', () => up.destroy());
  }).catch((e) => { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end((e as Error).message); });
  return true;
}

/** WebSocket /go2rtc/api/ws?... (video MSE / WebRTC): noi thang hai socket. true = da xu ly. */
export function handleGo2rtcUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const u = req.url || '';
  if (!u.startsWith(PREFIX)) return false;
  if (!LOCAL.test(req.socket.remoteAddress || '')) { socket.destroy(); return true; }
  go2rtcTarget().then((t) => {
    const up = net.connect(t.port, t.host, () => {
      const lines = [`${req.method} /${u.slice(PREFIX.length)} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        lines.push(`${k}: ${k.toLowerCase() === 'host' ? `${t.host}:${t.port}` : req.rawHeaders[i + 1]}`);
      }
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    const end = () => { up.destroy(); socket.destroy(); };
    up.on('error', end); socket.on('error', end); up.on('close', end); socket.on('close', end);
  }).catch(() => socket.destroy());
  return true;
}
