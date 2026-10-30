// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — API cho APP ANDROID (khong dung WebSocket, khong Firebase): dien thoai la thiet bi thuong tru
// nho 5 duong dan nay (app goi bang HttpURLConnection, poll 2 s/lan):
//   POST /app/register  body {id, name, url?}   -> dang ky / cap nhat (id do app sinh 1 lan, luu SharedPreferences)
//   GET  /app/list                              -> {ok, phones: [{id, name, lastSeen}]}
//   GET  /app/incoming?phone=<id>               -> {call: {id, from, fromName} | null}   (cuoc goi dang do chuong)
//   POST /app/answer?phone=<id>&call=<id>       -> nghe (noi voi man, xem src/calls.ts accept)
//   POST /app/decline?phone=<id>&call=<id>      -> tu choi
//
// Khac voi /calls/* (chi 127.0.0.1), nam duong dan nay PHAI goi duoc tu LAN / ingress: dien thoai khong chay tren may
// chu. Khong co mat khau (giong /notify): chi lo ten may + dang cuoc goi, khong lo hinh/tieng.
import http from 'node:http';
import { accept, declineFromPhone, incomingFor } from './calls.js';
import { parseRegister, phones } from './phoneStore.js';

const BODY_MAX = 4096;

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, done: (raw: string | null) => void): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  let sent = false;
  const finish = (raw: string | null) => {
    if (sent) return;   // 'end' va 'error' co the cung chay: chi tra loi MOT lan
    sent = true;
    done(raw);
  };
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > BODY_MAX) { over = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => finish(over ? null : Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => finish(null));
}

/** true = da xu ly request. */
export function handlePhoneApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/app/')) return false;
  const q = (k: string) => url.searchParams.get(k) || '';

  if (p === '/app/register') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    readBody(req, (raw) => {
      let body: unknown;
      try { body = JSON.parse(raw || '{}'); } catch { json(res, 400, { ok: false, error: 'JSON khong hop le' }); return; }
      const r = parseRegister(body);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      const phone = phones.register(r.reg);
      console.log(`[phones] dang ky ${phone.id} (${phone.name})`);
      json(res, 200, { ok: true, phone: { id: phone.id, name: phone.name, lastSeen: phone.lastSeen } });
    });
    return true;
  }

  if (p === '/app/list') {
    if (req.method !== 'GET') { json(res, 405, { error: 'GET' }); return true; }
    json(res, 200, { ok: true, phones: phones.list().map((x) => ({ id: x.id, name: x.name, lastSeen: x.lastSeen })) });
    return true;
  }

  if (p === '/app/incoming') {
    if (req.method !== 'GET') { json(res, 405, { error: 'GET' }); return true; }
    const phone = q('phone');
    if (!phone) { json(res, 400, { error: 'can phone' }); return true; }
    json(res, 200, { call: incomingFor(phone) });
    return true;
  }

  if (p === '/app/answer' || p === '/app/decline') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    const phone = q('phone'), call = q('call');
    if (!phone || !call) { json(res, 400, { ok: false, error: 'can phone va call' }); return true; }
    const r = p === '/app/answer'
      ? accept(call, phone)
      : declineFromPhone(call, phone) ? { ok: true } : { ok: false, error: 'Cuộc gọi đã kết thúc.' };
    console.log(`[phones] ${call}: ${phone} ${p === '/app/answer' ? 'nghe' : 'tu choi'} -> ${r.ok ? 'ok' : 'khong'}`);
    json(res, r.ok ? 200 : 409, r);
    return true;
  }

  json(res, 404, { error: 'khong co' });
  return true;
}
