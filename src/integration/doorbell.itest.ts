// (27/09/2026) Chuong cua: POST /doorbell -> panel mo camera cong toan man hinh; Mo cong -> dung script HA da khai;
// Dong / het gio -> quay ve ung dung truoc, tab chuong dong.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';
import { FakeHa, startFakeHa } from './fakeHa.js';

let srv: TestServer;
let ha: FakeHa;
let dev: FakeDevice | null = null;
beforeEach(async () => {
  ha = await startFakeHa({ states: { 'script.mo_cong': { state: 'off', attributes: {} } } });
  srv = await TestServer.start({ SUPERVISOR_TOKEN: 'test', HA_API_URL: `http://127.0.0.1:${ha.port}/api`, HA_WS_URL: `ws://127.0.0.1:${ha.port}/websocket`, SCREENSAVER_IDLE_S: '0' });
});
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop(); await ha.close();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});
const ring = (b: unknown) => fetch(srv.local('/doorbell'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

it('chuong cua: mo camera, mo cong bang script da khai, dong / het gio thi quay ve', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-bell', { home, ctl: '1' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  await srv.waitPage((u) => u === home);
  expect((await ring({ camera: 'cong', unlock: 'switch.nguy_hiem' })).status).toBe(400);

  const before = dev.msgs.length;
  expect((await ring({ camera: 'cong', title: 'Cổng trước', unlock: 'script.mo_cong', timeout: 60 })).status).toBe(200);
  const bp = await srv.waitPage((u) => u.includes('/doorbell.html'));
  expect(bp.url).toContain('cam=cong');
  await dev.waitFor(() => dev!.currentUrls().some((u) => u.includes('/doorbell.html')), 8000, 'panel hien chuong');
  expect(dev.msgs.slice(before).some((m) => m[0] === 9 && m[2] === 1)).toBe(true);   // bat den nen
  await sleep(800);
  if (process.env.ITEST_SHOTS) fs.writeFileSync(path.join(process.env.ITEST_SHOTS, 'doorbell-1024x600.png'), await srv.screenshot(bp));

  // Cham "Mo cong"
  const r = await srv.evaluate<number[]>(bp, `(function(){var b=document.getElementById('open').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()`);
  dev.touch(1, Math.round(r[0]), Math.round(r[1])); await sleep(60); dev.touch(3, Math.round(r[0]), Math.round(r[1]));
  for (let i = 0; i < 40 && !ha.calls.some((c) => c.path === 'script.turn_on'); i++) await sleep(150);
  expect(ha.calls.find((c) => c.path === 'script.turn_on')?.body).toEqual({ entity_id: 'script.mo_cong' });
  // Mo xong 6 s -> tu dong -> ve Home Assistant, tab chuong dong
  await dev.waitFor(() => dev!.currentUrls().at(-1) === home, 12_000, 've HA');
  for (let i = 0; i < 20 && (await srv.pageUrls()).some((u) => u.includes('/doorbell.html')); i++) await sleep(200);
  expect((await srv.pageUrls()).some((u) => u.includes('/doorbell.html'))).toBe(false);

  // Het gio (10 s) khong ai tra loi -> tu quay ve
  await ring({ camera: 'cong', timeout: 10 });
  await dev.waitFor(() => dev!.currentUrls().at(-1)!.includes('/doorbell.html'), 8000, 'chuong lan 2');
  await dev.waitFor(() => dev!.currentUrls().at(-1) === home, 16_000, 'het gio ve HA');
  expect(srv.log()).toContain("dong tab \"__doorbell\" (doorbell, het gio)");
});
