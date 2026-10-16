// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026 OS-3) Thu tich hop man hinh chinh: cham giu -> che do sap xep, keo doi cho, gop thu muc, keo xuong dock;
// bo cuc luu vao launcher.json va con nguyen sau khi tai lai trang.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
let cfgFile = '';
beforeEach(async () => {
  cfgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-home-')), 'launcher.json');
  srv = await TestServer.start({ LAUNCHER_CONFIG_FILE: cfgFile, SCREENSAVER_IDLE_S: '0' });
});
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

interface Info { editing: boolean; folder: string | null; page: number; layout: { dock: string[]; items: any[] }; tiles: Record<string, number[]> }
const shot = async (p: PageTarget, name: string) => {
  const dir = process.env.ITEST_SHOTS; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.png'), await srv.screenshot(p));
};
const info = (p: PageTarget) => srv.evaluate<Info>(p, 'window.__rwvShell.homeInfo()');
const center = (r: number[], fx = 0.5, fy = 0.35) => [Math.round(r[0] + r[2] * fx), Math.round(r[1] + r[3] * fy)];
const keys = (items: any[]) => items.map((x) => (typeof x === 'string' ? x : `[${x.a.join(',')}]`));

/** Cham giu tai (x0,y0) roi keo tung buoc toi (x1,y1), giu yen `hold` ms, tha. */
async function dragTo(x0: number, y0: number, x1: number, y1: number, holdFirst: number, hold = 150) {
  dev!.touch(1, x0, y0);
  await sleep(holdFirst);
  const n = 10;
  for (let i = 1; i <= n; i++) { dev!.touch(2, Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n)); await sleep(40); }
  for (let t = 0; t < hold; t += 100) { dev!.touch(2, x1, y1); await sleep(100); }
  dev!.touch(3, x1, y1);
  await sleep(400);
}
const saved = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8')).home;

it('Man hinh chinh: cham giu keo doi cho, gop thu muc, dua xuong dock, luu va giu sau khi tai lai', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-home', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const ha = await srv.waitPage((u) => u === home);
  await srv.evaluate(ha, `window.__rwvControl('{"app":"__system"}')`);
  const hp = await srv.waitPage((u) => u.endsWith('/os/home'));
  await sleep(1500);
  let s = await info(hp);
  expect(s.editing).toBe(false);
  expect(s.layout.dock[0]).toBe('home');
  const before = keys(s.layout.items);
  const [a, b] = [before[0], before[1]];

  // 1) Cham giu o thu 2 roi keo sang NUA TRAI o thu 1 -> doi cho
  let [x0, y0] = center(s.tiles[b]);
  let [x1, y1] = center(s.tiles[a], 0.12);
  await dragTo(x0, y0, x1, y1, 700);
  s = await info(hp);
  expect(s.editing).toBe(true);
  expect(keys(s.layout.items).slice(0, 2)).toEqual([b, a]);
  expect(keys(saved().items).slice(0, 2)).toEqual([b, a]);

  // 2) Dang sap: keo o thu 3 tha vao GIUA o thu 1 (giu 500 ms) -> thu muc
  const c = keys(s.layout.items)[2];
  [x0, y0] = center(s.tiles[c]);
  [x1, y1] = center(s.tiles[b], 0.5, 0.3);
  await dragTo(x0, y0, x1, y1, 300, 500);
  s = await info(hp);
  const f = s.layout.items[0];
  expect(typeof f).toBe('object');
  expect(f.a).toEqual([b, c]);
  expect(saved().items[0].a).toEqual([b, c]);
  await shot(hp, 'home-editing-1024x600');

  // 3) Cham thu muc -> mo; chon ten "Hay dùng"
  const [fx, fy] = center(s.tiles[f.f]);
  dev.touch(1, fx, fy); await sleep(80); dev.touch(3, fx, fy); await sleep(500);
  s = await info(hp);
  expect(s.folder).toBe(f.f);
  await shot(hp, 'home-folder-1024x600');

  // 4) Keo mot ung dung trong thu muc ra ngoai -> thu muc con 1 -> thanh ung dung thuong
  [x0, y0] = center(s.tiles[c]);
  await dragTo(x0, y0, 40, 560, 300, 200);
  s = await info(hp);
  expect(s.folder).toBe(null);
  expect(keys(s.layout.items)).not.toContain(`[${b},${c}]`);
  expect(keys(s.layout.items).filter((k) => k === b || k === c).length).toBe(2);

  // 5) Keo mot ung dung xuong dock (dock mac dinh 5 -> day: khong vao); keo ung dung trong dock len luoi
  const d0 = s.layout.dock.length;
  const last = s.layout.dock[d0 - 1];
  [x0, y0] = center(s.tiles[last]);
  [x1, y1] = center(s.tiles[keys(s.layout.items)[0]], 0.1);
  await dragTo(x0, y0, x1, y1, 300);
  s = await info(hp);
  expect(s.layout.dock).not.toContain(last);
  expect(keys(s.layout.items)[0]).toBe(last);

  // 6) Xong -> thoat; tai lai trang -> bo cuc van nhu cu (server chen vao __RWV_CFG)
  const expected = s.layout;
  await srv.evaluate(hp, 'location.reload()');
  await sleep(2500);
  const hp2 = await srv.waitPage((u) => u.endsWith('/os/home'));
  s = await info(hp2);
  expect(s.editing).toBe(false);
  expect(s.layout).toEqual(expected);

  // 7) Trang khac (khong phai man hinh chinh) gui bo cuc -> bi bo qua
  // (30/09/2026) Tab nen bi tam dung JavaScript (freezeTab) -> dua tab HA ra truoc roi moi gui tu no.
  await srv.evaluate(hp2, `window.__rwvControl('{"app":"home"}')`);
  await sleep(800);
  const ha2 = (await srv.pages()).find((p) => p.url === home)!;
  await srv.evaluate(ha2, `window.__rwvControl(JSON.stringify({ home: { dock: [], items: [] } }))`);
  await sleep(600);
  expect(saved()).toEqual(expected);
});
