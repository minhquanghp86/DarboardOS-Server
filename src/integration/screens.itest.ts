// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (16/10/2026) Dashboard → "Màn hình" (src/screenCtl.ts + khoi screen* trong deviceManager): danh sach / chi tiet / lenh dieu
// khien tung man tu xa. Man gia (FakeDevice, ctl=1) nhan DeviceControl khi chinh do sang / am luong / tat tieng.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '0' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

const get = async (p: string) => (await fetch(srv.local(p))).json() as Promise<any>;
const post = async (p: string, body: unknown) => {
  const r = await fetch(srv.local(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() as any };
};
/** DeviceControl (loai 9): [9, ver, truong, gia tri] — truong 1 do sang, 2 am luong, 4 tat tieng. */
const ctl = (d: FakeDevice, from: number, f: number) => d.msgs.slice(from).filter((m) => m[0] === 9 && m[2] === f).map((m) => m[3]);

it('danh sach + chi tiet + lenh do sang / am luong / tat tieng / khong lam phien / ung dung / thong bao', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-scr', { home, ctl: '1' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true });

  const l = await get('/screens/list');
  const me = l.screens.find((s: any) => s.id === 'it-scr');
  expect(me).toMatchObject({ online: true, w: 1024, h: 600, saver: false, locked: false, dnd: false });
  expect(me.app).toMatchObject({ k: 'home' });

  const i = await get('/screens/info?id=it-scr');
  expect(i.screen.cap).toMatchObject({ cam: false });
  expect(i.screen.tabs.map((t: any) => t.k)).toContain('home');
  expect(i.screen.apps.length).toBeGreaterThan(5);

  // Do sang / am luong / tat tieng -> DeviceControl xuong man; gia tri ngoai 0..100 bi tu choi
  const from = dev.msgs.length;
  expect((await post('/screens/act', { id: 'it-scr', act: 'b', v: 42 })).status).toBe(200);
  expect((await post('/screens/act', { id: 'it-scr', act: 'v', v: 30 })).status).toBe(200);
  expect((await post('/screens/act', { id: 'it-scr', act: 'mu', v: 1 })).status).toBe(200);
  expect(ctl(dev, from, 1)).toEqual([42]);
  expect(ctl(dev, from, 2)).toEqual([30]);
  expect(ctl(dev, from, 4)).toEqual([1]);
  const bad = await post('/screens/act', { id: 'it-scr', act: 'b', v: 140 });
  expect(bad.status).toBe(400);
  expect(bad.j.ok).toBe(false);

  // Khong lam phien: server nho, trang thai hien o danh sach
  expect((await post('/screens/act', { id: 'it-scr', act: 'dnd', v: 1 })).status).toBe(200);
  expect((await get('/screens/list')).screens.find((s: any) => s.id === 'it-scr').dnd).toBe(true);

  // Thong bao gui toi man -> nam trong chi tiet; xoa het
  expect((await post('/screens/act', { id: 'it-scr', act: 'notify', title: 'Thu', message: 'Xin chao' })).status).toBe(200);
  let nt = (await get('/screens/info?id=it-scr')).screen.nt;
  expect(nt.some((n: any) => n.t === 'Thu')).toBe(true);
  expect((await post('/screens/act', { id: 'it-scr', act: 'ntClear' })).status).toBe(200);
  nt = (await get('/screens/info?id=it-scr')).screen.nt;
  expect(nt).toEqual([]);

  // Man khong ton tai / lenh la / URL khong hop le
  expect((await post('/screens/act', { id: 'khong-co', act: 'wake' })).status).toBe(400);
  expect((await post('/screens/act', { id: 'it-scr', act: 'bay-ba' })).status).toBe(400);
  expect((await post('/screens/act', { id: 'it-scr', act: 'url', url: 'file:///etc/passwd' })).status).toBe(400);
  expect((await get('/screens/info?id=khong-co')).ok).toBe(false);
});
