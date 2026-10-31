// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/12/2026) NHAT KY CUOC GOI — kiem tra API GET /calls/log tren HTTP + WebSocket THAT (nhu calls.hangup.test.ts).
//
// (03/12/2026) SUA LOI "NHAT KY CHI HIEN CHIEU GOI DI": bo test cu chi kiem MOT chieu (hoac doc thang `callLog.list`),
// nen khong bat duoc loi that: moi ben chi thay muc cua minh va muc "gọi đến" cua DIEN THOAI nam ngoai tam voi.
// Nay moi kich ban deu kiem CA HAI BEN qua HTTP that:
//   (a) A goi B, KHONG AI NGHE            -> A: out/missed, B: in/missed;
//   (b) A goi B, B NGHE, 3 s roi ket thuc -> A: out/answered ~3000, B: in/answered ~3000;
//   (c) A goi B, B TU CHOI                -> A: out/declined, B: in/declined (byMe = B);
//   (d) `self` khong lien quan            -> khong thay muc nao;
//   (e) DIEN THOAI: trang call-web.html?call=&phone= cua may (id PHIEN WEB) phai thay muc "gọi đến" cua chinh no;
//   (f) `?limit=` + moi nhat truoc; (g) xoa nhat ky.
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

import { finish, handleCallsApi, handleCallsUpgrade, setCallHooks } from './calls.js';
import { CallLog, setCallLog, type CallLogItem } from './callLog.js';
import { handlePhoneApi } from './phones.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';

const PANEL = 'p4-bep';
const PHONE = 'phone-abc123';

interface Page { id: string; send: (m: unknown) => void; wait: (type: string) => Promise<any>; close: () => void }

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

function openPage(name = 'Trình duyệt'): Promise<Page> {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/calls/web?name=` + encodeURIComponent(name));
  ws.binaryType = 'arraybuffer';
  sockets.push(ws);
  const queue: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.on('message', (d, bin) => {
    if (bin) return;
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
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    wait: (type: string): Promise<any> => next().then((m) => (m.type === type ? m : self.wait(type))),
    close: () => { try { ws.close(); } catch { /* */ } },
  };
  return next().then((hello) => { self.id = hello.id as string; return self; });
}

/** GET /calls/log?self=<id> — nhật ký của MỘT thiết bị, mới nhất trước. */
const logOf = (self: string, limit?: number): Promise<CallLogItem[]> =>
  fetch(`${base}/calls/log?self=${encodeURIComponent(self)}` + (limit ? `&limit=${limit}` : ''), { cache: 'no-store' })
    .then((r) => r.json())
    .then((j) => {
      expect(j.ok).toBe(true);
      return j.items as CallLogItem[];
    });
const post = (path: string) => fetch(base + path, { method: 'POST', body: '{}' })
  .then((r) => r.json().then((j) => ({ code: r.status, body: j as any })));
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

beforeEach(async () => {
  screens.list = [{ id: PANEL, w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
  setCallHooks({ name: (id) => (id === PANEL ? 'Màn hình bếp' : undefined) });
  setPhoneStore(new PhoneStore(null));
  phones.register({ id: PHONE, name: 'Pixel 8', url: 'https://hass.local/x/call-web.html' }, 1000);
  setCallLog(new CallLog(null));            // nhat ky trong bo nho: test khong ghi vao /data
  await boot();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const id of live.splice(0)) finish(id, 'Hết');
  for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } }
  const srv = server; server = null;
  if (srv) await new Promise<void>((ok) => srv.close(() => ok()));
});

describe('(a) A goi B — KHONG AI NGHE: ca hai ben deu thay "nho", dung chieu', () => {
  it('A: out/missed · B: in/missed (moi ben DUNG MOT muc)', async () => {
    // A = trinh duyet, B = MAN HINH (khong ai bam nghe) -> het RING_S 30 s.
    const a = await openPage('A');
    vi.useFakeTimers();
    a.send({ type: 'start', to: PANEL });
    const started = await a.wait('started');
    expect(started.ok).toBe(true);
    const callId = started.call as string;
    live.push(callId);

    vi.advanceTimersByTime(31_000);           // RING_S = 30 s -> 'Không trả lời'
    await a.wait('ended');                     // nguoi goi nhan 'ended'
    vi.useRealTimers();

    const out = await logOf(a.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: callId, self: a.id, dir: 'out', peerId: PANEL, peerKind: 'panel', peerName: 'Màn hình bếp',
      state: 'missed', startedAt: 0, durationMs: 0, byMe: false,
    });

    const inc = await logOf(PANEL);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({
      id: callId, self: PANEL, dir: 'in', peerId: a.id, peerKind: 'web', peerName: 'A',
      state: 'missed', startedAt: 0, durationMs: 0, byMe: false,
    });
  });
});

describe('(b) A goi B, B NGHE, 3 s sau ket thuc: "answered" + thoi luong ~3000 o CA HAI ben', () => {
  it('A: out/answered dur≈3000 · B: in/answered dur≈3000', async () => {
    const a = await openPage('A');
    const b = await openPage('B');
    vi.useFakeTimers();
    a.send({ type: 'start', to: b.id });
    const started = await a.wait('started');
    const callId = started.call as string;
    live.push(callId);
    await b.wait('incoming');

    b.send({ type: 'accept' });                // B nghe -> server ghi startedAt
    expect((await a.wait('active')).call).toBe(callId);
    await b.wait('active');
    vi.advanceTimersByTime(3_000);             // noi chuyen 3 s

    a.send({ type: 'hangup', call: callId });
    expect(await a.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    expect(await b.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    vi.useRealTimers();

    const out = await logOf(a.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: callId, self: a.id, dir: 'out', peerId: b.id, state: 'answered', byMe: true });
    expect(out[0].startedAt).toBeGreaterThan(0);
    expect(Math.abs(out[0].durationMs - 3_000)).toBeLessThanOrEqual(50);
    expect(out[0].endedAt - out[0].startedAt).toBe(out[0].durationMs);

    const inc = await logOf(b.id);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ id: callId, self: b.id, dir: 'in', peerId: a.id, peerKind: 'web', state: 'answered', byMe: false });
    expect(Math.abs(inc[0].durationMs - 3_000)).toBeLessThanOrEqual(50);
    expect(inc[0].durationMs).toBe(out[0].durationMs);       // mot cuoc goi = MOT thoi luong
  });
});

describe('(c) A goi B, B TU CHOI: "Tu choi" / "Da tu choi" (nhan khac nhau theo chieu)', () => {
  it('A: out/declined · B: in/declined, byMe = B, durationMs = 0', async () => {
    const a = await openPage('A');
    const b = await openPage('B');
    a.send({ type: 'start', to: b.id });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    await b.wait('incoming');

    b.send({ type: 'decline', call: callId });
    expect(await b.wait('ended')).toMatchObject({ call: callId, reason: 'Từ chối' });
    expect(await a.wait('ended')).toMatchObject({ call: callId, reason: 'Từ chối' });

    const out = await logOf(a.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ dir: 'out', state: 'declined', peerId: b.id, startedAt: 0, durationMs: 0, byMe: false });

    const inc = await logOf(b.id);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ dir: 'in', state: 'declined', peerId: a.id, startedAt: 0, durationMs: 0, byMe: true });
  });

  it('DIEN THOAI tu choi (POST /app/decline): may thay "Đã từ chối", nguoi goi thay "Từ chối"', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    expect((await post(`/app/decline?phone=${PHONE}&call=${callId}`)).code).toBe(200);
    await a.wait('ended');                                   // /app/decline -> 'ended' cho nguoi goi

    expect((await logOf(a.id))[0]).toMatchObject({ dir: 'out', state: 'declined', peerId: PHONE, peerKind: 'phone', byMe: false });
    expect((await logOf(PHONE))[0]).toMatchObject({ dir: 'in', state: 'declined', peerId: a.id, peerKind: 'web', byMe: true });
  });
});

describe('(d) thiet bi KHONG lien quan khong thay muc nao', () => {
  it('self la may khac -> 0 muc (nhat ky chi cua nguoi trong cuoc)', async () => {
    const a = await openPage('A');
    const b = await openPage('B');
    a.send({ type: 'start', to: b.id });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    await b.wait('incoming');
    b.send({ type: 'decline', call: callId });
    await a.wait('ended');

    expect(await logOf('may-khong-lien-quan')).toHaveLength(0);
    expect(await logOf(PANEL)).toHaveLength(0);              // man khac cung khong thay
    expect((await logOf(a.id))[0].id).toBe(callId);
    expect((await logOf(b.id))[0].id).toBe(callId);
  });
});

describe('(e) DIEN THOAI — trang call-web.html?call=&phone= (id PHIEN WEB) phai thay "gọi đến"', () => {
  it('man goi dien thoai -> may nghe + join: may thay in/answered qua CA id may lan id phien web', async () => {
    // 1. Man goi dien thoai
    const r = await (await fetch(`${base}/calls/start?from=${PANEL}&to=${PHONE}`, { method: 'POST' })).json() as any;
    expect(r.ok).toBe(true);
    const callId = r.call as string;
    live.push(callId);
    // 2. App thay cuoc goi den roi bam "Nghe"
    const inc = await (await fetch(`${base}/app/incoming?phone=${PHONE}`)).json() as any;
    expect(inc.call.id).toBe(callId);
    expect((await post(`/app/answer?phone=${PHONE}&call=${callId}`)).code).toBe(200);
    // 3. App mo call-web.html?call=...&phone=... -> trang mo WS /calls/web va join (id PHIEN WEB khac id may)
    const page = await openPage('Pixel 8 · Chrome');
    page.send({ type: 'join', call: callId, phone: PHONE });
    const joined = await page.wait('joined');
    expect(joined.ok).toBe(true);
    expect(page.id).not.toBe(PHONE);
    await sleep(1_100);                                      // noi chuyen ~1,1 s
    // 4. May ket thuc (nut "Kết thúc" cua trang -> app/hangup)
    expect((await post(`/app/hangup?phone=${PHONE}&call=${callId}`)).code).toBe(200);
    await page.wait('ended');

    // MUC "GOI DEN" cua may — hoi bang id PHIEN WEB cua trang (loi cu: 0 muc)
    const viaPage = await logOf(page.id);
    expect(viaPage).toHaveLength(1);
    expect(viaPage[0]).toMatchObject({ id: callId, self: page.id, dir: 'in', peerId: PANEL, peerKind: 'panel', peerName: 'Màn hình bếp', state: 'answered' });
    expect(viaPage[0].durationMs).toBeGreaterThan(500);
    // Cung cuoc goi do, hoi bang ID MAY -> cung mot muc, cung thoi luong
    const viaPhone = await logOf(PHONE);
    expect(viaPhone).toHaveLength(1);
    expect(viaPhone[0]).toMatchObject({ id: callId, dir: 'in', peerId: PANEL, state: 'answered' });
    expect(viaPhone[0].durationMs).toBe(viaPage[0].durationMs);
    // Nguoi goi: "gọi đi"
    const out = await logOf(PANEL);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: callId, dir: 'out', peerId: PHONE, peerKind: 'phone', state: 'answered' });
    expect(out[0].durationMs).toBe(viaPage[0].durationMs);
  });
});

describe('(f) API /calls/log', () => {
  it('limit=1 chi tra muc moi nhat; self khac khong thay nhat ky cua nguoi khac', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const first = (await a.wait('started')).call as string;
    live.push(first);
    await post(`/app/decline?phone=${PHONE}&call=${first}`);
    await a.wait('ended');

    a.send({ type: 'start', to: PHONE });
    const second = (await a.wait('started')).call as string;
    live.push(second);
    await post(`/app/decline?phone=${PHONE}&call=${second}`);
    await a.wait('ended');

    const all = await logOf(a.id);
    expect(all.map((i) => i.id)).toEqual([second, first]);       // moi nhat truoc
    expect(all.every((i) => i.dir === 'out')).toBe(true);
    expect((await logOf(a.id, 1)).map((i) => i.id)).toEqual([second]);
    expect((await logOf(PHONE)).map((i) => i.dir)).toEqual(['in', 'in']);
    expect(await logOf('may-khong-ton-tai')).toHaveLength(0);
  });

  it('may TU CHOI tu app (khong join): trang call-web.html?phone= cua may van thay "Đã từ chối"', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    await post(`/app/decline?phone=${PHONE}&call=${callId}`);
    await a.wait('ended');

    // Trang cua may chi khai id may qua `hello.phone` (app mo `call-web.html?phone=<id>`), KHONG join cuoc goi nay.
    const page = await openPage('Pixel 8 · Chrome');
    page.send({ type: 'hello', id: page.id, name: 'Pixel 8 · Chrome', kind: 'web', phone: PHONE });
    await sleep(150);                                        // de server xu ly `hello` (ghi w.phone)
    expect(await logOf(PHONE)).toHaveLength(1);
    const viaPage = await logOf(page.id);
    expect(viaPage).toHaveLength(1);
    expect(viaPage[0]).toMatchObject({ id: callId, self: page.id, dir: 'in', peerId: a.id, peerKind: 'web', state: 'declined' });
    // Xoa nhat ky bang id phien web cung xoa duoc cuoc goi cua may
    const body = await (await fetch(`${base}/calls/log/clear?self=${encodeURIComponent(page.id)}`, { method: 'POST' })).json() as any;
    expect(body).toEqual({ ok: true, removed: 1 });
    expect(await logOf(PHONE)).toHaveLength(0);
  });
});

describe('(g) XOA NHAT KY — POST /calls/log/clear', () => {
  it('?self=<id>: xoa cuoc goi lien quan -> {ok, removed:n}; muc cua may khac van con', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const first = (await a.wait('started')).call as string;
    live.push(first);
    await post(`/app/decline?phone=${PHONE}&call=${first}`);
    await a.wait('ended');
    expect(await logOf(a.id)).toHaveLength(1);

    const r = await fetch(`${base}/calls/log/clear?self=${encodeURIComponent(a.id)}`, { method: 'POST' });
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; removed: number };
    expect(body).toEqual({ ok: true, removed: 1 });              // 1 CUOC GOI (truoc day dem 2 muc)

    expect(await logOf(a.id)).toHaveLength(0);
    expect(await logOf(PHONE)).toHaveLength(0);
    expect((await fetch(`${base}/calls/log/clear?self=${encodeURIComponent(a.id)}`, { method: 'POST' })).status).toBe(200);
  });

  it('self rong: xoa TOAN BO nhat ky cua moi thiet bi', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const callId = (await a.wait('started')).call as string;
    live.push(callId);
    await post(`/app/decline?phone=${PHONE}&call=${callId}`);
    await a.wait('ended');

    const body = await (await fetch(`${base}/calls/log/clear`, { method: 'POST' })).json() as { ok: boolean; removed: number };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(1);
    expect(await logOf(a.id)).toHaveLength(0);
    expect(await logOf(PHONE)).toHaveLength(0);
  });

  it('GET /calls/log/clear -> 405 (chi POST)', async () => {
    expect((await fetch(`${base}/calls/log/clear?self=x`)).status).toBe(405);
  });
});
