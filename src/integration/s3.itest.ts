// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026 OS-6) Bo cuc tren man hinh nho cua panel S3 (480x480, 480x272): moi be mat cua Shell phai nam tron
// trong man hinh (khong tran, khong bi cat), chu du doc. ITEST_SHOTS=<thu muc> de luu anh xem bang mat.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '6' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

const shot = async (p: PageTarget, name: string) => {
  const dir = process.env.ITEST_SHOTS; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.png'), await srv.screenshot(p));
};

for (const [w, h] of [[480, 480], [480, 272]] as const) {
  it(`S3 ${w}x${h}: man hinh chinh, bang keo, man hinh cho vua man hinh`, async () => {
    const home = srv.local('/ha');
    dev = await FakeDevice.connect(srv, `it-s3-${h}`, { home, w: String(w), h: String(h) });
    await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
    const ha = await srv.waitPage((u) => u === home);
    await srv.evaluate(ha, `window.__rwvControl('{"app":"__system"}')`);
    const hp = await srv.waitPage((u) => u.endsWith('/os/home'));
    await srv.evaluate(hp, `window.__rwvShell.state({ b: 80, v: 50, on: true, ctl: true, tv: true, skewMs: 0, tz: 420, tg: { noSleep: false, muted: false, aec: true }, wx: { t: 31, code: 2, day: true, pp: 20, name: 'Hà Nội' }, tm: null })`);
    await sleep(1500);
    expect(await srv.evaluate<number[]>(hp, '[innerWidth, innerHeight]')).toEqual([w, h]);
    await shot(hp, `s3-home-${w}x${h}`);
    const info = await srv.evaluate<any>(hp, 'window.__rwvShell.homeInfo()');
    console.log(`[s3] ${w}x${h}: ${info.cols} cot x ${info.rows} hang`, info.fit);
    expect(info.rows).toBeGreaterThanOrEqual(h >= 400 ? 3 : 2);
    // Moi o ung dung tren trang dau + dock nam tron trong man hinh
    for (const [k, r] of Object.entries<number[]>(info.tiles)) {
      expect([k, r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= w + 0.5 && r[1] + r[3] <= h + 0.5]).toEqual([k, true]);
    }
    await srv.evaluate(hp, 'window.__rwvShell.open()');
    await sleep(600);
    await shot(hp, `s3-shade-${w}x${h}`);
    await srv.evaluate(hp, 'window.__rwvShell.close()');
    await srv.evaluate(hp, `window.__rwvShell.notify({ id: 1, t: 'Chuông cửa', m: 'Có người ở cổng trước', p: 'normal', ts: Date.now(), img: null, act: false }, false)`);
    await sleep(500);
    await shot(hp, `s3-toast-${w}x${h}`);
    // Man hinh cho: server tu bat sau 6 s khong cham (den nen dang sang)
    dev.deviceState({ backlightOn: true, tzMin: 420 });
    await sleep(13_000);
    await shot(hp, `s3-saver-${w}x${h}`);
  });
}
