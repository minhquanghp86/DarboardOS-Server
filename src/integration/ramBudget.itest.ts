// (30/09/2026) Ngan sach RAM: tab nen khong dung qua IDLE_TAB_CLOSE_MIN -> dong han (giai phong renderer Chromium) nhung
// VAN con trong "Gan day" (anh + URL cu); cham the = mo lai dung trang. /metrics bao RAM/swap may chu.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ MAX_APP_TABS: '3', IDLE_TAB_CLOSE_MIN: '0.05' }); });  // 3 s
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

type Card = { k: string; l: string; t: string | null; p: boolean; a: boolean };
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

it('tab nen nhan roi bi dong, van o Gan day, cham = mo lai dung URL', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-ram', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const ha = await srv.waitPage((u) => u === home);
  await control(ha, { app: 'weather' });
  const weather = await srv.waitPage((u) => u.includes('/weather.html'));
  await control(weather, { app: 'home' });                                   // weather -> nen
  await dev.waitFor(() => dev!.currentUrls().slice(-1)[0] === home, 10_000, 've HA');

  // Sau ~3 s + nhip 5 s: tab weather bi dong han.
  for (let i = 0; i < 40 && (await srv.pageUrls()).some((u) => u.includes('/weather.html')); i++) await sleep(500);
  expect((await srv.pageUrls()).some((u) => u.includes('/weather.html'))).toBe(false);
  expect(srv.log()).toMatch(/dong tab "weather" .*khong dung qua/);

  await control(ha, { recents: 1 });
  const l = await recentsOn(ha, (x) => x.some((c) => c.k === 'weather'));
  expect(l.find((c) => c.k === 'weather')!.t).toMatch(/^data:image\/jpeg;base64,/);   // van con anh thu nho

  await control(ha, { app: 'weather' });                                     // cham the -> mo lai
  await srv.waitPage((u) => u.includes('/weather.html'));
  await dev.waitFor(() => dev!.currentUrls().some((u) => u.includes('/weather.html')), 10_000, 'mo lai weather');

  const m = JSON.parse(await (await fetch(srv.local('/metrics'))).text());
  expect(m.host.totalMb).toBeGreaterThan(0);
  expect(typeof m.host.swapUsedMb).toBe('number');
});
