// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (17/11/2026) GD9 — APP ANDROID CHI CON MOT O DIA CHI: khi o do la DOMAIN thi MOI loi goi /app/* di qua ingress cua
// Home Assistant, tuc la duong dan co TIEN TO:
//   https://<domain>/api/hassio_ingress/<TOKEN>/app/register
// Truoc day chi /app/ping so khop theo HAU TO; 5 route con lai so khop theo DAU (`p === '/app/register'`) nen qua
// ingress deu roi vao 404/"ok" -> app khong dang ky duoc, khong nhan duoc cuoc goi. Test nay chay HTTP THAT va khoa:
//   1. routeOf() bo dung cac tien to (ingress HA, /hassio/ingress/, slug add-on, nhieu tang),
//   2. CA 6 route /app/* tra loi dung khi goi kem tien to ingress,
//   3. /app/list khong con rac sau khi xoa (ban ghi 'test-abc' cua lan thu truoc).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./deviceManager.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./deviceManager.js')>();
  return { ...real, connectedScreens: () => [], openRingPage: () => true, answerDoorbell: () => true, closeDoorbell: () => true, postNotify: () => ({ ok: true }) };
});

import { handleCallsApi } from './calls.js';
import { handlePhoneApi } from './phones.js';
import { PhoneStore, phones, setPhoneStore } from './phoneStore.js';
import { hasIngressPrefix, routeOf } from './routePath.js';

const TOKEN = 'KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38';
const ING = `/api/hassio_ingress/${TOKEN}`;
const SLUG = '/b39feb53_remote_webview_server';

let server: http.Server | null = null;
let base = '';

async function boot(): Promise<void> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (handlePhoneApi(req, res, url)) return;
    if (handleCallsApi(req, res, url)) return;
    // Giong index.ts: request la (khong khop handler nao) -> "ok" 2 byte.
    res.writeHead(200); res.end('ok');
  });
  await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const get = (path: string) => fetch(base + path, { cache: 'no-store' }).then((r) => r.text().then((t) => ({ code: r.status, text: t })));
const postJson = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => r.text().then((t) => ({ code: r.status, text: t })));
const post = (path: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  .then((r) => r.text().then((t) => ({ code: r.status, text: t })));

beforeEach(async () => {
  setPhoneStore(new PhoneStore(null));
  await boot();
});

afterEach(async () => {
  const srv = server; server = null;
  if (srv) await new Promise<void>((ok) => srv.close(() => ok()));
});

describe('routeOf — bo tien to ingress/proxy', () => {
  it('ingress HA co TOKEN', () => {
    expect(routeOf(`${ING}/app/register`)).toBe('/app/register');
    expect(routeOf(`${ING}/chat/list`)).toBe('/chat/list');
    expect(routeOf(`${ING}/files.html`)).toBe('/files.html');
    expect(routeOf(`${ING}/`)).toBe('/');
    expect(routeOf(`${ING}`)).toBe('/');
  });

  it('cac dang khac: /hassio/ingress/, slug add-on, nhieu tang', () => {
    expect(routeOf('/hassio/ingress/abc123/app/ping')).toBe('/app/ping');
    expect(routeOf('/api/hassio/ingress/abc123/calls/state')).toBe('/calls/state');
    expect(routeOf(`${SLUG}/app/list`)).toBe('/app/list');
    expect(routeOf(`${SLUG}${ING}/app/list`)).toBe('/app/list');
  });

  it('duong dan goc (panel 127.0.0.1) KHONG doi', () => {
    expect(routeOf('/app/list')).toBe('/app/list');
    expect(routeOf('/')).toBe('/');
    expect(routeOf('/chat.html')).toBe('/chat.html');
    expect(routeOf('')).toBe('/');
    expect(routeOf(null)).toBe('/');
    // Khong duoc cat nham mot tien to chi "gan giong".
    expect(routeOf('/application/x')).toBe('/application/x');
    expect(routeOf('/api/hassio_ingress')).toBe('/api/hassio_ingress');
  });

  it('hasIngressPrefix', () => {
    expect(hasIngressPrefix(`${ING}/app/ping`)).toBe(true);
    expect(hasIngressPrefix('/app/ping')).toBe(false);
    expect(hasIngressPrefix('/')).toBe(false);
  });
});

describe('/app/* qua ingress — CA 6 route', () => {
  it('GET …/app/ping -> 200 {"service":"dashboard-os"}', async () => {
    const r = await get(`${ING}/app/ping`);
    expect(r.code).toBe(200);
    expect(JSON.parse(r.text).service).toBe('dashboard-os');
  });

  it('POST …/app/register -> 200 (truoc day 200 "ok" nen app tuong da dang ky)', async () => {
    const r = await postJson(`${ING}/app/register`, { id: 'phone-ing-1', name: 'Pixel 8', url: 'https://hass/x/call-web.html' });
    expect(r.code).toBe(200);
    const j = JSON.parse(r.text);
    expect(j.ok).toBe(true);
    expect(j.phone.id).toBe('phone-ing-1');
  });

  it('GET …/app/list va …/app/incoming -> 200 JSON', async () => {
    await postJson(`${ING}/app/register`, { id: 'phone-ing-2', name: 'Pixel 9' });
    const list = await get(`${ING}/app/list`);
    expect(list.code).toBe(200);
    expect(JSON.parse(list.text).phones.map((p: { id: string }) => p.id)).toContain('phone-ing-2');

    const inc = await get(`${ING}/app/incoming?phone=phone-ing-2`);
    expect(inc.code).toBe(200);
    expect(JSON.parse(inc.text)).toEqual({ call: null });
  });

  it('POST …/app/answer | decline | hangup -> toi duoc route (409 vi cuoc goi khong ton tai, KHONG phai 404)', async () => {
    for (const route of ['answer', 'decline', 'hangup']) {
      const r = await post(`${ING}/app/${route}?phone=phone-ing-3&call=khong-co`);
      expect({ route, code: r.code }).toEqual({ route, code: 409 });
    }
  });

  it('tien to proxy giu ten add-on cung duoc', async () => {
    const r = await get(`${SLUG}/app/list`);
    expect(r.code).toBe(200);
    expect(JSON.parse(r.text).ok).toBe(true);
  });

  it('/calls/* qua ingress cung duoc (trang Goi mo qua ingress)', async () => {
    const r = await get(`${ING}/calls/state?call=khong-co`);
    expect(r.code).toBe(200);
    expect(JSON.parse(r.text).state).toBe('ended');
  });
});

describe('/app/list — khong con rac', () => {
  it('ban ghi test-abc: dang ky -> xoa -> /app/list sach', async () => {
    await postJson(`${ING}/app/register`, { id: 'test-abc', name: 'test' });
    expect(phones.list().map((p) => p.id)).toContain('test-abc');

    const rm = await postJson(`${ING}/app/remove`, { id: 'test-abc' });
    expect(rm.code).toBe(200);
    expect(JSON.parse(rm.text)).toMatchObject({ ok: true, removed: 1 });

    const list = await get(`${ING}/app/list`);
    const ids = JSON.parse(list.text).phones.map((p: { id: string }) => p.id);
    expect(ids).not.toContain('test-abc');
    expect(phones.has('test-abc')).toBe(false);
  });

  it('moi id trong /app/list deu la id hop le (khong co ban ghi mo coi)', async () => {
    await postJson(`${ING}/app/register`, { id: 'phone-a', name: 'A' });
    await postJson(`${ING}/app/register`, { id: 'phone-b', name: 'B' });
    const list = await get(`${ING}/app/list`);
    const ids: string[] = JSON.parse(list.text).phones.map((p: { id: string }) => p.id);
    expect(ids.length).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  });
});
