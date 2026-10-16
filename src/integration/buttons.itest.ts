// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (16/10/2026) Nut bam vat ly (S3 480x272): DeviceEvent Button (kind 4) — trai / phai = bai truoc / sau cua trinh phat dang chay
// (ham trang rwvPrev / rwvNext), man hinh cho: nhan dau chi danh thuc, khong co trinh phat: bo qua.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '0' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

const BTN = 4, L = 1, C = 2, R = 3;

it('trai / phai = bai truoc / sau khi dang phat; khong phat thi bo qua; giu giua = mo Frigate', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-btn', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true });
  const ha = await srv.waitPage((u) => u === home);
  // Trang tu dinh nghia ham chuyen bai (nhu radio.html) — dem so lan goi
  await srv.evaluate(ha, `window.__nx = 0; window.__pv = 0; window.rwvNext = () => { window.__nx++; }; window.rwvPrev = () => { window.__pv++; };`);
  const calls = async () => srv.evaluate<{ nx: number; pv: number }>(ha, '({ nx: window.__nx, pv: window.__pv })');

  // Chua phat gi: nhan nut khong lam gi
  dev.event(BTN, R); dev.event(BTN, L);
  await sleep(800);
  expect(await calls()).toEqual({ nx: 0, pv: 0 });

  // Dang phat: phai = bai sau, trai = bai truoc; giua khong lam gi o server
  await srv.evaluate(ha, `window.__rwvControl('{"media":1}')`);
  await sleep(500);
  dev.event(BTN, R);
  await dev.waitFor(() => srv.log().includes('bai sau'), 5000, 'bai sau');
  dev.event(BTN, L);
  await dev.waitFor(() => srv.log().includes('bai truoc'), 5000, 'bai truoc');
  dev.event(BTN, C);
  await sleep(600);
  expect(await calls()).toEqual({ nx: 1, pv: 1 });

  // Giu giua >= 2 s (firmware gui "long") -> mo ung dung Frigate; nhan giua thuong khong lam gi o server
  // (o nhap dang duoc chon + ban phim ao: giu Home phai dong chung va vao thang Frigate)
  await srv.evaluate(ha, `(() => { const i = document.createElement('input'); i.id = 'zz'; document.body.appendChild(i); i.focus(); window.__hid = 0; const f = window.__vkbHide; window.__vkbHide = () => { window.__hid++; if (f) f(); }; })()`);
  dev.event(BTN, C, 'long');
  await dev.waitFor(() => srv.log().includes('chuyen sang tab "cams"'), 12_000, 'mo Frigate');

  expect(await srv.evaluate<number>(ha, 'window.__hid')).toBeGreaterThanOrEqual(1);
  expect(await srv.evaluate<boolean>(ha, "document.activeElement && document.activeElement.id === 'zz'")).toBe(false);

  // Nut la khong lam sap server
  dev.event(BTN, 9);
  await sleep(300);
  expect(srv.log()).toContain('[nut] it-btn: phai');
});
