// (27/09/2026) Thu tich hop cac ung dung Nha: Phong (cham bat/tat, cham giu dieu hoa), Viec can lam (them nhanh, danh
// dau), Dieu khien TV/loa, Khung anh — Chromium that, cham qua panel gia, Home Assistant gia.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, PageTarget, TestServer, sleep } from './harness.js';
import { FakeHa, startFakeHa } from './fakeHa.js';

let srv: TestServer;
let ha: FakeHa;
let dev: FakeDevice | null = null;
let photos = '';

beforeEach(async () => {
  photos = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-photos-'));
  fs.mkdirSync(path.join(photos, 'he 2026'));
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2563eb' } }).jpeg().toFile(path.join(photos, 'a.jpg'));
  await sharp({ create: { width: 900, height: 1400, channels: 3, background: '#16a34a' } }).jpeg().toFile(path.join(photos, 'he 2026', 'b.jpg'));
  fs.writeFileSync(path.join(photos, 'ghi-chu.txt'), 'x');
  // Anh camera (Frigate) lo nam trong thu muc anh: khong bao gio duoc trinh chieu
  fs.mkdirSync(path.join(photos, 'frigate', 'clips'), { recursive: true });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } }).jpeg().toFile(path.join(photos, 'frigate', 'clips', 'cam-person.jpg'));
  ha = await startFakeHa({
    areas: [{ area_id: 'khach', name: 'Phòng khách' }, { area_id: 'ngu', name: 'Phòng ngủ' }],
    devices: [{ id: 'd_ac', name: 'Điều hoà', area_id: 'ngu' }],
    entities: [
      { entity_id: 'light.phong_khach_den_tran', area_id: 'khach' }, { entity_id: 'switch.quat', area_id: 'khach' },
      { entity_id: 'sensor.nhiet_do', area_id: 'khach' }, { entity_id: 'climate.dieu_hoa', device_id: 'd_ac' },
      { entity_id: 'media_player.tv', area_id: 'khach' }, { entity_id: 'todo.mua_sam' },
    ],
    states: {
      'light.phong_khach_den_tran': { state: 'off', attributes: { friendly_name: 'Phòng khách Đèn trần', supported_color_modes: ['brightness'] } },
      'switch.quat': { state: 'on', attributes: { friendly_name: 'Quạt trần' } },
      'sensor.nhiet_do': { state: '29.4', attributes: { device_class: 'temperature' } },
      'climate.dieu_hoa': { state: 'cool', attributes: { friendly_name: 'Điều hoà', current_temperature: 28, temperature: 26, min_temp: 16, max_temp: 30, target_temp_step: 1, hvac_modes: ['off', 'cool'] } },
      'media_player.tv': { state: 'playing', attributes: { friendly_name: 'TV phòng khách', media_title: 'Thời sự 19h', media_artist: 'VTV1', volume_level: 0.25, supported_features: 16 | 32 | 4 | 384 } },
      'todo.mua_sam': { state: '1', attributes: { friendly_name: 'Mua sắm' } },
    },
    todo: { 'todo.mua_sam': [{ uid: '1', summary: 'Gạo', status: 'needs_action' }] },
  });
  srv = await TestServer.start({
    SUPERVISOR_TOKEN: 'test', HA_API_URL: `http://127.0.0.1:${ha.port}/api`, HA_WS_URL: `ws://127.0.0.1:${ha.port}/websocket`,
    SCREENSAVER_IDLE_S: '0', PHOTOS_DIR: photos,
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
async function openApp(from: PageTarget, id: string, urlPart: string): Promise<PageTarget> {
  await srv.evaluate(from, `window.__rwvControl('{"app":"${id}"}')`);
  return srv.waitPage((u) => u.includes(urlPart));
}
async function tap(p: PageTarget, selector: string, hold = 60) {
  const r = await srv.evaluate<number[] | null>(p, `(function(){var e=${selector};if(!e)return null;var b=e.getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()`);
  expect(r, selector).not.toBeNull();
  dev!.touch(1, Math.round(r![0]), Math.round(r![1])); await sleep(hold); dev!.touch(3, Math.round(r![0]), Math.round(r![1]));
  await sleep(250);
}
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (ok(v)) return v; if (Date.now() > end) throw new Error('het gio: ' + what); await sleep(150); }
}

it('Phong / Viec can lam / Dieu khien / Khung anh: cham tren panel -> dung dich vu HA', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-apps', { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const hp = await srv.waitPage((u) => u === home);

  // ── Phong
  const rp = await openApp(hp, 'rooms', '/rooms.html');
  const rooms = await until(() => srv.evaluate<any[]>(rp, 'window.__rwvRooms ? window.__rwvRooms() : []'), (r) => r.length === 2, 'phong');
  expect(rooms.map((r: any) => r.name)).toEqual(['Phòng khách', 'Phòng ngủ']);
  expect(rooms[0].temp).toBe(29.4);
  await sleep(300);
  await shot(rp, 'app-rooms-1024x600');
  await tap(rp, `document.querySelector('.t[data-id="light.phong_khach_den_tran"]')`);
  await until(async () => ha.calls, (c) => c.some((x) => x.path === 'light.toggle'), 'bat den');
  // Cham giu dieu hoa -> bang; + hai lan -> dat 28 do sau 0,7 s
  await tap(rp, `document.querySelector('.t[data-id="climate.dieu_hoa"]')`, 650);
  await until(() => srv.evaluate<boolean>(rp, '!!document.querySelector(".sheet")'), (v) => v, 'bang dieu hoa');
  await shot(rp, 'app-rooms-climate-1024x600');
  await tap(rp, `[...document.querySelectorAll('.sheet .rwv-btn')].find(b=>b.textContent==='+')`);
  await tap(rp, `[...document.querySelectorAll('.sheet .rwv-btn')].find(b=>b.textContent==='+')`);
  const c = await until(async () => ha.calls.find((x) => x.path === 'climate.set_temperature'), (v) => !!v, 'dat nhiet do', 4000);
  expect(c!.body).toEqual({ entity_id: 'climate.dieu_hoa', temperature: 28 });

  // ── Viec can lam: cham chip "+ Sữa" -> add_item; cham "Gạo" -> hoan thanh
  const tp = await openApp(rp, 'todo', '/todo.html');
  await until(() => srv.evaluate<any>(tp, 'window.__rwvTodo ? window.__rwvTodo().items.length : 0'), (n) => n === 1, 'muc todo');
  await tap(tp, `[...document.querySelectorAll('.quick .chip')].find(c=>c.textContent==='+ Sữa')`);
  await until(async () => ha.calls, (cs) => cs.some((x) => x.path === 'todo.add_item' && x.body.item === 'Sữa'), 'them Sua');
  await tap(tp, `[...document.querySelectorAll('.it')].find(i=>i.textContent.includes('Gạo'))`);
  await until(async () => ha.calls, (cs) => cs.some((x) => x.path === 'todo.update_item' && x.body.status === 'completed'), 'xong Gao');
  await until(() => srv.evaluate<any>(tp, 'window.__rwvTodo().items.map(i=>i.summary+(i.done?"✓":"")).join(",")'), (s) => s === 'Gạo✓,Sữa' || s === 'Sữa,Gạo✓', 'dong bo lai');
  await sleep(300);
  await shot(tp, 'app-todo-1024x600');

  // ── Dieu khien
  const mp = await openApp(tp, 'remote', '/remote.html');
  await until(() => srv.evaluate<any[]>(mp, 'window.__rwvRemote ? window.__rwvRemote() : []'), (l) => l.length === 1, 'tv');
  await sleep(300);
  await shot(mp, 'app-remote-1024x600');
  await tap(mp, `document.querySelector('.ctl button.main')`);
  await until(async () => ha.calls, (cs) => cs.some((x) => x.path === 'media_player.media_play_pause'), 'tam dung');

  // ── Khung anh: tim anh trong thu muc con, bo file khong phai anh; anh thu nho dung kich thuoc man hinh
  const pp = await openApp(mp, 'photos', '/photos.html');
  const f = await until(() => srv.evaluate<string | null>(pp, 'window.__rwvPhoto || null'), (v) => !!v, 'anh dau tien');
  expect(['a.jpg', 'he 2026/b.jpg']).toContain(f);
  expect((await (await fetch(srv.local('/photos/list'))).json()).files).toEqual(['a.jpg', 'he 2026/b.jpg']);
  const meta = await sharp(Buffer.from(await (await fetch(srv.local('/photos/img?f=' + encodeURIComponent('he 2026/b.jpg') + '&w=1024&h=600'))).arrayBuffer())).metadata();
  expect([meta.width, meta.height]).toEqual([1024, 600]);
  expect((await fetch(srv.local('/photos/img?f=' + encodeURIComponent('../etc/passwd')))).status).toBe(404);
  await sleep(900);
  await shot(pp, 'app-photos-1024x600');
});
