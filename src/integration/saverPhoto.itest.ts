// (27/09/2026) Man hinh cho dang khung anh: ban ngay -> URL anh (dung kich thuoc man hinh); ban dem -> chi dong ho.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer | null = null;
let dev: FakeDevice | null = null;
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv?.log() ?? '';
  await srv?.stop(); srv = null;
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

/** Mui gio (phut) de gio thiet bi bay gio la `h` gio. */
const tzFor = (h: number) => { const u = new Date().getUTCHours(); return (((h - u) % 24 + 24) % 24) * 60; };

async function run(hour: number): Promise<{ urls: (string | null)[]; shot: Buffer }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-sv-'));
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#ea580c' } }).jpeg().toFile(path.join(dir, 'x.jpg'));
  srv = await TestServer.start({ SCREENSAVER_IDLE_S: '2', PHOTOS_DIR: dir });
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-svp', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true, tzMin: tzFor(hour) });
  const hp = await srv.waitPage((u) => u === home);
  await srv.evaluate(hp, `(() => { window.__svUrls = []; const f = window.__rwvShell.saverPhoto; window.__rwvShell.saverPhoto = (u) => { window.__svUrls.push(u); return f(u); }; })()`);
  for (let t = 0; t < 40; t++) { if ((await srv.evaluate<number>(hp, 'window.__svUrls.length')) > 0) break; await sleep(300); }
  await sleep(1500);
  return { urls: await srv.evaluate(hp, 'window.__svUrls'), shot: await srv.screenshot(hp) };
}

it('ban ngay: man hinh cho hien anh gia dinh dung kich thuoc man hinh', async () => {
  const r = await run(12);
  expect(r.urls.length).toBeGreaterThan(0);
  expect(r.urls[0]).toMatch(/\/photos\/img\?f=x\.jpg&w=1024&h=600$/);
  if (process.env.ITEST_SHOTS) fs.writeFileSync(path.join(process.env.ITEST_SHOTS, 'saver-photo-1024x600.png'), r.shot);
});

it('ban dem: chi dong ho, khong anh', async () => {
  const r = await run(23);
  expect(r.urls).toEqual([]);
});
