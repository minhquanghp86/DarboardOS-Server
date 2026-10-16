// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-3) Thu tich hop man hinh "Gan day": anh thu nho tung ung dung, cham de chuyen, dong mot / dong tat ca.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ MAX_APP_TABS: '3' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

type Card = { k: string; l: string; t: string | null; p: boolean; a: boolean };
const shot = async (p: PageTarget, name: string) => {
  const dir = process.env.ITEST_SHOTS; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.png'), await srv.screenshot(p));
};
async function control(page: PageTarget, m: unknown) {
  await srv.evaluate(page, `window.__rwvControl(${JSON.stringify(JSON.stringify(m))})`);
}
async function recentsOn(page: PageTarget, pred: (l: Card[]) => boolean): Promise<Card[]> {
  for (let i = 0; i < 100; i++) {
    const l = await srv.evaluate<Card[] | null>(page, 'window.__rwvLastRecents || null');
    if (l && pred(l)) return l;
    await sleep(100);
  }
  throw new Error('Gan day khong cap nhat');
}

it('Gan day: anh thu nho moi ung dung, dong mot, dong tat ca, cham de chuyen', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-rc', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const ha = await srv.waitPage((u) => u === home);
  await control(ha, { app: 'weather' });
  const weather = await srv.waitPage((u) => u.includes('/weather.html'));
  await control(weather, { app: 'timer' });
  const timer = await srv.waitPage((u) => u.includes('/timer.html'));
  await sleep(800);

  await control(timer, { recents: 1 });
  let l = await recentsOn(timer, (x) => x.length === 3);
  expect(l.map((c) => c.k)).toEqual(['timer', 'weather', 'home']);          // moi dung gan nhat truoc
  expect(l.every((c) => c.t?.startsWith('data:image/jpeg;base64,'))).toBe(true);
  expect(l.find((c) => c.k === 'home')!.p).toBe(true);
  expect(l[0].a).toBe(true);
  await sleep(300); await shot(timer, 'recents-1024x600');

  await control(timer, { close: 'weather' });
  l = await recentsOn(timer, (x) => x.length === 2);
  expect((await srv.pageUrls()).some((u) => u.includes('/weather.html'))).toBe(false);

  await control(timer, { close: 'home' });                                   // ghim: khong dong duoc
  await control(timer, { closeAll: 1 });                                     // active + ghim: giu nguyen
  await sleep(800);
  expect((await srv.pageUrls()).sort()).toEqual([home, timer.url].sort());

  await control(timer, { app: 'home' });                                     // cham the HA
  await dev.waitFor(() => dev!.currentUrls().slice(-1)[0] === home, 10_000, 'chuyen ve HA');
});
