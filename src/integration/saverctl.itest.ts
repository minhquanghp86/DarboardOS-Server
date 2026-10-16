// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/09/2026) Server bao thiet bi "dang man hinh cho" (DeviceControl Saver=8) — P4 phat hien khuon mat ca luc man
// hinh cho, thay mat thi ve trang chu. Phai bao NGAY khi man hinh cho tat (cham), khong doi nhip 5 s.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '3' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

const saver = (d: FakeDevice, from: number) => d.msgs.slice(from).filter((m) => m[0] === 9 && m[2] === 8).map((m) => m[3]);

it('man hinh cho hien -> Saver 1; cham -> Saver 0 ngay', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-saverctl', { home, ctl: '1' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const from = dev.msgs.length;
  await dev.waitFor(() => saver(dev!, from).includes(1), 15_000, 'Saver=1 khi man hinh cho hien');
  const from2 = dev.msgs.length;
  const t0 = Date.now();
  dev.touch(1, 500, 300); dev.touch(3, 500, 300);
  await dev.waitFor(() => saver(dev!, from2).includes(0), 3_000, 'Saver=0 ngay sau khi cham');
  expect(Date.now() - t0).toBeLessThan(3_000);
});
