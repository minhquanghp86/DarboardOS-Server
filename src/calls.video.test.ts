// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (17/11/2026) GD9 — HINH TRONG CUOC GOI DIEN THOAI <-> MAN P4 (loi "P4 khong nhan duoc hinh").
//
// Hinh camera cua dien thoai chi ton tai trong PHIEN WEB cua trang `call-web.html?call=` (khung 0x02 = H.264 AVCC do
// WebCodecs cua trang ban len WS /calls/web). Man P4 lay `peer` tu GET /calls/state: trong khoang app da
// POST /app/answer nhung trang chua kip `join`, `state.to` van la ID MAY -> P4 mo `/call/video?dev=<ID MAY>`.
// Test nay chay HTTP + WebSocket THAT tren 127.0.0.1 va khoa lai:
//   1. P4 xin hinh bang ID MAY  -> VAN nhan duoc khung hinh cua dien thoai (truoc day: socket bi dong 4004),
//   2. P4 xin hinh bang phien web (`web-…`) -> nhan duoc (duong cu, khong duoc vo),
//   3. nguon KHONG thuoc cuoc goi -> khong nhan duoc khung nao (videoAllowed),
//   4. dien thoai tat camera (camOff) -> khong chuyen khung hinh nua.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const screens = vi.hoisted(() => ({ list: [] as { id: string; w: number; h: number; cam: boolean; sd: boolean; spk: boolean; mic: boolean }[] }));

vi.mock('./deviceManager.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./deviceManager.js')>();
  return {
    ...real,
    connectedScreens: () => screens.list,
    openRingPage: () => true,
    answerDoorbell: () => true,
    closeDoorbell: () => true,
    postNotify: () => ({ ok: true }),
  };
});

import { finish, handleCallsApi, handleCallsUpgrade, setCallHooks, state, videoSourceOf } from './calls.js';
import { handleCallUpgrade } from './callBridge.js';
import { handlePhoneApi } from './phones.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';

const PANEL = 'p4-bep';
const PHONE = 'phone-abc123';
const st = (id: string) => state(id) as { state: string; to: string; phone?: string };

let server: http.Server | null = null;
let base = '';
const live: string[] = [];
const sockets: WebSocket[] = [];

async function boot(): Promise<void> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (handleCallsApi(req, res, url)) return;
    if (handlePhoneApi(req, res, url)) return;
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (handleCallUpgrade(req, socket, head)) return;
    if (handleCallsUpgrade(req, socket, head)) return;
    socket.destroy();
  });
  await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const post = (path: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  .then((r) => r.json().then((j) => ({ code: r.status, body: j as any })));

/** Hang doi tin nhan cua mot socket: `nextText()` / `nextBin()` bo qua tin khong lien quan. */
function inbox(ws: WebSocket, queue: any[] = [], waiters: ((m: any) => void)[] = []) {
  ws.on('message', (d, bin) => {
    const m = { bin: bin ? Buffer.from(d as Buffer) : null, text: bin ? null : JSON.parse(d.toString()) };
    const w = waiters.shift();
    if (w) w(m); else queue.push(m);
  });
  const next = (): Promise<any> => new Promise((ok, bad) => {
    const m = queue.shift();
    if (m) return void ok(m);
    const t = setTimeout(() => bad(new Error('khong nhan duoc tin nhan WS')), 3000);
    waiters.push((x) => { clearTimeout(t); ok(x); });
  });
  return { next, nextBin: async () => { for (;;) { const m = await next(); if (m.bin) return m.bin; } } };
}

/** Trang call-web.html?call= cua dien thoai: WS /calls/web, cho `hello` -> tra ve id phien. */
function openPhonePage(): Promise<{ id: string; ws: WebSocket; inbox: ReturnType<typeof inbox> }> {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/calls/web?name=` + encodeURIComponent('Dashboard · điện thoại'));
  ws.binaryType = 'arraybuffer';
  sockets.push(ws);
  const ib = inbox(ws);
  return new Promise((ok, bad) => {
    const t = setTimeout(() => bad(new Error('khong co hello')), 3000);
    ib.next().then((m) => { clearTimeout(t); ok({ id: m.text.id as string, ws, inbox: ib }); }).catch(bad);
  });
}

/** Man P4 mo WS /call/video (nguoi xem hinh cua dien thoai). */
function watchVideo(dev: string, callId: string): { ws: WebSocket; inbox: ReturnType<typeof inbox> } {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/call/video?dev=${encodeURIComponent(dev)}&call=${encodeURIComponent(callId)}`);
  ws.binaryType = 'arraybuffer';
  sockets.push(ws);
  return { ws, inbox: inbox(ws) };
}

/** Khung 0x02 cua trang web: [2][key u8][ts u32le] + H.264 AVCC. */
function videoFrame(payload: Buffer, key = true, ts = 1234): Buffer {
  const h = Buffer.alloc(6);
  h.writeUInt8(2, 0); h.writeUInt8(key ? 1 : 0, 1); h.writeUInt32LE(ts, 2);
  return Buffer.concat([h, payload]);
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Man goi dien thoai, app da "Nghe" (state = active, to = ID MAY) nhung trang chua join. */
async function callAnsweredNotJoined(): Promise<string> {
  const r = await post(`/calls/start?from=${PANEL}&to=${PHONE}`);
  expect(r.code).toBe(200);
  const callId = r.body.call as string;
  live.push(callId);
  expect((await post(`/app/answer?phone=${PHONE}&call=${callId}`)).code).toBe(200);
  return callId;
}

beforeEach(async () => {
  screens.list = [{ id: PANEL, w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
  setCallHooks({ name: (id) => (id === PANEL ? 'Màn hình bếp' : undefined) });
  setPhoneStore(new PhoneStore(null));
  phones.register({ id: PHONE, name: 'Pixel 8', url: 'https://hass.local/x/call-web.html' }, 1000);
  await boot();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of live.splice(0)) finish(id, 'Hết');
  for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } }
  const srv = server; server = null;
  if (srv) await new Promise<void>((ok) => srv.close(() => ok()));
});

describe('/call/video — man P4 nhan HINH cua dien thoai', () => {
  it('P4 xin hinh bang ID MAY (state.to truoc khi join) -> VAN nhan duoc khung H.264', async () => {
    const callId = await callAnsweredNotJoined();
    expect(st(callId).to).toBe(PHONE);          // chua join: to = ID MAY  <-- P4 doc duoc gia tri nay truoc

    // P4 mo /call/video?dev=<ID MAY> (dung nhu trang call.html lam voi `peer` tu /calls/state).
    const view = watchVideo(PHONE, callId);
    await new Promise<void>((ok) => view.ws.on('open', () => ok()));

    // Dien thoai `join`: tu day hinh 0x02 nam trong phien web.
    const page = await openPhonePage();
    page.ws.send(JSON.stringify({ type: 'join', call: callId, phone: PHONE }));
    const joined = await page.inbox.next();
    expect(joined.text).toMatchObject({ type: 'joined', ok: true });
    expect(videoSourceOf(PHONE)).toBe(page.id);   // id may -> phien web cua trang goi

    // Ngay khi biet nguon, server nho trang goi gui KHUNG KHOA (tin {type:'keyframe'}) — dung nhu that: trang bat
    // forceKey roi gui khung ke tiep. Test cho tin do roi moi gui hinh (giong bo ma hoa 15 hinh/giay cua may).
    let asked = false;
    for (let i = 0; i < 20 && !asked; i++) {
      const m = await page.inbox.next();
      asked = !!m.text && m.text.type === 'keyframe';
    }
    expect(asked).toBe(true);

    // Dien thoai gui MOT khung hinh -> man P4 phai nhan duoc (key + ts + payload y nguyen).
    const payload = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xe0, 0x1f, 0xaa, 0xbb]);
    page.ws.send(videoFrame(payload, true, 4321));
    const got = await view.inbox.nextBin();
    expect(got.readUInt8(0)).toBe(1);                    // khung khoa
    expect(got.readUInt32LE(1)).toBe(4321);              // ts (ms)
    expect(got.subarray(5).equals(payload)).toBe(true);  // du lieu H.264 AVCC nguyen ven
  });

  it('P4 xin hinh bang phien web (web-…) -> van nhan duoc (duong cu khong bi vo)', async () => {
    const callId = await callAnsweredNotJoined();
    const page = await openPhonePage();
    page.ws.send(JSON.stringify({ type: 'join', call: callId, phone: PHONE }));
    await page.inbox.next();
    expect(st(callId).to).toBe(page.id);

    const view = watchVideo(page.id, callId);
    await new Promise<void>((ok) => view.ws.on('open', () => ok()));

    const payload = Buffer.from([1, 2, 3, 4, 5, 6]);
    page.ws.send(videoFrame(payload, false, 10));
    const got = await view.inbox.nextBin();
    expect(got.readUInt8(0)).toBe(0);
    expect(got.subarray(5).equals(payload)).toBe(true);
  });

  it('nguon KHONG thuoc cuoc goi -> khong chuyen khung hinh', async () => {
    const callId = await callAnsweredNotJoined();
    const page = await openPhonePage();
    page.ws.send(JSON.stringify({ type: 'join', call: callId, phone: PHONE }));
    await page.inbox.next();

    // Nguoi xem la mot man khac (khong co trong cuoc goi) — server tu choi: socket dong, khong co khung nao.
    const view = watchVideo('p4-khach', callId);
    const closed = new Promise<number>((ok) => view.ws.on('close', (code) => ok(code)));
    expect(await closed).toBe(4004);

    // Va neu xin dung nguon cua cuoc goi nhung cuoc goi KHAC id -> khong gui.
    const ok2 = watchVideo(PHONE, 'call-khong-ton-tai');
    await new Promise<void>((ok) => ok2.ws.on('open', () => ok()));
    page.ws.send(videoFrame(Buffer.from([9, 9, 9])));
    await sleep(150);
    // khong nhan duoc khung: hang doi rong (moi tin deu la text JSON cua /calls/web, khong lien quan)
    expect(ok2.inbox.nextBin() instanceof Promise).toBe(true);
    ok2.ws.close();
  });

  it('dien thoai TAT camera trong cuoc goi -> khong chuyen hinh nua', async () => {
    const callId = await callAnsweredNotJoined();
    const page = await openPhonePage();
    page.ws.send(JSON.stringify({ type: 'join', call: callId, phone: PHONE }));
    await page.inbox.next();

    const view = watchVideo(PHONE, callId);
    await new Promise<void>((ok) => view.ws.on('open', () => ok()));

    // Trang web bao tat camera: {type:'cam', on:true} -> camOff chua id phien web.
    page.ws.send(JSON.stringify({ type: 'cam', on: true }));
    await sleep(100);
    page.ws.send(videoFrame(Buffer.from([0xde, 0xad])));
    await sleep(150);

    // Mo lai camera -> khung di tiep (khong bi treo).
    page.ws.send(JSON.stringify({ type: 'cam', on: false }));
    await sleep(100);
    page.ws.send(videoFrame(Buffer.from([0xbe, 0xef]), true, 77));
    const got = await view.inbox.nextBin();
    expect(got.readUInt32LE(1)).toBe(77);
    expect(got.subarray(5).equals(Buffer.from([0xbe, 0xef]))).toBe(true);
  });
});
