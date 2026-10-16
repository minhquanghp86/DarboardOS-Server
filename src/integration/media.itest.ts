// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/09/2026) Server bao thiet bi "dang phat media" (DeviceControl Media=7) — P4 dung de tam dung tu danh thuc + AEC
// trong luc phat video/am thanh (giu tro ly giong noi ma khong tranh CPU voi video).
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start(); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

const media = (d: FakeDevice, from: number) => d.msgs.slice(from).filter((m) => m[0] === 9 && m[2] === 7).map((m) => m[3]);

it('trang bat dau / ngung phat -> thiet bi nhan Media 1 / 0; tab nen (khong phai nhac nen) khong tinh', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-media', { home, ctl: '1' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const ha = await srv.waitPage((u) => u === home);
  let from = dev.msgs.length;
  await srv.evaluate(ha, `window.__rwvControl('{"media":1}')`);
  await dev.waitFor(() => media(dev!, from).includes(1), 5_000, 'Media=1');
  from = dev.msgs.length;
  await srv.evaluate(ha, `window.__rwvControl('{"media":0}')`);
  await dev.waitFor(() => media(dev!, from).includes(0), 5_000, 'Media=0');

  // Tab dang phat roi bi chuyen ra nen (khong phai nhac nen) -> khong con tinh la dang phat.
  await srv.evaluate(ha, `window.__rwvControl('{"media":1}')`);
  await dev.waitFor(() => media(dev!, from).includes(1), 5_000, 'Media=1 lan 2');
  from = dev.msgs.length;
  await srv.evaluate(ha, `window.__rwvControl('{"app":"weather"}')`);
  await dev.waitFor(() => media(dev!, from).includes(0), 5_000, 'Media=0 khi roi tab');
  await sleep(300);
});
