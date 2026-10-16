// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (16/10/2026) Thong bao Telegram (src/telegram.ts): cai dat qua /telegram/config (token khong lo ra), Gui thu, Tim chat ID; chuong cong
// gia (WS ?door=1 + cong anh) bam chuong -> sendPhoto "co nguoi bam chuong", khong ai nghe -> sendPhoto "chuong cong nho".
// Telegram gia: may chu HTTP cuc bo (TELEGRAM_API).
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TestServer, sleep } from './harness.js';

// Token GIA ghep luc chay (khong de nguyen chuoi dung dang token bot trong ma nguon — GitHub secret scanning bao nham).
const TOKEN = ['123456789', 'AA' + 'x'.repeat(33)].join(':');
interface Hit { method: string; body: string; ct: string }
let srv: TestServer;
let tg: http.Server;
let snapSrv: http.Server;
let hits: Hit[] = [];
let door: WebSocket | null = null;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7), Buffer.from([0xff, 0xd9])]);

beforeEach(async () => {
  hits = [];
  tg = http.createServer((req, res) => {
    let b = Buffer.alloc(0);
    req.on('data', (c) => { b = Buffer.concat([b, c]); });
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url || '');
      if (!m || m[1] !== TOKEN) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"ok":false,"description":"Unauthorized"}'); return; }
      hits.push({ method: m[2], body: b.toString('latin1'), ct: String(req.headers['content-type'] || '') });
      const result = m[2] === 'getUpdates' ? [{ message: { chat: { id: -100123, title: 'Nhà mình', type: 'group' } } }] : { message_id: hits.length };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result }));
    });
  });
  snapSrv = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPEG); });
  await new Promise<void>((r) => tg.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => snapSrv.listen(0, '127.0.0.1', () => r()));
  srv = await TestServer.start({ TELEGRAM_API: `http://127.0.0.1:${(tg.address() as AddressInfo).port}` });
});
afterEach(async (ctx) => {
  door?.close(); door = null;
  const log = srv.log();
  await srv.stop(); tg.close(); snapSrv.close();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

const api = async (p: string, body?: unknown) => {
  const r = await fetch(srv.local(p), body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() as any };
};
async function until(fn: () => boolean, ms: number, what: string) {
  for (let t = 0; t < ms; t += 200) { if (fn()) return; await sleep(200); }
  throw new Error(`khong dat: ${what} — da nhan: ${hits.map((h) => h.method).join(',')}`);
}

it('cai dat + gui thu + tim chat ID; chuong cong: bam -> anh, khong ai nghe -> anh "nho"; token khong lo', async () => {
  // Token / chat ID sai dang bi tu choi
  expect((await api('/telegram/config', { enabled: true, token: 'abc', chatIds: '1' })).status).toBe(400);
  expect((await api('/telegram/config', { enabled: true, token: TOKEN, chatIds: 'abc def' })).status).toBe(400);
  // Tim chat ID bang token chua luu
  const found = await api('/telegram/chats', { token: TOKEN });
  expect(found.j.chats).toEqual([{ id: '-100123', name: 'Nhà mình' }]);
  // Luu: token chi tra ve 4 ky tu cuoi
  const saved = await api('/telegram/config', { enabled: true, token: TOKEN, chatIds: '-100123', events: { ring: true, missed: true, declined: true, call: true } });
  expect(saved.status).toBe(200);
  expect(JSON.stringify(saved.j)).not.toContain(TOKEN);
  expect(saved.j).toMatchObject({ enabled: true, hasToken: true, tokenTail: TOKEN.slice(-4), chatIds: ['-100123'] });
  // Luu lai khong co token -> giu token cu
  expect((await api('/telegram/config', { enabled: true, token: '', chatIds: ['-100123'], events: { ring: true, missed: true, declined: true, call: true } })).j.hasToken).toBe(true);
  // Gui thu
  const t = await api('/telegram/test', {});
  expect(t.j.ok).toBe(true);
  expect(hits.some((h) => h.method === 'sendMessage' && h.body.includes('-100123'))).toBe(true);

  // Chuong cong gia: do chuong 5 s, khong ai nghe
  expect((await api('/door/config', { ringPanels: [], ringS: 5, gateS: 3 })).status).toBe(200);
  const sn = (snapSrv.address() as AddressInfo).port;
  door = new WebSocket(`ws://127.0.0.1:${srv.wsPort}/?id=esp32-aabbccddee01&door=1&sn=${sn}&mj=0&name=${encodeURIComponent('Cổng trước')}`);
  await new Promise<void>((r, j) => { door!.once('open', () => r()); door!.once('error', j); });
  await sleep(300);
  hits = [];
  door.send(Buffer.from([12, 1, 3, 1]));   // DeviceEvent Doorbell
  await until(() => hits.filter((h) => h.method === 'sendPhoto').length >= 1, 6000, 'anh bam chuong');
  const p1 = hits.find((h) => h.method === 'sendPhoto')!;
  expect(p1.ct).toContain('multipart/form-data');
  expect(Buffer.from(p1.body, 'latin1').toString('utf8')).toContain('Có người bấm chuông');
  await until(() => hits.filter((h) => h.method === 'sendPhoto').length >= 2, 12_000, 'anh chuong nho');
  const p2 = Buffer.from(hits.filter((h) => h.method === 'sendPhoto')[1].body, 'latin1').toString('utf8');
  expect(p2).toContain('Chuông cổng nhỡ');
  expect(p2).toContain('Cổng trước');
  expect(p2).toContain('image/jpeg');
  // Token khong bao gio ra log
  expect(srv.log()).not.toContain(TOKEN);
});
