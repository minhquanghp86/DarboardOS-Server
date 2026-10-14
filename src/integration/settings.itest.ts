// (26/09/2026 OS-4) Thu tich hop trang Cai dat voi mot Home Assistant GIA (REST + WebSocket): tim thiet bi theo MAC,
// doc thuc the, doi cai dat -> HA nhan dung dich vu; trang khong phai Cai dat thi bi tu choi.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { FakeDevice, TestServer, sleep } from './harness.js';

const DEV_ID = 'esp32-0a0b0c0d0002';
let srv: TestServer;
let ha: FakeHa;
let dev: FakeDevice | null = null;

interface FakeHa { port: number; calls: { path: string; body: any }[]; close(): Promise<void> }

async function startFakeHa(): Promise<FakeHa> {
  const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
  const calls: { path: string; body: any }[] = [];
  const st: Record<string, any> = {
    'switch.p4_man_hinh_cho': { state: 'off', attributes: { friendly_name: 'P4 Màn hình chờ' } },
    'number.p4_sleep_time': { state: '15', attributes: { friendly_name: 'P4 Sleep time', min: 0, max: 180, step: 5, unit_of_measurement: 's' } },
    'select.p4_xoay_man_hinh': { state: '0', attributes: { friendly_name: 'P4 Xoay màn hình', options: ['0', '90', '180', '270'] } },
    'button.p4_factory_default_settings': { state: 'unknown', attributes: { friendly_name: 'P4 Factory Default Settings' } },
    'sensor.p4_wifi_signal': { state: '-58', attributes: { friendly_name: 'P4 WiFi Signal', unit_of_measurement: 'dBm' } },
  };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test') { res.writeHead(401); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/api/states') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(Object.entries(st).map(([entity_id, s]) => ({ entity_id, ...s }))));
        return;
      }
      const m = /^\/api\/services\/(\w+)\/(\w+)$/.exec(req.url || '');
      if (m && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        calls.push({ path: `${m[1]}.${m[2]}`, body: b });
        if (m[1] === 'switch') st[b.entity_id].state = m[2] === 'turn_on' ? 'on' : 'off';
        if (m[1] === 'number') st[b.entity_id].state = String(b.value);
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]');
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  const wss = new WebSocketServer({ server, path: '/websocket' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'auth') { ws.send(JSON.stringify({ type: m.access_token === 'test' ? 'auth_ok' : 'auth_invalid' })); return; }
      const result = m.type === 'config/device_registry/list'
        ? [{ id: 'dP4', name: 'P4', model: 'esp32-p4-evboard', sw_version: '2026.9.0', connections: [['mac', '28:37:2f:8a:02:18']] },
           { id: 'dS3', name: 'S3', connections: [['mac', '11:22:33:44:55:66']] }]
        : m.type === 'config/entity_registry/list'
          ? [...Object.keys(st).map((entity_id) => ({ entity_id, device_id: 'dP4',
              entity_category: entity_id.startsWith('sensor.') ? 'diagnostic' : null })),
             { entity_id: 'switch.s3_khac', device_id: 'dS3' }]
          : m.type === 'config/area_registry/list' ? [] : null;
      ws.send(JSON.stringify({ id: m.id, type: 'result', success: result !== null, result }));
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  return { port, calls, close: () => new Promise((r) => { wss.close(); server.close(() => r()); }) };
}

let prefsFile = '';
beforeEach(async () => {
  prefsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-prefs-')), 'p.json');
  ha = await startFakeHa();
  srv = await TestServer.start({
    SUPERVISOR_TOKEN: 'test', HA_API_URL: `http://127.0.0.1:${ha.port}/api`, HA_WS_URL: `ws://127.0.0.1:${ha.port}/websocket`,
    SCREENSAVER_IDLE_S: '0', PANEL_PREFS_FILE: prefsFile,
  });
});
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop(); await ha.close();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

it('Cai dat: doc thuc the cua DUNG man hinh (theo MAC), doi cai dat -> HA nhan dich vu; trang khac bi tu choi', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, DEV_ID, { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  const hp = await srv.waitPage((u) => u === home);

  // Trang KHONG phai Cai dat (vd mot trang web bat ky) goi binding -> server bo qua.
  await srv.evaluate(hp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'switch.p4_man_hinh_cho', v: true }))`);
  await sleep(800);
  expect(ha.calls).toEqual([]);

  await srv.evaluate(hp, `window.__rwvControl('{"app":"settings"}')`);
  const sp = await srv.waitPage((u) => u.includes('/settings.html'));
  let d: any = null;
  for (let i = 0; i < 60 && !d?.ok; i++) { d = await srv.evaluate(sp, 'window.__rwvLastSettings || null'); await sleep(200); }
  expect(d.ok).toBe(true);
  expect(d.view.items.map((x: any) => x.id).sort()).toEqual(
    ['number.p4_sleep_time', 'select.p4_xoay_man_hinh', 'sensor.p4_wifi_signal', 'switch.p4_man_hinh_cho']);  // khong factory, khong S3
  expect(d.server).toMatchObject({ id: DEV_ID, w: 1024, h: 600 });

  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'switch.p4_man_hinh_cho', v: true }))`);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'number.p4_sleep_time', v: 42 }))`);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'switch.s3_khac', v: true }))`);          // cua man hinh khac
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'button.p4_factory_default_settings' }))`);
  await sleep(1_500);
  expect(ha.calls).toEqual([
    { path: 'switch.turn_on', body: { entity_id: 'switch.p4_man_hinh_cho' } },
    { path: 'number.set_value', body: { entity_id: 'number.p4_sleep_time', value: 40 } },
  ]);
  // Trang tu doc lai trang thai moi sau khi doi
  d = await srv.evaluate(sp, 'window.__rwvLastSettings');
  expect(d.view.items.find((x: any) => x.id === 'switch.p4_man_hinh_cho').on).toBe(true);

  // Muc cua addon "Man hinh cho hien anh": server luu rieng man hinh nay, khong goi HA
  // (14/10/2026) Man hinh cho / khoa -> nhom 'lock' (07/10); them 2 muc YouTube (2.9.132).
  expect(d.panel.filter((x: any) => x.sec === 'screen').map((x: any) => x.id)).toEqual(['rwv.morning', 'rwv.cast', 'rwv.yt_skip_ads', 'rwv.yttv_guest', 'rwv.cast_name']);
  expect(d.panel.filter((x: any) => x.sec === 'lock').map((x: any) => x.id)).toEqual(expect.arrayContaining(['rwv.saver_idle', 'rwv.saver_photos', 'rwv.photo_interval']));
  expect(d.panel.filter((x: any) => x.sec === 'frame').map((x: any) => x.id)).toEqual(['rwv.photo_effect', 'rwv.photo_fit',
    'rwv.photo_order', 'rwv.photo_source', 'rwv.photo_clock', 'rwv.photo_info', 'rwv.gphotos_url']);
  const before = ha.calls.length;
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.saver_photos', v: false }))`);
  for (let i = 0; i < 20 && (await srv.evaluate<any>(sp, "window.__rwvLastSettings.panel.find((x) => x.id === 'rwv.saver_photos').on")); i++) await sleep(150);
  expect(await srv.evaluate(sp, "window.__rwvLastSettings.panel.find((x) => x.id === 'rwv.saver_photos').on")).toBe(false);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.saver_idle', v: '5 phút' }))`);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.morning', v: false }))`);
  for (let i = 0; i < 20 && (await srv.evaluate<any>(sp, "window.__rwvLastSettings.panel.find((x) => x.id === 'rwv.saver_idle').value")) !== '5 phút'; i++) await sleep(150);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.photo_effect', v: 'Trượt' }))`);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.gphotos_url', v: 'https://photos.app.goo.gl/AbCd1234' }))`);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.gphotos_url', v: 'http://may-la/x' }))`);   // tu choi
  for (let i = 0; i < 20 && (await srv.evaluate<any>(sp, "window.__rwvLastSettings.panel.find((x) => x.id === 'rwv.saver_idle').value")) !== '5 phút'; i++) await sleep(150);
  await sleep(600);
  expect(JSON.parse(fs.readFileSync(prefsFile, 'utf8'))).toEqual({
    [DEV_ID]: { saverPhotos: false, saverIdleS: 300, morning: false, photoEffect: 'slide' },
    __global: { gphotosUrl: 'https://photos.app.goo.gl/AbCd1234' },
  });
  expect(ha.calls.length).toBe(before);
  if (process.env.ITEST_SHOTS) { await sleep(300); fs.writeFileSync(path.join(process.env.ITEST_SHOTS, 'settings-1024x600.png'), await srv.screenshot(sp)); }
});
