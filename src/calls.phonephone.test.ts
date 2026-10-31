// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// DIEN THOAI <-> DIEN THOAI (ca hai dau deu la phien web /calls/web) — TIENG PHAI DI HAI CHIEU.
//
// Truoc day: `bridgePanelWeb()` chi noi mic MAN <-> phien web, con `webMessage` chi chuyen PCM khi mot dau la
// `panel`. Khi ca hai dau deu la `kind:'web'` (dien thoai A goi dien thoai B qua call-web.html, B bam "Nghe" ->
// app mo call-web.html?call= va `join()` doi `c.to` thanh phien web cua B) thi KHONG co duong nao chuyen PCM
// -> hai may nghe thay im lang (man P4 <-> dien thoai van co tieng vi co `panel`).
//
// Test chay HTTP + WebSocket THAT tren 127.0.0.1 (giong src/calls.join.test.ts): chi thay phan CAN THIET cua
// deviceManager (man hinh dang ket noi, mo trang cuoc goi, Thong bao).
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

import { finish, handleCallsApi, handleCallsUpgrade, setCallHooks, state } from './calls.js';
import { handlePhoneApi } from './phones.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';

const PHONE_A = 'phone-aaa111';
const PHONE_B = 'phone-bbb222';
const st = (id: string) => state(id) as Record<string, unknown> & { state: string; from: string; to: string; phone?: string; reason?: string };

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
  server.on('upgrade', (req, socket, head) => { if (!handleCallsUpgrade(req, socket, head)) socket.destroy(); });
  await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

interface Page {
  id: string; ws: WebSocket; closed: Promise<void>;
  /** Cho tin JSON kieu `type` (hoac tin nhi phan khi type = 'bin'). */
  wait(type: string): Promise<any>;
  send(o: unknown): void;
  sendBin(b: Buffer): void;
}

/** Mot trang goi trong trinh duyet / WebView cua dien thoai: WS /calls/web?name=…, cho `hello`. */
async function openPage(name: string, id: string): Promise<Page> {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/calls/web?name=${encodeURIComponent(name)}&id=${encodeURIComponent(id)}`);
  ws.binaryType = 'arraybuffer';
  sockets.push(ws);
  const queue: any[] = [];
  ws.on('message', (d, bin) => { queue.push(bin ? { type: 'bin', bin: Buffer.from(d as Buffer) } : JSON.parse(d.toString())); });
  const closed = new Promise<void>((ok) => ws.on('close', () => ok()));
  const wait = async (type: string): Promise<any> => {
    for (let i = 0; i < 900; i++) {                      // ~9 s
      for (let j = 0; j < queue.length; j++) {
        if (queue[j].type === type || (type === 'bin' && Buffer.isBuffer(queue[j].bin))) return queue.splice(j, 1)[0];
      }
      await new Promise((ok) => setTimeout(ok, 10));
    }
    throw new Error(`khong nhan duoc tin "${type}"`);
  };
  const hello = await wait('hello');
  const page: Page = {
    id: hello.id as string, ws, closed,
    wait,
    send: (o) => ws.send(JSON.stringify(o)),
    sendBin: (b) => ws.send(b),
  };
  return page;
}

const post = (path: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  .then((r) => r.json().then((j) => ({ code: r.status, body: j as any })));

/** Mot khung tieng 20 ms (320 mau s16le) voi gia tri dua vao de so sanh tung byte. */
const frame = (v: number, n = 320): Buffer => {
  const b = Buffer.alloc(1 + n * 2);
  b[0] = 1;                                             // 0x01 = PCM
  for (let i = 0; i < n; i++) b.writeInt16LE(i % 2 ? v : -v, 1 + i * 2);
  return b;
};

beforeEach(async () => {
  screens.list = [];
  setCallHooks({ name: () => undefined });
  setPhoneStore(new PhoneStore(null));
  phones.register({ id: PHONE_A, name: 'Máy A', url: '' }, 1000);
  phones.register({ id: PHONE_B, name: 'Máy B', url: '' }, 1000);
  await boot();
});

afterEach(async () => {
  for (const id of live.splice(0)) finish(id, 'Hết');
  for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } }
  await new Promise((ok) => setTimeout(ok, 60));
  const srv = server; server = null;
  if (srv) await new Promise<void>((ok) => srv.close(() => ok()));
});

describe('dien thoai <-> dien thoai: PCM 0x01 di HAI CHIEU giua hai phien web', () => {
  it('A goi B (B bam Nghe qua call-web.html?call=): A gui -> B nhan, B gui -> A nhan', async () => {
    // A la trang goi trong trinh duyet/WebView cua may A (id ben vung).
    const a = await openPage('Máy A · trình duyệt', 'browser-aaa11111');
    // B bam "Nghe" trong app -> app mo call-web.html?call=<id>&phone=<B> -> trang B mo WS va gui 'join'.
    const b = await openPage('Máy B · trình duyệt', 'browser-bbb22222');

    // 1. A goi dien thoai B (danh ba: muc "Điện thoại").
    a.send({ type: 'start', to: PHONE_B });
    const started = await a.wait('started');
    expect(started).toMatchObject({ ok: true });
    const callId = started.call as string;
    live.push(callId);
    expect(st(callId)).toMatchObject({ state: 'ringing', from: a.id, to: PHONE_B });

    // 2. App cua B thay cuoc goi roi bam "Nghe" (POST /app/answer) TRUOC khi mo WebView.
    expect((await post(`/app/answer?phone=${PHONE_B}&call=${callId}`)).code).toBe(200);
    expect(st(callId).state).toBe('active');

    // 3. WebView cua B join -> c.to doi thanh phien web cua B (c.phone giu id may B).
    b.send({ type: 'join', call: callId, phone: PHONE_B });
    expect(await b.wait('joined')).toMatchObject({ type: 'joined', ok: true, call: callId });
    expect(st(callId)).toMatchObject({ state: 'active', to: b.id, phone: PHONE_B });

    // 4. TIENG A -> B: khung 0x01 cua A phai den NGUYEN VEN o WS cua B.
    const up = frame(1200);
    a.sendBin(up);
    const toB = await b.wait('bin');
    expect(toB.bin[0]).toBe(1);
    expect(Buffer.from(toB.bin.subarray(1)).equals(up.subarray(1))).toBe(true);

    // 5. TIENG B -> A: chieu nguoc lai cung phai chay.
    const down = frame(700);
    b.sendBin(down);
    const toA = await a.wait('bin');
    expect(toA.bin[0]).toBe(1);
    expect(Buffer.from(toA.bin.subarray(1)).equals(down.subarray(1))).toBe(true);

    // 6. Tat mic cua A -> khong con tieng tu A sang B.
    a.send({ type: 'mute', on: true });
    await new Promise((ok) => setTimeout(ok, 80));
    a.sendBin(frame(1500));
    let leaked = false;
    try { await Promise.race([b.wait('bin').then(() => { leaked = true; }), new Promise((ok) => setTimeout(ok, 300))]); } catch { /* */ }
    expect(leaked).toBe(false);
  });

  it('hai phien web thuan (bat ky trinh duyet <-> dien thoai): accept -> PCM hai chieu', async () => {
    const a = await openPage('Trình duyệt A', 'browser-ccc33333');
    const b = await openPage('Trình duyệt B', 'browser-ddd44444');

    a.send({ type: 'start', to: b.id });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    expect(await b.wait('incoming')).toMatchObject({ type: 'incoming', call: callId, from: a.id });

    b.send({ type: 'accept' });
    expect(await a.wait('active')).toMatchObject({ type: 'active', call: callId });
    expect(await b.wait('active')).toMatchObject({ type: 'active', call: callId });

    const up = frame(900);
    a.sendBin(up);
    const gotB = await b.wait('bin');
    expect(Buffer.from(gotB.bin.subarray(1)).equals(up.subarray(1))).toBe(true);

    const down = frame(450);
    b.sendBin(down);
    const gotA = await a.wait('bin');
    expect(Buffer.from(gotA.bin.subarray(1)).equals(down.subarray(1))).toBe(true);
  });

  it('A mat WS (dong tab / WebView bi huy) -> B nhan "ended" sau an han', async () => {
    const a = await openPage('Trình duyệt A', 'browser-eee55555');
    const b = await openPage('Trình duyệt B', 'browser-fff66666');
    a.send({ type: 'start', to: b.id });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    b.send({ type: 'accept' });
    await b.wait('active');
    await a.wait('active');

    a.ws.close();                                          // dong A -> B phai biet cuoc goi ket thuc
    const end = await b.wait('ended');                     // WS_GRACE_MS = 6 s
    expect(end).toMatchObject({ type: 'ended', call: callId });
    expect(st(callId).state).toBe('ended');
  }, 20_000);

  it('B join TRUOC khi app kip POST /app/answer -> /app/answer van ok (khong 409)', async () => {
    const a = await openPage('Máy A · trình duyệt', 'browser-ggg77777');
    const b = await openPage('Máy B · trình duyệt', 'browser-hhh88888');
    a.send({ type: 'start', to: PHONE_B });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);

    // WebView cua B mo nhanh hon HTTP: trang join khi cuoc goi con `ringing` -> join() tu accept().
    b.send({ type: 'join', call: callId, phone: PHONE_B });
    expect(await b.wait('joined')).toMatchObject({ ok: true, call: callId });
    expect(st(callId).state).toBe('active');

    // App van POST /app/answer sau do (id may, khong phai id phien web): phai la ok, khong phai 409.
    expect((await post(`/app/answer?phone=${PHONE_B}&call=${callId}`)).code).toBe(200);
    // Va tieng van chay hai chieu.
    const up = frame(1100);
    a.sendBin(up);
    expect(Buffer.from((await b.wait('bin')).bin.subarray(1)).equals(up.subarray(1))).toBe(true);
    const down = frame(500);
    b.sendBin(down);
    expect(Buffer.from((await a.wait('bin')).bin.subarray(1)).equals(down.subarray(1))).toBe(true);
  });

  it('WS cua A rot roi noi lai (phien MOI cung id, resume) -> tieng van di ca hai chieu', async () => {
    const a = await openPage('Máy A · trình duyệt', 'browser-iii99999');
    const b = await openPage('Máy B · trình duyệt', 'browser-jjj00000');
    a.send({ type: 'start', to: b.id });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    b.send({ type: 'accept' });
    await a.wait('active');
    await b.wait('active');

    a.ws.close();                                          // WebView cua A bi an -> WS rot
    const a2 = await openPage('Máy A · trình duyệt', 'browser-iii99999');
    a2.send({ type: 'resume', call: callId });
    expect(await a2.wait('resumed')).toMatchObject({ ok: true, call: callId, state: 'active' });

    // Chieu B -> A (phien MOI) va chieu A (phien moi) -> B deu phai chay.
    const down = frame(800);
    b.sendBin(down);
    expect(Buffer.from((await a2.wait('bin')).bin.subarray(1)).equals(down.subarray(1))).toBe(true);
    const up = frame(300);
    a2.sendBin(up);
    expect(Buffer.from((await b.wait('bin')).bin.subarray(1)).equals(up.subarray(1))).toBe(true);
  });
});
