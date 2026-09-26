// (27/09/2026) Truyen YouTube tu dien thoai (DIAL): gia lam app YouTube — tim TV (SSDP M-SEARCH), doc mo ta, bam truyen
// (POST pairingCode) -> panel mo YouTube TV (UA Smart TV) -> ngat (DELETE) -> quay ve ung dung truoc.
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

const DEV_ID = 'esp32-0a0b0c0d0002';
let srv: TestServer;
let dev: FakeDevice | null = null;
let dialPort = 0, ssdpPort = 0, prefs = '';
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

beforeEach(async () => {
  dialPort = await freePort(); ssdpPort = await freePort();
  prefs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-cast-')), 'p.json');
  srv = await TestServer.start({
    SCREENSAVER_IDLE_S: '0', DIAL_PORT: String(dialPort), DIAL_SSDP_PORT: String(ssdpPort), PANEL_PREFS_FILE: prefs,
    YT_TV_URL: 'data:text/html,<h1>YouTube TV gia</h1>',
  });
});
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
});

/** M-SEARCH nhu app YouTube; tra ve cac goi tra loi trong 1,5 s. */
async function search(): Promise<string[]> {
  const s = dgram.createSocket('udp4');
  const got: string[] = [];
  s.on('message', (m) => got.push(m.toString()));
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
  const q = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n';
  s.send(q, ssdpPort, '127.0.0.1');
  await sleep(1500);
  s.close();
  return got;
}

it('dien thoai tim thay panel, truyen YouTube -> YouTube TV tren panel, ngat -> quay ve', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, DEV_ID, { home, ctl: '1' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  await srv.waitPage((u) => u === home);

  // 1) Tim TV
  const r = await search();
  expect(r.length).toBe(1);
  const loc = /LOCATION: (\S+)/.exec(r[0])![1];
  expect(loc).toBe(`http://127.0.0.1:${dialPort}/dial/${DEV_ID}/dd.xml`);
  // 2) Mo ta thiet bi -> Application-URL
  const dd = await fetch(loc);
  expect(await dd.text()).toContain('<friendlyName>Darboard 0218</friendlyName>');
  const appUrl = dd.headers.get('application-url')!;
  expect(appUrl).toBe(`http://127.0.0.1:${dialPort}/dial/${DEV_ID}/apps/`);
  expect(await (await fetch(appUrl + 'YouTube')).text()).toContain('<state>stopped</state>');
  expect((await fetch(appUrl + 'Netflix')).status).toBe(404);

  // 3) Truyen
  const before = dev.msgs.length;
  const post = await fetch(appUrl + 'YouTube', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'pairingCode=ab12-cd34&theme=cl' });
  expect(post.status).toBe(201);
  expect(post.headers.get('location')).toBe(appUrl + 'YouTube/run');
  const yt = await srv.waitPage((u) => u.includes('pairingCode=ab12-cd34'));
  expect(yt.url).toContain('theme=cl');
  expect(await srv.evaluate<string>(yt, 'navigator.userAgent')).toContain('SMART-TV');
  await dev.waitFor(() => dev!.currentUrls().slice(-1)[0].includes('pairingCode=ab12-cd34'), 8000, 'panel hien YouTube TV');
  expect(dev.msgs.slice(before).some((m) => m[0] === 9 && m[2] === 1)).toBe(true);        // bat den nen
  expect(await (await fetch(appUrl + 'YouTube')).text()).toContain('<state>running</state>');

  // 4) Ngat
  expect((await fetch(appUrl + 'YouTube/run', { method: 'DELETE' })).status).toBe(200);
  await dev.waitFor(() => dev!.currentUrls().slice(-1)[0] === home, 8000, 've HA');
  for (let i = 0; i < 20 && (await srv.pageUrls()).some((u) => u.includes('pairingCode')); i++) await sleep(200);
  expect((await srv.pageUrls()).some((u) => u.includes('pairingCode'))).toBe(false);

  // 5) Tat "Nhan truyen YouTube" o Cai dat -> dien thoai khong thay nua
  const hp = (await srv.pages()).find((p) => p.url === home)!;
  await srv.evaluate(hp, `window.__rwvControl('{"app":"settings"}')`);
  const sp = await srv.waitPage((u) => u.includes('/settings.html'));
  await sleep(500);
  await srv.evaluate(sp, `window.__rwvControl(JSON.stringify({ settings: 'set', id: 'rwv.cast', v: false }))`);
  await sleep(500);
  expect(await search()).toEqual([]);
});
