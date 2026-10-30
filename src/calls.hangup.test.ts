// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (23/11/2026) GD10 — 2 LOI NGUOI DUNG BAO (tai hien tren may that):
//   1. NGUOI GOI bam "Ket thuc" -> man hinh cuoc goi KHONG dong, dong ho van dem; ben kia cung khong duoc bao.
//   2. Ben NHAN bam "Tu choi" -> may goi di treo o man "Đang gọi" mai mai (chi mat tin 'ended' la treo vinh vien).
// Goc chung: phien web (WS /calls/web) la thuc the TAM — moi lan WS rot roi noi lai la mot id MOI, trong khi cuoc goi
// van tro toi id CU; 'ended' chi gui cho [c.from, c.to] va `{type:'hangup'}` chi duoc xu ly khi `w.call` con dung.
//
// Test nay chay HTTP + WebSocket THAT tren 127.0.0.1 (nhu calls.join.test.ts) va kiem tra dung 3 yeu cau:
//   (a) nguoi goi bam ket thuc  -> server phat 'ended' cho CA HAI phien, state = ended;
//   (b) tu choi                 -> phien GOI DI nhan 'ended' voi ly do "Từ chối";
//   (c) WS rot roi noi lai      -> phien moi van ket thuc duoc cuoc goi va van nhan 'ended' (khong con treo UI).
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

const PANEL = 'p4-bep';
const PHONE = 'phone-abc123';
const st = (id: string) => state(id) as { state: string; reason?: string; from?: string; to?: string };

interface Page { id: string; ws: WebSocket; send: (m: unknown) => void; wait: (type: string) => Promise<any>; close: () => void }

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

/** Mot trang goi (tab "Gọi" / call-web.html): mo WS /calls/web, cho `hello`, gom tin nhan theo loai. */
function openPage(name = 'Trình duyệt'): Promise<Page> {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/calls/web?name=` + encodeURIComponent(name));
  ws.binaryType = 'arraybuffer';
  sockets.push(ws);
  const queue: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.on('message', (d, bin) => {
    if (bin) return;                                     // khung tieng/hinh (0x01/0x02) — test nay khong dung
    const m = JSON.parse(d.toString());
    const w = waiters.shift();
    if (w) w(m); else queue.push(m);
  });
  const next = (): Promise<any> => new Promise<any>((ok, bad) => {
    const m = queue.shift();
    if (m) return void ok(m);
    const t = setTimeout(() => bad(new Error('khong nhan duoc tin nhan WS')), 2000);
    waiters.push((x) => { clearTimeout(t); ok(x); });
  });
  const self: Page = {
    id: '',
    ws,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    // Doi mot tin theo loai: bo qua cac tin khac (vd 'active' toi truoc 'ended' khi dang do chuong).
    wait: (type: string): Promise<any> => next().then((m) => (m.type === type ? m : waitFor(type))),
    close: () => { try { ws.close(); } catch { /* */ } },
  };
  const waitFor = (type: string): Promise<any> => self.wait(type);
  return next().then((hello) => { self.id = hello.id as string; return self; });
}

const post = (path: string) => fetch(base + path, { method: 'POST', body: '{}' })
  .then((r) => r.json().then((j) => ({ code: r.status, body: j as any })));

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

/** Hai trang web: A goi B (B dang do chuong). */
async function webToWeb(): Promise<{ a: Page; b: Page; callId: string }> {
  const a = await openPage('A');
  const b = await openPage('B');
  a.send({ type: 'start', to: b.id });
  const started = await a.wait('started');
  expect(started.ok).toBe(true);
  const callId = started.call as string;
  live.push(callId);
  const inc = await b.wait('incoming');
  expect(inc.call).toBe(callId);
  return { a, b, callId };
}

describe('(a) NGUOI GOI bam "Kết thúc"', () => {
  it('server phat ended cho CA HAI phien va state = ended', async () => {
    const { a, b, callId } = await webToWeb();
    expect(st(callId).state).toBe('ringing');

    // Trang nguoi goi bam "Kết thúc" -> gui kem id cuoc goi (nhu call-web.html GD10).
    a.send({ type: 'hangup', call: callId });

    const endA = await a.wait('ended');
    expect(endA).toMatchObject({ type: 'ended', call: callId, reason: 'Đã kết thúc' });
    const endB = await b.wait('ended');
    expect(endB).toMatchObject({ type: 'ended', call: callId, reason: 'Đã kết thúc' });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Đã kết thúc' });
  });

  it('cuoc goi DANG NOI CHUYEN: nguoi goi cup -> ca hai phien nhan ended', async () => {
    const { a, b, callId } = await webToWeb();
    b.send({ type: 'accept' });
    const active = await a.wait('active');
    expect(active.call).toBe(callId);
    expect(st(callId).state).toBe('active');

    a.send({ type: 'hangup', call: callId });
    expect(await a.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    expect(await b.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Đã kết thúc' });
  });
});

describe('(b) ben NHAN bam "Từ chối"', () => {
  it('dien thoai tu choi -> phien GOI DI nhan ended voi ly do "Từ chối"', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const started = await a.wait('started');
    const callId = started.call as string;
    live.push(callId);
    expect(st(callId).state).toBe('ringing');

    expect((await post(`/app/decline?phone=${PHONE}&call=${callId}`)).code).toBe(200);

    const endA = await a.wait('ended');
    expect(endA).toMatchObject({ type: 'ended', call: callId, reason: 'Từ chối' });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Từ chối' });
  });

  it('trang web tu choi -> nguoi goi nhan ended "Từ chối"', async () => {
    const { a, b, callId } = await webToWeb();
    b.send({ type: 'decline', call: callId });

    expect(await a.wait('ended')).toMatchObject({ call: callId, reason: 'Từ chối' });
    expect(await b.wait('ended')).toMatchObject({ call: callId, reason: 'Từ chối' });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Từ chối' });
  });
});

describe('(c) WS rot roi noi lai (phien web MOI)', () => {
  it('{type:"resume"} gan lai phien moi: van nhan ended khi ben kia tu choi', async () => {
    const { a, b, callId } = await webToWeb();

    // Nguoi goi mat WS (WebView bi an / ingress dong idle) roi noi lai thanh phien MOI.
    a.close();
    const a2 = await openPage('A (noi lai)');
    a2.send({ type: 'resume', call: callId });
    const resumed = await a2.wait('resumed');
    expect(resumed).toMatchObject({ ok: true, call: callId, state: 'ringing' });
    expect(st(callId).from).toBe(a2.id);          // c.from da duoc gan lai cho phien moi

    // Ben nhan tu choi -> phien VUA NOI LAI phai nhan duoc ended (truoc day khong bao gio nhan).
    b.send({ type: 'decline', call: callId });
    expect(await a2.wait('ended')).toMatchObject({ call: callId, reason: 'Từ chối' });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Từ chối' });
  });

  it('phien moi bam "Ket thuc" (chua kip resume) van ket thuc duoc cuoc goi', async () => {
    const { a, b, callId } = await webToWeb();
    a.close();
    const a2 = await openPage('A (noi lai)');

    // Phien moi KHONG co `w.call` (server chua gan lai) — truoc day tin nay bi bo qua, cuoc goi chay mai.
    a2.send({ type: 'hangup', call: callId });

    expect(await a2.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    expect(await b.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Đã kết thúc' });
  });

  it('mat WS khong ket thuc cuoc goi ngay (co an han WS_GRACE_MS)', async () => {
    const { a, callId } = await webToWeb();
    a.close();
    await new Promise((ok) => setTimeout(ok, 250));
    expect(st(callId).state).toBe('ringing');     // con an han 6 s -> noi lai kip
  });

  it('cuoc goi da ket thuc roi moi resume -> server tra ended de trang dong man hinh', async () => {
    const { a, callId } = await webToWeb();
    a.close();
    const a2 = await openPage('A (noi lai)');
    finish(callId, 'Đã kết thúc');
    a2.send({ type: 'resume', call: callId });
    expect(await a2.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
  });
});
