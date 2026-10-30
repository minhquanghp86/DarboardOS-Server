// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — 5 duong dan app Android dung (src/phones.ts): dang ky, danh sach, cuoc goi den, nghe, tu choi.
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

import { finish, setCallHooks, start, state } from './calls.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';
import { handlePhoneApi } from './phones.js';

const PANEL = 'p4-bep';
const PHONE = 'phone-abc123';
const stOf = (id: string) => state(id) as { state: string; reason?: string };
const live: string[] = [];

interface Captured { code: number; body: string; type: string }

function res(): Captured & { writeHead: (c: number, h?: Record<string, string>) => void; end: (b: string) => void } {
  const r = {
    code: 0, body: '', type: '',
    writeHead(c: number, h?: Record<string, string>) { r.code = c; r.type = h?.['content-type'] || ''; },
    end(b: string) { r.body = b; },
  };
  return r;
}

/** Request gia: gom body lai roi phat data/end khi _flush() — de test chay dong bo, khong phai await. */
function req(method: string, payload?: unknown): { req: never; flush: () => void } {
  const chunks: Buffer[] = payload === undefined ? [] : [Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))];
  const listeners: { data: ((c: Buffer) => void)[]; end: (() => void)[]; error: ((e: Error) => void)[] } = { data: [], end: [], error: [] };
  const r = {
    method,
    destroy() { /* bo qua */ },
    on(ev: 'data' | 'end' | 'error', cb: never) { (listeners[ev] as ((x?: unknown) => void)[]).push(cb as never); return r; },
  };
  return {
    req: r as never,
    flush: () => { for (const c of chunks) for (const cb of listeners.data) cb(c); listeners.end.forEach((cb) => cb()); },
  };
}

const call = (method: string, url: string, payload?: unknown): { handled: boolean; out: Captured } => {
  const out = res();
  const fake = req(method, payload);
  const handled = handlePhoneApi(fake.req, out as never, new URL(url, 'http://x'));
  fake.flush();
  return { handled, out };
};

beforeEach(() => {
  screens.list = [{ id: PANEL, w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
  setPhoneStore(new PhoneStore(null));
  setCallHooks({ name: (id) => (id === PANEL ? 'Màn hình bếp' : undefined) });
});

afterEach(() => {
  for (const id of live.splice(0)) finish(id, 'Hết');
});

describe('POST /app/register', () => {
  it('dang ky: 200 + id/name/lastSeen, luu vao so', () => {
    const { handled, out } = call('POST', '/app/register', { id: PHONE, name: 'Pixel 8', url: 'https://hass.local/x/call-web.html' });
    expect(handled).toBe(true);
    expect(out.code).toBe(200);
    const body = JSON.parse(out.body) as { ok: boolean; phone: { id: string; name: string; lastSeen: number } };
    expect(body.ok).toBe(true);
    expect(body.phone.id).toBe(PHONE);
    expect(body.phone.name).toBe('Pixel 8');
    expect(body.phone.lastSeen).toBeGreaterThan(0);
    expect(phones.get(PHONE)?.url).toBe('https://hass.local/x/call-web.html');
  });

  it('dang ky lai (mo app lan nua) cap nhat ten, khong tao muc moi', () => {
    call('POST', '/app/register', { id: PHONE, name: 'Pixel 8' });
    const { out } = call('POST', '/app/register', { id: PHONE, name: 'Pixel 8 Pro' });
    expect(out.code).toBe(200);
    expect(phones.list()).toHaveLength(1);
    expect(phones.get(PHONE)?.name).toBe('Pixel 8 Pro');
  });

  it('body hong / thieu id -> 400', () => {
    expect(call('POST', '/app/register', {}).out.code).toBe(400);
    expect(call('POST', '/app/register', { id: 'co khoang trang' }).out.code).toBe(400);
    expect(call('POST', '/app/register', 'chuoi').out.code).toBe(400);
    expect(phones.list()).toHaveLength(0);
  });

  it('sai method -> 405', () => {
    expect(call('GET', '/app/register').out.code).toBe(405);
  });
});

describe('GET /app/list', () => {
  it('tra danh sach dien thoai (id, name, lastSeen)', () => {
    call('POST', '/app/register', { id: PHONE, name: 'Pixel 8' });
    call('POST', '/app/register', { id: 'phone-2', name: 'An' });
    const { out } = call('GET', '/app/list');
    expect(out.code).toBe(200);
    const body = JSON.parse(out.body) as { ok: boolean; phones: { id: string; name: string; lastSeen: number }[] };
    expect(body.phones.map((p) => p.name)).toEqual(['An', 'Pixel 8']);
    expect(Object.keys(body.phones[0]!).sort()).toEqual(['id', 'lastSeen', 'name']);
  });

  it('chua ai dang ky -> mang rong', () => {
    const body = JSON.parse(call('GET', '/app/list').out.body) as { phones: unknown[] };
    expect(body.phones).toEqual([]);
  });
});

describe('GET /app/incoming', () => {
  it('khong co cuoc goi -> {call: null}', () => {
    call('POST', '/app/register', { id: PHONE, name: 'Pixel 8' });
    const { out } = call('GET', `/app/incoming?phone=${PHONE}`);
    expect(out.code).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ call: null });
  });

  it('man goi toi -> app thay {call:{id, from, fromName}}', () => {
    call('POST', '/app/register', { id: PHONE, name: 'Pixel 8' });
    const started = start(PANEL, PHONE);
    expect(started.ok).toBe(true);
    live.push(started.call!);

    const body = JSON.parse(call('GET', `/app/incoming?phone=${PHONE}`).out.body) as { call: { id: string; from: string; fromName: string } | null };
    expect(body.call).toEqual({ id: started.call, from: PANEL, fromName: 'Màn hình bếp' });
  });

  it('thieu phone -> 400; may chua dang ky -> {call:null}', () => {
    expect(call('GET', '/app/incoming').out.code).toBe(400);
    expect(JSON.parse(call('GET', '/app/incoming?phone=la').out.body)).toEqual({ call: null });
  });
});

describe('POST /app/answer | /app/decline', () => {
  function ring(): string {
    call('POST', '/app/register', { id: PHONE, name: 'Pixel 8' });
    const r = start(PANEL, PHONE);
    live.push(r.call!);
    return r.call!;
  }

  it('nghe -> 200, cuoc goi active (khong con do chuong)', () => {
    const id = ring();
    const { out } = call('POST', `/app/answer?phone=${PHONE}&call=${id}`);
    expect(out.code).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true });
    expect(stOf(id).state).toBe('active');
    expect(JSON.parse(call('GET', `/app/incoming?phone=${PHONE}`).out.body)).toEqual({ call: null });
  });

  it('tu choi -> 200, ket thuc "Từ chối"', () => {
    const id = ring();
    const { out } = call('POST', `/app/decline?phone=${PHONE}&call=${id}`);
    expect(out.code).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true });
    expect(stOf(id)).toEqual({ state: 'ended', reason: 'Từ chối' });
  });

  it('sai may / cuoc goi khong ton tai -> 409', () => {
    const id = ring();
    expect(call('POST', `/app/answer?phone=may-khac&call=${id}`).out.code).toBe(409);
    expect(call('POST', `/app/decline?phone=${PHONE}&call=khong-co`).out.code).toBe(409);
    expect(stOf(id).state).toBe('ringing');
  });

  it('thieu tham so -> 400, sai method -> 405', () => {
    expect(call('POST', '/app/answer?phone=x').out.code).toBe(400);
    expect(call('GET', '/app/answer?phone=x&call=y').out.code).toBe(405);
  });
});

describe('pham vi xu ly', () => {
  it('duong dan ngoai /app/* -> false (de handler khac xu ly)', () => {
    expect(handlePhoneApi(req('GET').req, res() as never, new URL('http://x/calls/contacts'))).toBe(false);
    expect(handlePhoneApi(req('GET').req, res() as never, new URL('http://x/notify'))).toBe(false);
  });

  it('/app/* khong biet -> 404', () => {
    const { handled, out } = call('GET', '/app/khong-co');
    expect(handled).toBe(true);
    expect(out.code).toBe(404);
  });

  it('tra JSON, khong cache', () => {
    const out = res();
    handlePhoneApi(req('GET').req, out as never, new URL('http://x/app/list'));
    expect(out.type).toBe('application/json; charset=utf-8');
  });
});
