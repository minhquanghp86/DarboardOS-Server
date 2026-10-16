// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) Chao buoi sang + Bang tin: ghi chu gui tu HA -> the thong bao + luu; camera thay nguoi lan dau trong
// khung gio sang -> mo "Hom nay" va doc tom tat (tts.speak toi media_player cua CHINH panel); lan sau trong ngay: khong.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';
import { FakeHa, startFakeHa } from './fakeHa.js';

const DEV_ID = 'esp32-0a0b0c0d0002';
let srv: TestServer;
let ha: FakeHa;
let dev: FakeDevice | null = null;
let boardFile = '';
const tzFor = (h: number) => { const u = new Date().getUTCHours(); return (((h - u) % 24 + 24) % 24) * 60; };

beforeEach(async () => {
  boardFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-board-')), 'board.json');
  ha = await startFakeHa({
    devices: [{ id: 'dP4', name: 'P4', connections: [['mac', '0a:0b:0c:0d:00:02']] }],
    entities: [{ entity_id: 'media_player.p4_speaker', device_id: 'dP4' }, { entity_id: 'todo.mua_sam' }],
    states: {
      'media_player.p4_speaker': { state: 'idle', attributes: {} },
      'tts.piper': { state: 'unknown', attributes: {} },
      'todo.mua_sam': { state: '1', attributes: { friendly_name: 'Mua sắm' } },
    },
    todo: { 'todo.mua_sam': [{ uid: '1', summary: 'Sữa', status: 'needs_action' }] },
    calendars: { 'calendar.gia_dinh': [{ summary: 'Họp phụ huynh', start: { dateTime: '2026-09-27T14:30:00+07:00' }, end: { dateTime: '2026-09-27T15:30:00+07:00' } }] },
  });
  srv = await TestServer.start({
    SUPERVISOR_TOKEN: 'test', HA_API_URL: `http://127.0.0.1:${ha.port}/api`, HA_WS_URL: `ws://127.0.0.1:${ha.port}/websocket`,
    SCREENSAVER_IDLE_S: '0', BOARD_FILE: boardFile, MORNING_TTS: 'true',
  });
});
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop(); await ha.close();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});
const shot = async (p: PageTarget, name: string) => {
  const dir = process.env.ITEST_SHOTS; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.png'), await srv.screenshot(p));
};

it('ghi chu tu HA + chao buoi sang (mo Hom nay, doc qua loa panel) mot lan moi ngay', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, DEV_ID, { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true, tzMin: tzFor(7) });
  await srv.waitPage((u) => u === home);
  await sleep(500);

  // Ghi chu gui tu HA (LAN) -> luu file + the thong bao tren panel
  const r = await fetch(srv.local('/board'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Con nhớ mang áo mưa', by: 'Mẹ', color: 'pink' }) });
  expect(r.status).toBe(200);
  expect(JSON.parse(fs.readFileSync(boardFile, 'utf8'))[0]).toMatchObject({ text: 'Con nhớ mang áo mưa', by: 'Mẹ', color: 'pink' });
  expect(srv.log()).toContain('[notify] ' + DEV_ID + ': "Ghi chú mới · Mẹ"');
  expect((await fetch(srv.local('/board'), { method: 'POST', body: '{"text":" "}' })).status).toBe(400);

  // Camera thay nguoi 7h sang -> "Hom nay" + tts.speak toi loa cua chinh panel
  dev.event(2, 1);
  const tp = await srv.waitPage((u) => u.includes('/today.html'));
  for (let i = 0; i < 60 && !ha.calls.some((c) => c.path === 'tts.speak'); i++) await sleep(200);
  const tts = ha.calls.find((c) => c.path === 'tts.speak');
  expect(tts?.body).toMatchObject({ entity_id: 'tts.piper', media_player_entity_id: 'media_player.p4_speaker' });
  expect(tts!.body.message).toContain('Chào buổi sáng.');
  expect(tts!.body.message).toContain('Họp phụ huynh lúc 14 giờ 30');
  expect(tts!.body.message).toContain('Có 1 việc cần làm, gồm Sữa.');
  expect(tts!.body.message).toContain('Ghi chú: Con nhớ mang áo mưa.');
  for (let i = 0; i < 40 && !(await srv.evaluate(tp, '!!window.__rwvToday')); i++) await sleep(200);
  await sleep(400);
  await shot(tp, 'app-today-1024x600');

  // Di ra roi quay lai trong ngay -> khong chao lan hai
  dev.event(2, 0); await sleep(200); dev.event(2, 1); await sleep(1500);
  expect(srv.log().match(/\[morning\] [\w-]+: chao buoi sang/g)?.length).toBe(1);
  expect(ha.calls.filter((c) => c.path === 'tts.speak').length).toBe(1);

  // Bang tin tren panel
  await srv.evaluate(tp, `window.__rwvControl('{"app":"board"}')`);
  const bp = await srv.waitPage((u) => u.includes('/board.html'));
  for (let i = 0; i < 30 && !(await srv.evaluate(bp, '(window.__rwvBoard||[]).length')); i++) await sleep(200);
  expect(await srv.evaluate(bp, '(window.__rwvBoard||[]).map(n=>n.text)')).toEqual(['Con nhớ mang áo mưa']);
  await shot(bp, 'app-board-1024x600');
});

it('mac dinh (morning_tts tat): chao buoi sang chi mo "Hom nay", KHONG doc qua loa', async () => {
  await srv.stop();
  srv = await TestServer.start({
    SUPERVISOR_TOKEN: 'test', HA_API_URL: `http://127.0.0.1:${ha.port}/api`, HA_WS_URL: `ws://127.0.0.1:${ha.port}/websocket`,
    SCREENSAVER_IDLE_S: '0', BOARD_FILE: boardFile,
  });
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, DEV_ID, { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true, tzMin: tzFor(7) });
  await srv.waitPage((u) => u === home);
  dev.event(2, 1);
  await srv.waitPage((u) => u.includes('/today.html'));
  await sleep(2000);
  expect(ha.calls.some((c) => c.path === 'tts.speak')).toBe(false);
});

it('man hinh da tat "Chao buoi sang" o Cai dat: khong mo "Hom nay"', async () => {
  await srv.stop();
  const prefs = path.join(path.dirname(boardFile), 'prefs.json');
  fs.writeFileSync(prefs, JSON.stringify({ [DEV_ID]: { morning: false } }));
  srv = await TestServer.start({
    SUPERVISOR_TOKEN: 'test', HA_API_URL: `http://127.0.0.1:${ha.port}/api`, HA_WS_URL: `ws://127.0.0.1:${ha.port}/websocket`,
    SCREENSAVER_IDLE_S: '0', BOARD_FILE: boardFile, PANEL_PREFS_FILE: prefs,
  });
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, DEV_ID, { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.deviceState({ backlightOn: true, tzMin: tzFor(7) });
  await srv.waitPage((u) => u === home);
  dev.event(2, 1);
  await sleep(2500);
  expect((await srv.pageUrls()).some((u) => u.includes('/today.html'))).toBe(false);
  expect(srv.log()).not.toContain('[morning]');
});
