// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (25/09/2026) API nho cho cac ung dung cua launcher (chi o HEALTH_PORT, LAN — nhu /metrics, cam.html):
//   GET  /cams/list          -> luong go2rtc (bo *_sub khi co luong chinh; *_sub dung cho anh chup nhe hon)
// (01/10/2026) Bo ung dung "Canh" theo yeu cau nguoi dung (cung /ha/scenes, /ha/run — may LAN khong con kich duoc
// scene/script qua addon).
import type http from 'node:http';

import { go2rtcFetch } from './go2rtcProxy.js';

async function listCams(): Promise<Array<{ name: string; snap: string; live: string }>> {
  const r = await go2rtcFetch('/api/streams');   // (09/10/2026) tu tim go2rtc (Frigate) thay vi 127.0.0.1:1984
  if (!r.ok) throw new Error(`go2rtc ${r.status}`);
  const names = Object.keys(await r.json() as Record<string, unknown>);
  const set = new Set(names);
  return names
    .filter(n => !(n.endsWith('_sub') && set.has(n.slice(0, -4))))
    .map(n => ({ name: n, snap: set.has(n + '_sub') ? n + '_sub' : n, live: n }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** true = da xu ly request. */
export function handleAppApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (p === '/cams/list' && req.method === 'GET') {
    // (09/10/2026) Ten camera trong nha: chi trang trong Chromium cua add-on (truoc day ca LAN doc duoc).
    if (!/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '')) { json(res, 403, { error: 'Chỉ dùng được từ màn hình.' }); return true; }
    listCams().then(l => json(res, 200, l)).catch(e => json(res, 502, { error: (e as Error).message }));
    return true;
  }
  return false;
}
