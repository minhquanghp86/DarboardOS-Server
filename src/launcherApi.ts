// (25/09/2026) API cua trang "Menu panel" (ingress HA): doc / luu cau hinh menu ung dung.
//   GET  launcher/config -> { apps, config, groups, mdiVersion }
//   POST launcher/config -> luu (CHI qua ingress: dia chi Supervisor 172.30.32.2 — ingress da buoc dang nhap HA;
//                           may khac trong LAN goi thang cong 18080 thi bi tu choi).
import type http from 'node:http';
import { GROUP_TITLES, KNOWN_ICONS, listAllApps } from './launcherApps.js';
import { MDI_VERSION, getLauncherConfig, saveLauncherConfig } from './launcherConfig.js';
import { anyHomeUrl, reloadAllLaunchers } from './deviceManager.js';
import { BUILTIN_PREVIEW } from './launcherApps.js';

const INGRESS_IP = '172.30.32.2';

function fromIngress(req: http.IncomingMessage): boolean {
  if (process.env.LAUNCHER_CONFIG_OPEN === '1') return true;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === INGRESS_IP;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function snapshot() {
  return {
    apps: listAllApps(anyHomeUrl()),
    config: getLauncherConfig(),
    groups: Object.entries(GROUP_TITLES),
    builtinIcons: KNOWN_ICONS,
    builtinPreview: BUILTIN_PREVIEW,
    mdiVersion: MDI_VERSION,
  };
}

/** true = da xu ly. Duong dan KHONG co "/" dau o phia trang (ingress them tien to). */
export function handleLauncherApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (url.pathname !== '/launcher/config') return false;
  if (req.method === 'GET') { json(res, 200, snapshot()); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'method' }); return true; }
  if (!fromIngress(req)) { json(res, 403, { error: 'Chi luu duoc tu trang Menu panel trong Home Assistant' }); return true; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
  req.on('end', async () => {
    try {
      await saveLauncherConfig(JSON.parse(body));
      const n = await reloadAllLaunchers();
      console.log(`[launcher] da luu cau hinh menu, nap lai ${n} man hinh`);
      json(res, 200, { ok: true, reloaded: n, ...snapshot() });
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  });
  return true;
}
