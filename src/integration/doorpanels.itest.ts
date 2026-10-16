// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (16/10/2026) Cai dat chuong cong: chon BAT KY man nao (ke ca man KHONG co loa / camera) de do chuong; chon nhieu man; cac man da chon
// deu offline -> do tat ca man dang ket noi.
import { afterEach, beforeEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
const devs: FakeDevice[] = [];
let door: WebSocket | null = null;
beforeEach(async () => { srv = await TestServer.start({ SCREENSAVER_IDLE_S: '0' }); });
afterEach(async (ctx) => {
  door?.close(); door = null; devs.splice(0).forEach((d) => d.close());
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});
const cfg = async (b?: unknown) => (await (await fetch(srv.local('/door/config'), b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {})).json()) as any;
const ringed = (d: FakeDevice) => d.currentUrls().some((u) => u.includes('/door.html'));

it('chon man khong co loa / nhieu man; man chon offline -> do moi man', async () => {
  const home = srv.local('/ha');
  // A: co loa (audio=1) · B: KHONG loa · C: KHONG loa
  for (const [id, extra] of [['it-a', { audio: '1' }], ['it-b', {}], ['it-c', {}]] as const) {
    devs.push(await FakeDevice.connect(srv, id, { home, ctl: '1', ...extra }));
  }
  await Promise.all(devs.map((d) => d.waitFor(() => d.currentUrls().includes(home), 20_000, 'ket noi')));
  const ids = ((await cfg()).panels as { id: string }[]).map((p) => p.id).sort();
  expect(ids).toEqual(['it-a', 'it-b', 'it-c']);   // man KHONG loa cung hien trong danh sach

  door = new WebSocket(`ws://127.0.0.1:${srv.wsPort}/?id=esp32-aabbccddee02&door=1&sn=0&mj=0&name=Cong`);
  await new Promise<void>((r, j) => { door!.once('open', () => r()); door!.once('error', j); });
  await sleep(300);
  const press = () => door!.send(Buffer.from([12, 1, 3, 1]));

  // Chi chon B va C (khong co loa) -> hai man do chuong, A khong
  await cfg({ ringPanels: ['it-b', 'it-c'], ringS: 20, gateS: 3 });
  press();
  await devs[1].waitFor(() => ringed(devs[1]), 10_000, 'B do chuong');
  await devs[2].waitFor(() => ringed(devs[2]), 10_000, 'C do chuong');
  await sleep(500);
  expect(ringed(devs[0])).toBe(false);

  // Man da chon deu offline (id khong ton tai) -> do moi man dang ket noi
  await sleep(5500);                                 // chong bam lien tiep 5 s
  await cfg({ ringPanels: ['khong-ton-tai'], ringS: 20, gateS: 3 });
  const j = await cfg();
  expect(j.panels.find((p: any) => p.id === 'khong-ton-tai')).toMatchObject({ online: false });
  press();
  await devs[0].waitFor(() => ringed(devs[0]), 10_000, 'A do chuong (fallback)');
});
