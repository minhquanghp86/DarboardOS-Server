// (26/09/2026 OS-5) Thu tich hop man hinh cho: hien sau thoi gian khong cham, cham thi tat va hen lai tu dau.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '3' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});


it('hien man hinh cho sau khi khong cham; cham thi tat; den nen tat thi khong hien', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-saver', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true });
  const ha = await srv.waitPage((u) => u === home);
  // Shadow DOM dong: theo doi qua API cua Shell — boc screensaver() de ghi lai lan goi.
  await srv.evaluate(ha, `(() => { const f = window.__rwvShell.screensaver; window.__rwvShell.screensaver = (on) => { window.__itestSaver = on; return f(on); }; })()`);
  const waitSaver = async (want: boolean, ms: number) => {
    for (let t = 0; t < ms; t += 250) { if ((await srv.evaluate(ha, 'window.__itestSaver === true')) === want) return; await sleep(250); }
    throw new Error(`man hinh cho != ${want}`);
  };
  await waitSaver(true, 12_000);
  expect(srv.log()).toContain('[saver] it-saver: hien man hinh cho');

  // Cham (nhu nguoi dung cham vao man hinh cho) -> server dat lai moc; lan hien sau phai cho du 3 s nua.
  await srv.evaluate(ha, `window.__rwvShell.screensaver(false); window.__itestSaver = false; window.__rwvControl('{"wake":1}')`);
  dev.touch(1, 500, 300); dev.touch(3, 500, 300);
  await sleep(1_500);
  expect(await srv.evaluate(ha, 'window.__itestSaver')).toBe(false);
  await waitSaver(true, 12_000);

  // Den nen tat -> khong hien lai
  await srv.evaluate(ha, `window.__rwvShell.screensaver(false); window.__itestSaver = false; window.__rwvControl('{"wake":1}')`);
  dev.deviceState({ backlightOn: false });
  await sleep(6_000);
  expect(await srv.evaluate(ha, 'window.__itestSaver')).toBe(false);
});
