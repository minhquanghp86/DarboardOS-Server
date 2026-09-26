// (26/09/2026 OS-5) Thu tich hop thong bao: POST /notify -> the noi + lich su; Khong lam phien; cham the mo ung dung.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '0' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

async function post(body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(srv.local('/notify'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

it('thong bao: the noi + lich su, Khong lam phien chan thuong/cho khan, cham the mo ung dung', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-nt', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const ha = await srv.waitPage((u) => u === home);
  const last = () => srv.evaluate<{ id: number; t: string } | null>(ha, 'window.__rwvLastNotice || null');
  const hist = () => srv.evaluate<{ t: string }[]>(ha, '(window.__rwvLastState && window.__rwvLastState.nt) || []');

  expect((await post({})).status).toBe(400);
  const r = await post({ title: 'Máy giặt', message: 'Đã giặt xong', app: 'weather' });
  expect(r.json).toEqual({ ok: true, devices: ['it-nt'] });
  await sleep(500);
  expect((await last())?.t).toBe('Máy giặt');
  expect((await hist()).map((n) => n.t)).toEqual(['Máy giặt']);

  // Khong lam phien: thong bao thuong vao lich su nhung KHONG noi; khan cap (chuong cua) van noi.
  await srv.evaluate(ha, `window.__rwvControl('{"f":"dnd","v":1}')`);
  await sleep(300);
  await post({ title: 'Nhắc việc', message: 'Uống nước' });
  await sleep(500);
  expect((await last())?.t).toBe('Máy giặt');
  expect((await hist()).map((n) => n.t)).toEqual(['Nhắc việc', 'Máy giặt']);
  expect(await srv.evaluate(ha, 'window.__rwvLastState.dnd')).toBe(true);
  await post({ title: 'Chuông cửa', message: 'Có người ở cổng', priority: 'critical' });
  await sleep(500);
  expect((await last())?.t).toBe('Chuông cửa');

  // Cham thong bao "Máy giặt" (co app) -> mo Thoi tiet, va bo khoi lich su.
  const id = (await srv.evaluate<{ id: number; t: string }[]>(ha, 'window.__rwvLastState.nt')).find((n) => n.t === 'Máy giặt')!.id;
  await srv.evaluate(ha, `window.__rwvControl(${JSON.stringify(JSON.stringify({ ntOpen: id }))})`);
  await dev.waitFor(() => dev!.currentUrls().some((u) => u.includes('/weather.html')), 10_000, 'mo ung dung cua thong bao');
  const weather = await srv.waitPage((u) => u.includes('/weather.html'));
  await sleep(500);
  expect((await srv.evaluate<{ t: string }[]>(weather, 'window.__rwvLastState.nt')).map((n) => n.t)).toEqual(['Chuông cửa', 'Nhắc việc']);

  // Xoa het
  await srv.evaluate(weather, `window.__rwvControl('{"ntClear":1}')`);
  await sleep(400);
  expect(await srv.evaluate(weather, 'window.__rwvLastState.nt.length')).toBe(0);
});
