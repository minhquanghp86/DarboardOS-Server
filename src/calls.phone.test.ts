// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — dien thoai la thiet bi goi duoc thuong tru trong src/calls.ts: danh ba co nhan "Điện thoại",
// goi toi dien thoai -> ringing 30 s -> /app/incoming thay cuoc goi -> nghe / tu choi / het gio = cuoc goi nho.
// Chi thay dung phan CAN THIET cua deviceManager (danh sach man hinh dang ket noi, mo trang cuoc goi, Thong bao).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const screens = vi.hoisted(() => ({ list: [] as { id: string; w: number; h: number; cam: boolean; sd: boolean; spk: boolean; mic: boolean }[] }));
const notified = vi.hoisted(() => [] as unknown[]);

vi.mock('./deviceManager.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./deviceManager.js')>();
  return {
    ...real,
    connectedScreens: () => screens.list,
    openRingPage: () => true,
    answerDoorbell: () => true,
    closeDoorbell: () => true,
    postNotify: (n: unknown) => { notified.push(n); return { ok: true }; },
  };
});

// `phones` la binding SONG: setPhoneStore() doi so dang ky va cac test duoi day thay ngay.
import { accept, contacts, declineFromPhone, finish, handleCallsApi, incomingFor, setCallHooks, start, state } from './calls.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';

const PANEL = 'p4-bep';
const PHONE = 'phone-abc123';
const stOf = (id: string) => state(id) as { state: string; reason?: string; fromName?: string; toName?: string };

function registerPhone(name = 'Pixel 8'): void {
  setPhoneStore(new PhoneStore(null));
  phones.register({ id: PHONE, name, url: 'https://hass.local/x/call-web.html' }, 1000);
}

/** Goi va ghi nho cuoc goi de afterEach don sach (calls.ts giu trang thai o cap module). */
const live: string[] = [];
function callTo(to: string, from = PANEL): string {
  const r = start(from, to);
  if (r.ok && r.call) live.push(r.call);
  return r.call || '';
}

beforeEach(() => {
  screens.list = [{ id: PANEL, w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
  notified.length = 0;
  setCallHooks({ name: (id) => (id === PANEL ? 'Màn hình bếp' : undefined) });
});

afterEach(() => {
  vi.useRealTimers();
  for (const id of live.splice(0)) finish(id, 'Hết');
});

describe('danh ba (contacts) co dien thoai', () => {
  it('dien thoai da dang ky hien voi nhan "Điện thoại"', () => {
    registerPhone();
    const p = contacts(PANEL).find((x) => x.id === PHONE);
    expect(p).toBeDefined();
    expect(p?.kind).toBe('phone');
    expect(p?.name).toBe('Pixel 8 · Điện thoại');
    expect(p?.busy).toBe(false);
  });

  it('dien thoai chua dang ky khong co trong danh ba', () => {
    setPhoneStore(new PhoneStore(null));
    expect(contacts(PANEL).some((x) => x.kind === 'phone')).toBe(false);
  });

  it('man hinh khac van o trong danh ba nhu cu', () => {
    registerPhone();
    screens.list = [...screens.list, { id: 'p4-khach', w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
    const ids = contacts(PANEL).map((x) => x.id);
    expect(ids).toContain('p4-khach');
    expect(ids).toContain(PHONE);
  });
});

describe('goi toi dien thoai', () => {
  it('tao cuoc goi ringing, /app/incoming thay cuoc goi + ten nguoi goi', () => {
    registerPhone();
    const id = callTo(PHONE);
    expect(id).toBeTruthy();

    expect(incomingFor(PHONE)).toEqual({ id, from: PANEL, fromName: 'Màn hình bếp' });
    expect(stOf(id).state).toBe('ringing');

    // Dien thoai khac khong thay cuoc goi cua may nay.
    phones.register({ id: 'phone-khac', name: 'Máy khác', url: '' }, 1000);
    expect(incomingFor('phone-khac')).toBeNull();
  });

  it('dang do chuong -> danh ba bao ban, may khac goi tiep bi tu choi', () => {
    registerPhone();
    callTo(PHONE);
    expect(contacts(PANEL).find((x) => x.id === PHONE)?.busy).toBe(true);

    screens.list = [...screens.list, { id: 'p4-khach', w: 1280, h: 800, cam: true, sd: false, spk: true, mic: true }];
    const second = start('p4-khach', PHONE);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/bận/);
  });

  it('id la (khong phai man hinh / dien thoai) van bao loi nhu cu', () => {
    registerPhone();
    const r = start(PANEL, 'khong-ton-tai');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Không gọi được tới máy này.');
  });

  it('dien thoai chua dang ky -> khong goi duoc', () => {
    setPhoneStore(new PhoneStore(null));
    expect(start(PANEL, PHONE).ok).toBe(false);
  });
});

describe('nghe / tu choi / het gio', () => {
  it('nghe -> cuoc goi active, khong con do chuong', () => {
    registerPhone();
    const id = callTo(PHONE);
    expect(accept(id, PHONE)).toEqual({ ok: true });
    expect(stOf(id).state).toBe('active');
    expect(incomingFor(PHONE)).toBeNull();
  });

  it('nghe ho cuoc goi cua may khac -> tu choi', () => {
    registerPhone();
    const id = callTo(PHONE);
    expect(accept(id, 'may-khac').ok).toBe(false);
  });

  it('tu choi -> ket thuc voi ly do "Từ chối", khong phai cuoc goi nho', () => {
    registerPhone();
    const id = callTo(PHONE);
    expect(declineFromPhone(id, PHONE)).toBe(true);
    expect(stOf(id)).toEqual({ state: 'ended', reason: 'Từ chối' });
    expect(incomingFor(PHONE)).toBeNull();
    expect(notified).toHaveLength(0);
  });

  it('tu choi sai may -> khong dung toi cuoc goi', () => {
    registerPhone();
    const id = callTo(PHONE);
    expect(declineFromPhone(id, 'may-khac')).toBe(false);
    expect(stOf(id).state).toBe('ringing');
  });

  it('het 30 s khong ai nhan -> cuoc goi nho (ended "Không trả lời")', () => {
    vi.useFakeTimers();
    registerPhone();
    const id = callTo(PHONE);
    expect(incomingFor(PHONE)?.id).toBe(id);

    vi.advanceTimersByTime(29_000);
    expect(stOf(id).state).toBe('ringing');

    vi.advanceTimersByTime(1_500);
    expect(stOf(id)).toEqual({ state: 'ended', reason: 'Không trả lời' });
    expect(incomingFor(PHONE)).toBeNull();
    // Dien thoai khong phai man hinh -> khong postNotify len man nao (Telegram lo phan bao nho).
    expect(notified).toHaveLength(0);
  });
});

describe('/calls/* giu nguyen hanh vi (P4 <-> call-web)', () => {
  function fakeReq(method: string, remote = '127.0.0.1'): never {
    return { method, socket: { remoteAddress: remote } } as never;
  }
  function fakeRes(): never {
    const r = { code: 0, body: '', writeHead: (c: number) => { r.code = c; }, end: (b: string) => { r.body = b; } };
    return r as never;
  }

  it('GET /calls/contacts tra ca dien thoai (nhan "Điện thoại")', () => {
    registerPhone();
    const res = fakeRes() as unknown as { code: number; body: string };
    expect(handleCallsApi(fakeReq('GET'), res as never, new URL(`http://x/calls/contacts?self=${PANEL}`))).toBe(true);
    expect(res.code).toBe(200);
    const list = JSON.parse(res.body) as { id: string; kind: string; name: string }[];
    expect(list.find((x) => x.id === PHONE)?.name).toBe('Pixel 8 · Điện thoại');
  });

  it('POST /calls/start?from=<man>&to=<dien thoai> -> 200 + call', () => {
    registerPhone();
    const res = fakeRes() as unknown as { code: number; body: string };
    const url = new URL(`http://x/calls/start?from=${PANEL}&to=${PHONE}`);
    expect(handleCallsApi(fakeReq('POST'), res as never, url)).toBe(true);
    expect(res.code).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; call: string };
    expect(body.ok).toBe(true);
    expect(body.call).toBeTruthy();
    finish(body.call, 'Hết');   // don ngay: test khac khong bi dinh cuoc goi nay
  });

  it('ngoai 127.0.0.1 van bi chan 403 nhu cu', () => {
    const res = fakeRes() as unknown as { code: number };
    expect(handleCallsApi(fakeReq('GET', '192.168.1.50'), res as never, new URL('http://x/calls/contacts'))).toBe(true);
    expect(res.code).toBe(403);
  });

  it('duong dan khac /calls/* -> false (de handler khac xu ly)', () => {
    expect(handleCallsApi(fakeReq('GET'), fakeRes(), new URL('http://x/app/incoming?phone=1'))).toBe(false);
  });
});
