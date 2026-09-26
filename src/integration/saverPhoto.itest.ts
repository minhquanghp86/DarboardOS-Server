// (27/09/2026) Man hinh cho dang KHUNG ANH SO: ban ngay -> anh (dung kich thuoc man hinh, theo cai dat cua man hinh:
// thu tu, hieu ung, kieu hien thi, chu thich); VUOT trai/phai -> anh sau/truoc; album Google loi mang -> van dung thu
// muc; ban dem -> chi dong ho.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';

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
const DEV = 'it-svp';

async function start(hour: number, prefs: Record<string, unknown> = {}): Promise<PageTarget> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-sv-'));
  fs.mkdirSync(path.join(dir, 'Đà Lạt'));
  for (const [n, c] of [['a.jpg', '#ea580c'], ['b.jpg', '#2563eb'], ['Đà Lạt/c.jpg', '#16a34a']]) {
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: c } }).jpeg().toFile(path.join(dir, n));
  }
  const pf = path.join(dir, '..', path.basename(dir) + '-prefs.json');
  fs.writeFileSync(pf, JSON.stringify({ [DEV]: prefs, __global: { gphotosUrl: 'https://photos.app.goo.gl/KhongTonTai123' } }));
  srv = await TestServer.start({ SCREENSAVER_IDLE_S: '2', PHOTOS_DIR: dir, PANEL_PREFS_FILE: pf });
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, DEV, { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true, tzMin: tzFor(hour) });
  const hp = await srv.waitPage((u) => u === home);
  await srv.evaluate(hp, `(() => { window.__sv = []; const f = window.__rwvShell.saverPhoto; window.__rwvShell.saverPhoto = (o) => { window.__sv.push(o); return f(o); }; })()`);
  return hp;
}
const shown = (p: PageTarget) => srv!.evaluate<any[]>(p, 'window.__sv');
async function waitCount(p: PageTarget, n: number, ms = 20_000) {
  for (let t = 0; t < ms; t += 250) { if ((await shown(p)).length >= n) return; await sleep(250); }
  throw new Error(`chua du ${n} anh`);
}
async function swipe(x0: number, x1: number) {
  dev!.touch(1, x0, 300);
  for (let i = 1; i <= 6; i++) { dev!.touch(2, Math.round(x0 + (x1 - x0) * i / 6), 300); await sleep(30); }
  dev!.touch(3, x1, 300);
  await sleep(1200);
}

it('ban ngay: khung anh theo cai dat man hinh, vuot trai/phai xem anh sau/truoc, album loi van dung thu muc', async () => {
  const hp = await start(12, { photoOrder: 'name', photoEffect: 'slide', photoFit: 'frame', photoIntervalS: 300 });
  await waitCount(hp, 1);
  await sleep(1500);
  let l = await shown(hp);
  expect(l[0]).toMatchObject({ fx: 'slide', clock: true, dir: 1 });
  expect(l[0].url).toMatch(/\/photos\/img\?f=a\.jpg&w=1024&h=600&fit=frame$/);   // theo thu tu ten; album loi -> thu muc
  if (process.env.ITEST_SHOTS) fs.writeFileSync(path.join(process.env.ITEST_SHOTS, 'saver-frame-1024x600.png'), await srv!.screenshot(hp));

  await swipe(700, 250);                         // vuot trai -> anh sau
  await waitCount(hp, 2);
  l = await shown(hp);
  expect(l[1].url).toContain('f=b.jpg');
  await swipe(250, 700);                         // vuot phai -> anh truoc
  await waitCount(hp, 3);
  l = await shown(hp);
  expect(l[2]).toMatchObject({ dir: -1 });
  expect(l[2].url).toContain('f=a.jpg');
  expect(await srv!.evaluate(hp, '!!window.__rwvSaverShown')).toBe(true);   // man hinh cho van hien (vuot khong thoat)

  // Anh trong thu muc con: chu thich = ten thu muc
  await swipe(700, 250); await swipe(700, 250);
  await waitCount(hp, 5);
  l = await shown(hp);
  expect(l[4].url).toContain(encodeURIComponent('Đà Lạt/c.jpg'));
  expect(l[4].cap).toBe('Đà Lạt');
});

it('ban dem: chi dong ho, khong anh', async () => {
  const hp = await start(23);
  await sleep(9000);
  expect(await shown(hp)).toEqual([]);
});
