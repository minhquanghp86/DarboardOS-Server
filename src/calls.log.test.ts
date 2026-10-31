// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/12/2026) NHAT KY CUOC GOI — kiem tra API GET /calls/log tren HTTP + WebSocket THAT (nhu calls.hangup.test.ts):
//   (a) goi roi bi TU CHOI  -> muc cua ben goi `dir:'out'`, `state:'declined'`; muc cua ben nhan `dir:'in'`, `byMe:true`;
//   (b) goi -> NGHE -> KET THUC -> `answered` + `durationMs > 0`;
//   (c) het 30 s khong ai nhat may -> `missed`;
//   (d) `?limit=` giu y nghia "moi nhat truoc" (gioi han 200 muc kiem o src/callLog.test.ts).
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

import { start, finish, handleCallsApi, handleCallsUpgrade, setCallHooks } from './calls.js';
import { CallLog, callLog, setCallLog } from './callLog.js';
import type { CallLogItem } from './callLog.js';
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

describe('(a) cuoc goi bi TU CHOI', () => {
  it('ben goi: dir=out, state=declined; ben nhan: dir=in, byMe=true', async () => {
    const a = await openPage('A');
    a.send({ type: 'start', to: PHONE });
    const started = await a.wait('started');
    expect(started.ok).toBe(true);
    const callId = started.call as string;
    live.push(callId);

    expect((await post(`/app/decline?phone=${PHONE}&call=${callId}`)).code).toBe(200);
    await a.wait('ended');

    const out = await logOf(a.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: callId, self: a.id, dir: 'out', peerId: PHONE, peerKind: 'phone',
      peerName: 'Pixel 8 · Điện thoại', state: 'declined', byMe: false, startedAt: 0, durationMs: 0,
    });
    expect(out[0].endedAt).toBeGreaterThan(0);

    const inc = await logOf(PHONE);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ id: callId, self: PHONE, dir: 'in', peerId: a.id, peerKind: 'web', state: 'declined', byMe: true });
  });
});

describe('(b) NHE MAY roi KET THUC', () => {
  it('answered + durationMs > 0 cho ca hai ben, byMe dung ben cup may', async () => {
    const a = await openPage('A');
    const b = await openPage('B');
    a.send({ type: 'start', to: b.id });
    const started = await a.wait('started');
    const callId = started.call as string;
    live.push(callId);
    await b.wait('incoming');

    b.send({ type: 'accept' });
    expect((await a.wait('active')).call).toBe(callId);
    await sleep(30);                                  // de duration > 0 that su

    a.send({ type: 'hangup', call: callId });
    expect(await a.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });
    expect(await b.wait('ended')).toMatchObject({ call: callId, reason: 'Đã kết thúc' });

    const out = await logOf(a.id);
    expect(out[0]).toMatchObject({ dir: 'out', state: 'answered', peerId: b.id, byMe: true });
    expect(out[0].startedAt).toBeGreaterThan(0);
    expect(out[0].durationMs).toBeGreaterThan(0);

    const inc = await logOf(b.id);
    expect(inc[0]).toMatchObject({ dir: 'in', state: 'answered', peerId: a.id, byMe: false });
    expect(inc[0].durationMs).toBeGreaterThan(0);
  });
});

describe('(c) KHONG AI NHAT MAY (het RING_S)', () => {
  it('cuoc goi nho -> state=missed, durationMs=0', async () => {
    vi.useFakeTimers();
    const r = start(PANEL, PHONE);
    expect(r.ok).toBe(true);
    const callId = r.call as string;
    live.push(callId);

    vi.advanceTimersByTime(31_000);

    // Doc THANG so nhat ky dang dung (khong qua HTTP: dong ho da bi gia lap trong test nay).
    const inc = callLog.list(PHONE);
    expect(inc[0]).toMatchObject({ id: callId, dir: 'in', peerId: PANEL, peerKind: 'panel', state: 'missed', startedAt: 0, durationMs: 0, byMe: false });
    const out = callLog.list(PANEL);
    expect(out[0]).toMatchObject({ id: callId, dir: 'out', peerId: PHONE, state: 'missed' });
  });
});

describe('(d) API /calls/log', () => {
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
    expect((await logOf(a.id, 1)).map((i) => i.id)).toEqual([second]);
    expect(await logOf('may-khong-ton-tai')).toHaveLength(0);
  });
});
