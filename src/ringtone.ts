// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) NHAC CHUONG lay tu thu muc media cua Home Assistant (add-on doc /media): chuong cong va cuoc goi video den.
// Mac dinh audio/chuong-cua.mp3 va audio/zalo.mp3 (nguoi dung tu chep vao); doi ten qua bien moi truong RINGTONE_DOOR /
// RINGTONE_CALL (duong dan trong /media). Khong co tep -> man dung am "ding-dong" firmware / trang tu tao am.
//   GET /ringtone/door | /ringtone/call   (127.0.0.1 + ingress)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MEDIA = process.env.MEDIA_DIR || '/media';
const FILES: Record<string, string> = {
  door: process.env.RINGTONE_DOOR || 'audio/chuong-cua.mp3',
  call: process.env.RINGTONE_CALL || 'audio/zalo.mp3',
};
const TYPES: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };

function fileOf(kind: string): string | null {
  const rel = FILES[kind];
  if (!rel) return null;
  const p = path.resolve(MEDIA, rel);
  return p.startsWith(path.resolve(MEDIA) + path.sep) ? p : null;   // khong ra ngoai /media
}
export function ringtoneExists(kind: 'door' | 'call'): boolean {
  const p = fileOf(kind);
  try { return !!p && fs.statSync(p).isFile(); } catch { return false; }
}

export function handleRingtone(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  const m = /\/ringtone\/(door|call)$/.exec(pathname);
  if (!m || req.method !== 'GET') return false;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!/^(127\.0\.0\.1|::1|172\.30\.32\.2)$/.test(ip)) { res.writeHead(403); res.end(); return true; }
  const p = fileOf(m[1]);
  fs.stat(p || '', (e, st) => {
    if (e || !p || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('khong co nhac chuong'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p).toLowerCase()] || 'audio/mpeg', 'content-length': st.size, 'cache-control': 'max-age=300' });
    fs.createReadStream(p).pipe(res);
  });
  return true;
}
