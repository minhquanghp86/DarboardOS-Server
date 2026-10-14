// (26/09/2026 OS-5) Thu tich hop man hinh cho: hien sau thoi gian khong cham, cham thi tat va hen lai tu dau.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
// (14/10/2026) 5 s (truoc 3 s): 3 s thi man hinh cho co luc hien TRUOC khi test kip gan bo theo doi -> bo lo.
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '5' }); });
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
  await srv.evaluate(ha, `(() => { const f = window.__rwvShell.screensaver; window.__rwvShell.screensaver = (on) => { window.__itestSaver = !!on; return f(on); }; })()`);
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

it('mo URL tu HA / trang bat dau phat video khi man hinh cho dang hien -> tat, khong phu len tab moi (loi 2.9.52)', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-saver2', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true });
  const ha = await srv.waitPage((u) => u === home);
  const spy = `(() => { const f = window.__rwvShell.screensaver; window.__rwvShell.screensaver = (on) => { window.__itestSaver = !!on; return f(on); }; })()`;
  await srv.evaluate(ha, spy);
  const waitOn = async (p: typeof ha, want: boolean, ms: number) => {
    for (let t = 0; t < ms; t += 250) { if ((await srv.evaluate(p, 'window.__itestSaver === true')) === want) return; await sleep(250); }
    throw new Error(`man hinh cho != ${want}`);
  };
  await waitOn(ha, true, 12_000);

  // Trang dang hien bat dau phat video -> man hinh cho tat ngay
  await srv.evaluate(ha, `window.__rwvControl('{"media":1}')`);
  await waitOn(ha, false, 3_000);
  await srv.evaluate(ha, `window.__rwvControl('{"media":0}')`);
  await waitOn(ha, true, 12_000);

  // HA mo URL (nhu "URL hien thi" / tu dong hoa): tab cu go man hinh cho, tab moi KHONG bi phu trong 2 s dau
  const url = srv.local('/weather.html?tu=ha');
  dev.openUrl(url);
  const w = await srv.waitPage((u) => u === url);
  await srv.evaluate(w, spy);
  await sleep(2_000);
  expect(await srv.evaluate(w, 'window.__itestSaver === true')).toBe(false);
  expect(srv.log()).toContain('tat man hinh cho (mo URL)');
  // (30/09/2026) Tab cu nay o nen, JavaScript bi tam dung (freezeTab) — server go man hinh cho khoi no TRUOC khi dung.
  // Quay lai tab cu roi kiem tra (truoc day doc thang tab nen).
  await srv.evaluate(w, `window.__rwvControl('{"app":"home"}')`);
  await sleep(500);
  expect(await srv.evaluate(ha, 'window.__itestSaver === true')).toBe(false);
});
