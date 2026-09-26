// (27/09/2026) Thu tich hop tro ly giong noi: firmware bao trang thai (DeviceEvent) -> the tro ly tren Shell cua tab
// dang hien; nut "Tro ly" tren Shell -> DeviceControl Assist xuong thiet bi; man hinh cho tat khi tro ly nghe.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '0' }); });
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
const lastVoice = (p: PageTarget) => srv.evaluate<any>(p, 'window.__rwvLastVoice || null');

it('Tro ly: trang thai tu firmware hien tren the, nut Tro ly gui DeviceControl Assist', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-va', { home, ctl: '1', va: '1' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const hp = await srv.waitPage((u) => u === home);
  await sleep(1000);

  dev.event(1, 1);
  await sleep(500);
  expect(await lastVoice(hp)).toMatchObject({ s: 1, l: 'Đang nghe…' });
  dev.event(1, 2, 'bật đèn phòng khách');
  await sleep(300);
  expect(await lastVoice(hp)).toMatchObject({ s: 2, q: '“bật đèn phòng khách”' });
  dev.event(1, 3, 'Đã bật đèn phòng khách.');
  await sleep(400);
  expect(await lastVoice(hp)).toMatchObject({ s: 3, q: '“bật đèn phòng khách”', a: 'Đã bật đèn phòng khách.' });
  await shot(hp, 'voice-reply-1024x600');
  expect(srv.log()).toContain('[voice] it-va: tra loi "Đã bật đèn phòng khách."');

  // Nut Tro ly (Shell goi {assist:1}) -> goi DeviceControl [9][1][6][1] xuong thiet bi
  const before = dev.msgs.length;
  await srv.evaluate(hp, `window.__rwvControl('{"assist":1}')`);
  await dev.waitFor(() => dev!.msgs.slice(before).some((m) => m[0] === 9 && m[2] === 6 && m[3] === 1), 5000, 'DeviceControl Assist');

  // Co nguoi -> server luu, day vao Shell (pr)
  dev.event(2, 1);
  await sleep(300);
  expect(srv.log()).toContain('[presence] it-va: CO nguoi');
});
