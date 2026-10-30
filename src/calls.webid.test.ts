// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/10/2026) ID PHIEN WEB BEN VUNG — "trinh duyet" la thiet bi goi duoc, on dinh, ro rang.
//
// Truoc day moi lan mo trang goi la mot phien WS MOI voi id NGAU NHIEN -> danh ba cua man P4 nhap nhay, doi id lien
// tuc, trung nhieu muc; ban 2.9.305 con AN cac phien "Điện thoại" (sai huong). Nay trang gui
// `{type:'hello', id, name, kind:'web'}` voi id giu trong localStorage (public/call-browser.js) -> server dung lai
// dung phien do (thay phien cu, giu cuoc goi), danh ba hien DU moi phien web + `online: true` + sap xep theo loai.
//
// Test chay HTTP + WebSocket THAT tren 127.0.0.1 (giong src/calls.join.test.ts), chi thay phan CAN THIET cua
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

import { finish, handleCallsApi, handleCallsUpgrade, setCallHooks, state, webIdOf } from './calls.js';
import { handlePhoneApi } from './phones.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';

const PANEL = 'p4-bep';
const PANEL2 = 'p4-khach';
const PHONE = 'phone-abc123';
const DESKTOP = 'Máy tính · trình duyệt';

interface Contact { id: string; kind: 'panel' | 'web' | 'phone'; name: string; busy: boolean; online: boolean }
const st = (id: string) => state(id) as { state: string; reason?: string; from: string; to: string };

let server: http.Server | null = null;
let base = '';
const live: string[] = [];          // cuoc goi can don sau moi test (calls.ts giu trang thai o cap module)
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

interface Page { id: string; ws: WebSocket; next(type?: string): Promise<any>; closed: Promise<void>; hello(name: string, id: string): void }

/** Mo mot trang goi trong trinh duyet: WS /calls/web?name=…[&id=…], cho `hello` cua server. */
async function open(name: string, id = ''): Promise<Page> {
  const q = `?name=${encodeURIComponent(name)}` + (id ? `&id=${encodeURIComponent(id)}` : '');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/calls/web${q}`);
  ws.binaryType = 'arraybuffer';
  sockets.push(ws);
  const queue: any[] = [];
  ws.on('message', (d, bin) => { queue.push(bin ? { bin: Buffer.from(d as Buffer) } : JSON.parse(d.toString())); });
  const closed = new Promise<void>((ok) => ws.on('close', () => ok()));
  const next = async (type?: string): Promise<any> => {
    for (let i = 0; i < 600; i++) {                        // ~6 s
      for (let j = 0; j < queue.length; j++) if (!type || queue[j].type === type) return queue.splice(j, 1)[0];
      await new Promise((ok) => setTimeout(ok, 10));
    }
    throw new Error('khong nhan duoc tin nhan WS' + (type ? ` "${type}"` : ''));
  };
  const hello = (n: string, i: string): void => { ws.send(JSON.stringify({ type: 'hello', id: i, name: n, kind: 'web' })); };
  const first = await next('hello');
  return { id: first.id as string, ws, next, closed, hello };
}

const post = (path: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  .then((r) => r.json().then((j) => ({ code: r.status, body: j as any })));

const contactsOf = (self: string): Promise<Contact[]> =>
  fetch(`${base}/calls/contacts?self=${encodeURIComponent(self)}`).then((r) => r.json() as Promise<Contact[]>);

beforeEach(async () => {
  screens.list = [{ id: PANEL, w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
  setCallHooks({ name: (id) => (id === PANEL ? 'Màn hình bếp' : id === PANEL2 ? 'Màn hình khách' : undefined) });
  setPhoneStore(new PhoneStore(null));
  await boot();
});

afterEach(async () => {
  for (const id of live.splice(0)) finish(id, 'Hết');
  for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } }
  await new Promise((ok) => setTimeout(ok, 60));          // de handler 'close' cua server chay xong
  const srv = server; server = null;
  if (srv) await new Promise<void>((ok) => srv.close(() => ok()));
});

describe('webIdOf — chi nhan id dung dinh dang server', () => {
  it('8–64 ky tu [A-Za-z0-9_-] thi giu, con lai -> rong', () => {
    expect(webIdOf('browser-0123456789')).toBe('browser-0123456789');
    expect(webIdOf('  abcdefgh  ')).toBe('abcdefgh');
    expect(webIdOf('a'.repeat(64))).toBe('a'.repeat(64));
    expect(webIdOf('a'.repeat(65))).toBe('');
    expect(webIdOf('abcdefg')).toBe('');                   // 7 ky tu = qua ngan
    expect(webIdOf('id co dau cach')).toBe('');
    expect(webIdOf('hỏng!')).toBe('');
    expect(webIdOf('')).toBe('');
    expect(webIdOf(undefined)).toBe('');
    expect(webIdOf(12345678)).toBe('');
  });
});

describe('2 ket noi cung id -> MOT thiet bi trong danh ba', () => {
  it('hello.id ben vung: id khong doi, phien cu bi thay the, khong sinh muc moi', async () => {
    const ID = 'browser-aaaa1111';
    // Trang A: id tam do server sinh (chua gui hello), roi gui hello voi id ben vung.
    const a = await open(DESKTOP);
    expect(a.id).toMatch(/^web-/);
    a.hello(DESKTOP, ID);
    expect((await a.next('hello')).id).toBe(ID);            // server doi phien sang id ben vung
    expect((await contactsOf('man-khac')).filter((c) => c.id === ID)).toHaveLength(1);

    // Trang B (mo lai tab / mo them tab cua CUNG trinh duyet): cung id -> thay phien A.
    const b = await open(DESKTOP);
    b.hello(DESKTOP, ID);
    expect((await b.next('hello')).id).toBe(ID);
    // Trang cu duoc bao "bi thay the" (de nguoi ta khong noi lai roi gianh id qua lai moi 2 s) roi bi dong.
    expect(await a.next('replaced')).toMatchObject({ type: 'replaced', id: ID });
    await a.closed;                                        // WS cu bi dong

    const webs = (await contactsOf('man-khac')).filter((c) => c.kind === 'web' && c.name === DESKTOP);
    expect(webs).toHaveLength(1);                          // KHONG trung muc
    expect(webs[0].id).toBe(ID);                           // id khong doi
    expect(webs[0].online).toBe(true);
    // Id tam 'web-…' cua B da bi thay (khong con phien mo coi nao trong danh ba).
    expect((await contactsOf('man-khac')).some((c) => c.id === b.id)).toBe(false);
  });

  it('mo WS kem &id= -> phien DAU TIEN da dung id ben vung (khong qua buoc id tam)', async () => {
    const ID = 'browser-bbbb2222';
    const a = await open(DESKTOP, ID);
    expect(a.id).toBe(ID);
    expect((await contactsOf('man-khac')).filter((c) => c.name === DESKTOP)).toEqual([
      { id: ID, kind: 'web', name: DESKTOP, busy: false, online: true },
    ]);
  });

  it('phien cu dang giu cuoc goi -> cuoc goi duoc CHUYEN sang phien moi', async () => {
    const ID = 'browser-cccc3333';
    const a = await open(DESKTOP);
    a.hello(DESKTOP, ID);
    await a.next('hello');

    // Trinh duyet goi man hinh P4 -> A dang giu cuoc goi (ringing).
    const r = await post(`/calls/start?from=${ID}&to=${PANEL}`);
    expect(r.code).toBe(200);
    const callId = r.body.call as string;
    live.push(callId);
    expect(st(callId)).toMatchObject({ state: 'ringing', from: ID, to: PANEL });

    // WS rot / mo lai tab -> phien MOI cung id: cuoc goi phai theo sang phien moi.
    const b = await open(DESKTOP);
    b.hello(DESKTOP, ID);
    await b.next('hello');
    await a.closed;

    // B bam "Ket thuc" ma KHONG kem id cuoc goi: chi ket thuc duoc neu phien moi da duoc gan cuoc goi.
    b.ws.send(JSON.stringify({ type: 'hangup' }));
    expect(await b.next('ended')).toMatchObject({ type: 'ended', call: callId });
    expect(st(callId)).toEqual({ state: 'ended', reason: 'Đã kết thúc' });
    expect((await contactsOf('man-khac')).filter((c) => c.name === DESKTOP)).toHaveLength(1);
  });

  it('hello.id rac -> giu id server sinh (khong tao phien voi id rac)', async () => {
    const a = await open('Điện thoại · trình duyệt');
    expect(a.id).toMatch(/^web-/);
    a.hello('Rác', 'hỏng!');                                // ky tu la
    a.hello('Rác', 'x'.repeat(80));                         // qua dai
    a.ws.send(JSON.stringify({ type: 'contacts' }));
    await a.next('contacts');

    const webs = (await contactsOf('man-khac')).filter((c) => c.kind === 'web');
    expect(webs).toHaveLength(1);
    expect(webs[0].id).toBe(a.id);                          // van la id server sinh
    expect(webs[0].id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(webs[0].name).toBe('Rác');                       // ten hien thi van cap nhat theo hello
  });
});

describe('contacts: hien DU phien web, co online, sap xep man hinh -> dien thoai -> trinh duyet', () => {
  it('khong con an phien "Điện thoại" khi da co thiet bi dang ky (bo quy tac 2.9.305)', async () => {
    screens.list = [...screens.list, { id: PANEL2, w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
    phones.register({ id: PHONE, name: 'Pixel 8', url: 'https://hass.local/x/call-web.html' }, 1000);
    const mob = await open('Dashboard · điện thoại');        // dung ten ma 2.9.305 dem ra an
    const desk = await open(DESKTOP);

    const list = await contactsOf(PANEL);
    expect(list.map((c) => c.kind)).toEqual(['panel', 'phone', 'web', 'web']);
    expect(list.map((c) => c.name)).toEqual(['Màn hình khách', 'Pixel 8 · Điện thoại', 'Dashboard · điện thoại', DESKTOP]);
    expect(list.every((c) => c.online === true)).toBe(true);
    expect(list.filter((c) => c.kind === 'web').map((c) => c.id).sort()).toEqual([desk.id, mob.id].sort());

    // Dang ban van hien (khong bi an) va bao busy.
    const r = await post(`/calls/start?from=${PANEL}&to=${encodeURIComponent(mob.id)}`);
    expect(r.code).toBe(200);
    live.push(r.body.call as string);
    const busyList = await contactsOf(PANEL);
    expect(busyList.find((c) => c.id === mob.id)).toMatchObject({ kind: 'web', busy: true, online: true });
    expect(busyList.map((c) => c.kind)).toEqual(['panel', 'phone', 'web', 'web']);
  });

  it('hai trinh duyet CUNG ten van chi mot muc (gop theo ten, uu tien muc dang ban)', async () => {
    const a = await open(DESKTOP, 'browser-dddd4444');
    await open(DESKTOP, 'browser-eeee5555');
    expect((await contactsOf('man-khac')).filter((c) => c.kind === 'web')).toHaveLength(1);

    const r = await post(`/calls/start?from=${PANEL}&to=${encodeURIComponent('browser-eeee5555')}`);
    expect(r.code).toBe(200);
    live.push(r.body.call as string);
    const merged = (await contactsOf('man-khac')).filter((c) => c.kind === 'web');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'browser-eeee5555', busy: true });   // muc dang ban duoc giu lai
    expect(a.id).toBe('browser-dddd4444');
  });

  it('phien web KHONG tu thay chinh no trong danh ba cua no (self)', async () => {
    const a = await open(DESKTOP, 'browser-ffff6666');
    expect((await contactsOf(a.id)).some((c) => c.id === a.id)).toBe(false);
    expect((await contactsOf(a.id)).some((c) => c.kind === 'web')).toBe(false);
  });
});
