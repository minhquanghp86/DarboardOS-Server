// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from "ws"
import env from "env-var";
import { makeConfigFromParams, setConfigFor, logDeviceConfig } from "./config.js";
import { reloadAllLaunchers, broadcaster, ensureDeviceAsync, cleanupIdleAsync, requestStatsFromDevices, runAdaptiveTick, refreshDisplaysTick, markInteraction, screensaverTick, powerTick, iptvStatus, iptvControl, postNotify, repaintRect, onDeviceStatePacket, onDeviceEvent, anyTzOffset, postDoorbell, closeDoorbell, unlockDoorbell, dialHooks, YT_TV_URL, hostMem, pipelineStats } from './deviceManager.js';
import type { DeviceSession } from './deviceManager.js';
import { camFetch, handleCamLive, handleCamProxy, noteCameraHost, setLiveStallHook } from './camProxy.js';
import { handleGo2rtcHttp, handleGo2rtcUpgrade } from './go2rtcProxy.js';
import { handleFileManager, setFileManagerHooks } from './fileManager.js';
import { handleChatApi, requestOpenConv, setChatHooks, unreadForScreen } from './chat.js';
import { castUrlToDevices, chatChanged, connectedScreens, isMediaPlaying, isUserViewing, setChatUnreadProvider, setNoticeArgHook, syncSoundToDevice } from './deviceManager.js';
import { handleAlarmApi } from './alarms.js';
import { handlePushApi, initPush } from './push.js';
import { getRegistry, haFetch, haGetRaw, callService, getSettingsView } from './haSettings.js';
import { findDeviceByMac, macFromDeviceId } from './settingsModel.js';
import { InputRouter } from "./inputRouter.js";
import { bootstrapAsync } from './browser.js';
import { subscribeDeviceAudio, unsubscribeDeviceAudio } from './audioCapture.js';
import { MsgType, parseDeviceEventPacket, parseRepaintRectPacket } from './protocol.js';
import { metrics } from './metrics.js';
import { getHaLocation } from './haLocation.js';
import { handleAppApi } from './haApps.js';
import { handleHomeApi } from './homeApi.js';
import { board, parseNote } from './board.js';
import { getToday } from './todayData.js';
import { startDial } from './dial.js';
import { handleLauncherApi } from './launcherApi.js';
import { ensureMdiIcons } from './launcherConfig.js';
import { startDebugProxy } from './debugProxy.js';
import { startWeatherMini } from './weatherMini.js';
import { handleIptvApi, setIptvHooks } from './iptv.js';
import { handleScreenCtlApi, setScreenCtlHooks } from './screenCtl.js';
import { handleControlApi, handleControlUpgrade } from './controlApi.js';
import { handleTelegramApi } from './telegram.js';
import { handleMediaApi } from './mediaLib.js';
import { endCall, handleCallApi, handleCallUpgrade, onMicFrame } from './callBridge.js';
import { attachDoor, handleDoorApi, handleDoorMjpeg, requestOpenLog, setDoorHooks } from './door.js';
import { handleRingtone } from './ringtone.js';
import { handleCallsApi, handleCallsUpgrade, setCallHooks } from './calls.js';
// (10/11/2026) GD2: dien thoai Android dang ky + poll cuoc goi den (src/phones.ts).
import { handlePhoneApi } from './phones.js';
import { handleFrigateApi } from './frigate.js';
import { handleLockWidgetsApi, noteDeviceIp } from './lockWidgets.js';
import { isLocalBrowser } from './requestOrigin.js';
import { handleCalendarApi } from './calendarSource.js';
// (17/11/2026) GD9: bo tien to ingress cua HA o MOT cho (`/api/hassio_ingress/<TOKEN>/app/register` -> `/app/register`).
import { routeOf } from './routePath.js';
import type WebSocket from 'ws';

const WS_PORT   = env.get("WS_PORT").default("8081").asIntPositive();
const HEALTH_PORT = env.get("HEALTH_PORT").default("18080").asIntPositive();

const inputRouter = new InputRouter();

await bootstrapAsync();

// (30/09/2026) SUA LOI "man hinh ket noi nhung server khong biet": truoc day cong WS mo TRUOC `await bootstrapAsync()`
// (khoi dong Chrome ~2,5 s) con handler 'connection' dang ky SAU do. Panel noi lai dung khoang nay: thu vien ws bat
// tay xong, phat su kien 'connection' khi CHUA ai nghe -> mat; socket mo coi mai mai (panel bao WS Connected, server
// 0 thiet bi, man hinh dung). Gap that 30/09 sau lan cap nhat 2.9.72: ca 3 man ket. Nay chi mo cong khi Chrome san
// sang va handler duoc gan ngay trong cung nhip (khong con await nao o giua).
const wss = new WebSocketServer({ port: WS_PORT, perMessageDeflate: false });

// ── Helper: route một message đã có dev ─────────────────────────────────────
function routeMessage(dev: DeviceSession, buf: Buffer): void {
  switch (buf.readUInt8(0)) {
    case MsgType.Touch:
      // (17/09/2026) Mo cua so uu tien do muot: nguoi dung dang thao tac.
      markInteraction(dev.deviceId);
      inputRouter.handleTouchPacketAsync(dev, buf)
        .catch(e => console.warn(`[ws] touch error: ${(e as Error).message}`));
      break;
    case MsgType.Keepalive:
      dev.lastActive = Date.now();
      break;
    case MsgType.FrameStats:
      inputRouter.handleFrameStatsPacketAsync(dev, buf)
        .catch(() => console.warn('[ws] framestats error'));
      break;
    case MsgType.RepaintRect: {
      const r = parseRepaintRectPacket(buf);
      if (r) repaintRect(dev, r.x, r.y, r.w, r.h);
      break;
    }
    case MsgType.DeviceEvent: {
      const e = parseDeviceEventPacket(buf);
      if (e) onDeviceEvent(dev, e.kind, e.value, e.text);
      break;
    }
    case MsgType.DeviceState:
      onDeviceStatePacket(dev, buf);
      break;
    // (14/10/2026) INTERCOM: tieng mic cua man trong cuoc goi (src/callBridge.ts).
    case MsgType.MicFrame:
      onMicFrame(dev.deviceId, buf);
      break;
    case MsgType.OpenURL:
      metrics.onNavigate(dev.deviceId, '(open_url)');
      inputRouter.handleOpenURLPacketAsync(dev, buf)
        .catch(e => console.warn(`[ws] openurl error: ${(e as Error).message}`));
      break;
  }
}

// ── WebSocket connection handler ─────────────────────────────────────────────
wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", `ws://localhost:${WS_PORT}`);
  const id  = url.searchParams.get("id") || "default";
  // (14/10/2026) CHUONG CONG (ESP32-S3 CAM, khong man hinh): xu ly rieng — khong tao Chromium / phien man hinh.
  if (url.searchParams.get("door") === "1") { attachDoor(ws, id, req.socket.remoteAddress, url.searchParams); return; }

  const cfg = makeConfigFromParams(url.searchParams);
  setConfigFor(id, cfg);
  logDeviceConfig(id, cfg);
  if (cfg.friendlyName) fwNames.set(id, cfg.friendlyName);

  broadcaster.addClient(id, ws);
  // (08/10/2026) ca = base64(user:pass) HTTP cua P4 (firmware co bat mat khau) — khong nam trong cfg (cfg in ra /metrics).
  // (09/10/2026) Man chi co the nho (?sd=, S3): cung so may cua Thu vien / Quan ly file, danh dau sdOnly.
  noteCameraHost(id, req.socket.remoteAddress, cfg.camPort || cfg.sdPort, url.searchParams.get("ca"), !cfg.camPort && cfg.sdPort > 0);
  // (08/10/2026) Widget man khoa: nhan ra camera Frigate cua chinh panel (theo IP) de khong bao chinh nguoi dang dung truoc.
  noteDeviceIp(id, req.socket.remoteAddress);

  // (23/09/2026) Dang ky nhan audio NGAY, khong doi ensureDeviceAsync — viec
  // bat/phat am thanh doc lap hoan toan voi Chromium target cua tung thiet
  // bi (kien truc dung chung MOT sink audio, xem audioCapture.ts).
  if (cfg.audioEnabled) subscribeDeviceAudio(id);

  // ── FIX: đăng ký message handler TRƯỚC khi await ─────────────────────────
  // Buffer các OpenURL message nhận được trong khi ensureDeviceAsync chạy.
  // Touch/keepalive trong giai đoạn này bỏ qua (device chưa sẵn sàng).
  let dev: DeviceSession | null = null;
  const pendingOpenURLs: Buffer[] = [];

  ws.on("message", (msg, isBinary) => {
    if (!isBinary) return;
    const buf: Buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer);

    if (!dev) {
      // Device chưa sẵn sàng — chỉ buffer OpenURL, bỏ qua loại khác
      if (buf.readUInt8(0) === MsgType.OpenURL) {
        pendingOpenURLs.push(buf);
      }
      return;
    }

    routeMessage(dev, buf);
  });

  ws.on("close", () => {
    if (dev) dev.lastActive = Date.now();
    broadcaster.removeClient(id, ws);
    // (23/09/2026) Chi huy dang ky audio khi KHONG CON client nao cho id
    // nay — luc noi lai nhanh (vd reconnect_ws() firmware), addClient() cua
    // ket noi MOI da don ws cu khoi danh sach TRUOC KHI su kien close cua no
    // kip chay, nen getClientCount() luc nay da phan anh dung ket noi hien
    // tai, khong bi huy dang ky nham giua chung mot lan noi lai.
    if (cfg.audioEnabled && broadcaster.getClientCount(id) === 0) {
      unsubscribeDeviceAudio(id);
    }
    // (14/10/2026) Man mat ket noi giua cuoc goi -> ket thuc (firmware cung tu dung mic khi mat WS).
    if (broadcaster.getClientCount(id) === 0) endCall(id);
  });

  // ── Tạo/lấy device session (có thể mất vài giây lần đầu) ─────────────────
  try {
    dev = await ensureDeviceAsync(id, cfg);
  } catch (e) {
    console.error(`[ws] ensureDeviceAsync failed for ${id}:`, e);
    ws.close();
    return;
  }

  // (01/10/2026) Am luong Thong bao / Bao thuc + Khong lam phien xuong firmware (?snd=1) moi lan ket noi.
  syncSoundToDevice(dev);

  // ── Flush các OpenURL message bị buffer trong khi await ──────────────────
  for (const buf of pendingOpenURLs) {
    routeMessage(dev, buf);
  }
  pendingOpenURLs.length = 0;
});

// ── Health check + trang tĩnh nội bộ ─────────────────────────────────────────
// (18/09/2026) cam.html (trang xem camera qua go2rtc MSE)
// PHẢI phục vụ ở đây, KHÔNG được đặt trong /config/www/ của Home Assistant.
// Lý do: HA_PORT phục vụ /local/ tuyệt đối không cần đăng nhập — người dùng
// này lộ HA ra internet qua Cloudflare Tunnel, nên bất kỳ file nào trong
// /config/www/ đều công khai. Đã xác minh thật: /local/cam.html trả về 200
// không cần đăng nhập từ ngoài internet. HEALTH_PORT thì KHÔNG có trong danh
// sách ingress của Cloudflare Tunnel — chỉ tiếp cận được từ mạng LAN, đúng
// mức phơi bày mà go2rtc/ESPHome API vốn đã chấp nhận.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// (25/09/2026) Them weather.html (ung dung "Thoi tiet" cua launcher) — cung nguyen tac: chi LAN, khong qua HA.
// (25/09/2026) + cac ung dung launcher: camera nha, canh, lich am duong, radio, hen gio; lunar.js dung chung.

// (19/10/2026) Luong camera treo (av_stream/encoder cua panel) -> khoi dong lai panel qua Home Assistant.
setLiveStallHook(async (dev: string) => {
  try {
    const r = await getSettingsView(dev);
    if (!r.ok) { console.warn(`[cam-live] ${dev}: khong doc duoc cai dat (${r.error})`); return; }
    const it = r.view.items.find((x) => x.kind === 'button' && /khoi_dong_lai|restart/i.test(x.id));
    if (!it) { console.warn(`[cam-live] ${dev}: khong tim thay nut khoi dong lai`); return; }
    const ok = await callService({ domain: 'button', service: 'press', data: { entity_id: it.id } });
    console.log(`[cam-live] ${dev}: da gui khoi dong lai panel (${it.id}) -> ${ok ? 'ok' : 'loi'}`);
  } catch (e) {
    console.warn(`[cam-live] ${dev}: khoi dong lai that bai: ${(e as Error).message}`);
  }
});

const STATIC_PAGES = ['no-url.html', 'cam.html', 'camera.html', 'weather.html', 'cams.html', 'calendar.html', 'radio.html', 'timer.html', 'lunar.js',
  'launcher-config.html', 'os-home.html', 'ui.css', 'ui.js', 'settings.html', 'rooms.html', 'todo.html', 'remote.html', 'photos.html', 'today.html', 'board.html', 'doorbell.html',
  // (01/10/2026) Thu vien / Tep (the SD cua P4), Tin nhan noi bo, bieu tuong dung chung.
  'files.html', 'chat.html', 'icons.js', 'alarm.html',
  // (27/10/2026) Trang Dieu khien bao thuc tu Dashboard (chon man -> trinh Bao thuc cua man do).
  'alarm-ctl.html',
  // (07/10/2026) IPTV (src/iptv.ts). (08/10/2026) Su kien camera Frigate (src/frigate.ts).
  'iptv.html', 'events.html', 'media.html', 'call-test.html', 'door.html', 'call.html', 'call-web.html', 'call-ui.js', 'call-ui.css', 'call-join.js', 'door-log.html',
  // (21/10/2026) Trang dieu khien man hinh tu Dashboard (src/controlApi.ts).
  'control.html', 'sw.js',
  'screens.html'];   // (16/10/2026) Dashboard → Màn hình
const staticCache = new Map<string, Buffer>();
for (const name of STATIC_PAGES) {
  const p = path.join(__dirname, '..', 'public', name);
  try {
    staticCache.set('/' + name, fs.readFileSync(p));
  } catch (e) {
    console.warn(`[static] khong doc duoc ${p}: ${(e as Error).message}`);
  }
}
// (07/10/2026) Thu vien trinh duyet cua IPTV phuc vu thang tu node_modules (phien ban ghim trong package-lock, khong can
// CDN): hls.js (HLS), mpegts.js (MPEG-TS / FLV qua HTTP), shaka-player (DASH, ClearKey). Deu Apache-2.0.
const VENDOR: Record<string, string> = {
  '/vendor/hls.min.js': 'hls.js/dist/hls.min.js',
  '/vendor/mpegts.js': 'mpegts.js/dist/mpegts.js',
  // (07/10/2026) DASH + ClearKey (EME co san trong Chromium) — chi nap khi mo kenh can.
  '/vendor/shaka-player.compiled.js': 'shaka-player/dist/shaka-player.compiled.js',
};
const vendorCache = new Map<string, Buffer>();
for (const [route, rel] of Object.entries(VENDOR)) {
  const p = path.join(__dirname, '..', 'node_modules', rel);
  try { vendorCache.set(route, fs.readFileSync(p)); } catch (e) { console.warn(`[static] khong doc duoc ${p}: ${(e as Error).message}`); }
}

http.createServer((req, res) => {
  const reqUrl = new URL(req.url || "/", `http://localhost:${HEALTH_PORT}`);
  // (17/11/2026) GD9 — duong dan DA BO tien to ingress/proxy. Moi handler nhan `routeUrl` (pathname da chuan hoa,
  // query giu nguyen) thay vi URL goc, nho vay `/api/hassio_ingress/<TOKEN>/app/register`, `/chat/list`,
  // `/files.html`… deu khop nhu khi goi thang o goc add-on. Tren panel (127.0.0.1, goc '/') khong doi gi.
  const pathname = routeOf(reqUrl.pathname);
  const routeUrl = new URL(req.url || "/", `http://localhost:${HEALTH_PORT}`);
  routeUrl.pathname = pathname;
  // (01/10/2026) Ung dung Camera: chuyen tiep toi cam_app cua panel co camera (src/camProxy.ts).
  // (09/10/2026) go2rtc qua server (trang camera) — src/go2rtcProxy.ts.
  if (handleGo2rtcHttp(req, res, pathname, reqUrl.search)) return;
  if (handleCamLive(req, res, pathname)) return;
  if (handleCamProxy(req, res, pathname, reqUrl.search)) return;
  // (02/10/2026) Quan ly file (the SD cua P4) tu trang Dashboard — chi ingress.
  if (handleFileManager(req, res, routeUrl)) return;
  // (07/10/2026) IPTV: danh sach kenh, proxy luong, yeu thich, cau hinh tu trang Dashboard (src/iptv.ts).
  if (handlePushApi(req, res, routeUrl)) return;
  if (handleIptvApi(req, res, routeUrl)) return;
  if (handleScreenCtlApi(req, res, routeUrl)) return;   // (16/10/2026) Dashboard → Màn hình
  if (handleControlApi(req, res, routeUrl)) return;     // (21/10/2026) Dashboard → điều khiển màn hình
  if (handleTelegramApi(req, res, routeUrl)) return;   // (16/10/2026) thong bao Telegram
  // (14/10/2026) Ung dung Media: nguon media cua HA, phat tren man / loa HA (src/mediaLib.ts) — chi 127.0.0.1.
  if (handleMediaApi(req, res, routeUrl)) return;
  // (14/10/2026) INTERCOM GD0: tieng giua man va trang thu / do vong lap (src/callBridge.ts).
  if (handleCallApi(req, res, routeUrl)) return;
  // (16/10/2026) Hình MJPEG của chuông cổng qua HTTP cho Frigate/HA — phải TRƯỚC handleDoorApi (nó nhận mọi /door/*).
  if (handleDoorMjpeg(req, res, routeUrl)) return;
  // (14/10/2026) Chuong cong: Nghe / Tu choi / Ket thuc / Mo cong, anh khach (src/door.ts).
  if (handleDoorApi(req, res, routeUrl)) return;
  // (14/10/2026) Nhac chuong tu thu muc media HA (src/ringtone.ts).
  if (handleRingtone(req, res, pathname)) return;
  // (14/10/2026) Cuoc goi video man <-> man / trinh duyet (src/calls.ts).
  if (handleCallsApi(req, res, routeUrl)) return;
  // (10/11/2026) GD2: app Android dang ky / poll cuoc goi den / nghe / tu choi (src/phones.ts).
  if (handlePhoneApi(req, res, routeUrl)) return;
  // (08/10/2026) Su kien camera Frigate: danh sach, anh, clip (src/frigate.ts) — chi 127.0.0.1.
  if (handleFrigateApi(req, res, routeUrl)) return;
  const vendor = vendorCache.get(pathname);
  if (vendor) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    res.end(vendor);
    return;
  }

  // (14/09/2026) /metrics: số liệu thật để đo hiệu năng (GĐ0)
  if (pathname.startsWith('/metrics')) {
    const snap = metrics.snapshot();
    // (22/10/2026) Bo sung so lieu duong truyen theo thoi diem: u dong khung + so goi am thanh.
    const devices = (snap.devices as Array<{ id: string }>).map((d) => ({ ...d, ...broadcaster.transportStats(d.id) }));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ...snap, devices, host: hostMem(), pipeline: pipelineStats() }, null, 2));
    return;
  }

  // (19/10/2026) Danh sach MAN HINH dang ket noi (khong gom chuong cua) de component Home Assistant dung lam dropdown.
  if (pathname === '/devices' && req.method === 'GET') {
    const snap = metrics.snapshot() as { devices?: Array<{ id: string; config?: { friendlyName?: string } | null }> };
    const screens = (snap.devices ?? [])
      .filter((d) => d.id && d.config)
      .map((d) => ({ id: d.id, name: d.config?.friendlyName || d.id }));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, screens }));
    return;
  }
  // (26/09/2026 OS-5) Thong bao tu Home Assistant (rest_command) — xem DOCS.md "Thong bao".
  if (pathname === '/notify' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let r: ReturnType<typeof postNotify>;
      try { r = postNotify(JSON.parse(body || '{}')); } catch { r = { ok: false, error: 'JSON khong hop le' }; }
      res.writeHead(r.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r));
    });
    return;
  }
  // (19/10/2026) Media cho thong bao (anh / video / am thanh): component Dashboard OS tren HA tai len, panel tai ve.
  if (pathname === '/notify/upload' && req.method === 'POST') {
    const chunks: Buffer[] = []; let size = 0, tooBig = false;
    const limit = 64 * 1024 * 1024;
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { tooBig = true; req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) { res.writeHead(413, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"qua 64 MB"}'); return; }
      try {
        const dir = path.join(fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data'), 'notify-media');
        fs.mkdirSync(dir, { recursive: true });
        const ctype = String(req.headers['content-type'] || '').toLowerCase();
        const ext = ctype.includes('mp4') ? '.mp4' : ctype.includes('webm') ? '.webm' : ctype.includes('quicktime') ? '.mov'
          : ctype.includes('mpeg') && ctype.includes('audio') ? '.mp3' : ctype.includes('wav') ? '.wav'
          : ctype.includes('ogg') ? '.ogg' : ctype.includes('png') ? '.png' : ctype.includes('webp') ? '.webp'
          : ctype.includes('gif') ? '.gif' : '.jpg';
        const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + ext;
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, url: '/notify/media/' + name }));
        console.log(`[notify] media ${name} (${(size / 1024).toFixed(0)} KB)`);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
    });
    return;
  }
  if (pathname.startsWith('/notify/media/') && req.method === 'GET') {
    const name = path.basename(pathname.slice('/notify/media/'.length));
    const file = path.join(fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data'), 'notify-media', name);
    if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(name).toLowerCase();
    const type = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime'
      : ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg'
      : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  // (27/09/2026) Chuong cua: HA goi POST /doorbell (LAN, nhu /notify); trang chuong goi /doorbell/unlock|close (tu
  // chinh panel, hoac trang mo truc tiep trong LAN cung origin — app Android). Mo cong chi chay thuc the HA da khai
  // trong POST /doorbell.
  if (pathname === '/doorbell' || pathname.startsWith('/doorbell/')) {
    // (12/11/2026) + trang mo truc tiep trong LAN cung origin (app Android mo doorbell.html trong WebView).
    const local = isLocalBrowser(req);
    const send = (code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(b)); };
    if (pathname === '/doorbell' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let r: ReturnType<typeof postDoorbell>;
        try { r = postDoorbell(JSON.parse(body || '{}')); } catch { r = { ok: false, error: 'JSON khong hop le' }; }
        send(r.ok ? 200 : 400, r);
      });
      return;
    }
    if (!local || req.method !== 'POST') { send(403, { error: 'Chỉ dùng được từ màn hình.' }); return; }
    const id = new URL(req.url || '/', 'http://x').searchParams.get('id') || '';
    if (pathname === '/doorbell/close') { send(200, { ok: closeDoorbell(id) }); return; }
    if (pathname === '/doorbell/unlock') { unlockDoorbell(id).then((r) => send(200, r)).catch(() => send(200, { ok: false })); return; }
    send(404, { error: 'khong co' });
    return;
  }
  // (27/09/2026) Trang "Hom nay" + Bang tin gia dinh. Them ghi chu: tu bat ky dau trong LAN (HA rest_command, dien
  // thoai) nhu /notify; doc / xoa / ghim: chi tu chinh panel (127.0.0.1).
  if (pathname === '/ha/today' || pathname === '/board' || pathname.startsWith('/board/')) {
    // (12/11/2026) + trang mo truc tiep trong LAN cung origin (app Android mo today.html / board.html trong WebView).
    const local = isLocalBrowser(req);
    const send = (code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(b)); };
    if (pathname === '/board' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let p: ReturnType<typeof parseNote>;
        try { p = parseNote(JSON.parse(body || '{}')); } catch { p = { ok: false, error: 'JSON khong hop le' }; }
        if (!p.ok) { send(400, p); return; }
        const n = board.add(p.note);
        console.log(`[board] ghi chu moi #${n.id}${n.by ? ' (' + n.by + ')' : ''}`);
        postNotify({ title: 'Ghi chú mới' + (n.by ? ' · ' + n.by : ''), message: n.text, app: 'board' });
        send(200, { ok: true, note: n });
      });
      return;
    }
    if (!local) { send(403, { error: 'Chỉ dùng được từ màn hình.' }); return; }
    if (pathname === '/ha/today') { getToday(anyTzOffset()).then((v) => send(200, { ok: true, ...v })).catch((e) => send(200, { ok: false, error: (e as Error).message })); return; }
    if (pathname === '/board/list') { send(200, { ok: true, notes: board.list() }); return; }
    const id = Number(new URL(req.url || '/', 'http://x').searchParams.get('id'));
    if (pathname === '/board/del' && req.method === 'POST') { send(200, { ok: board.remove(id) }); return; }
    if (pathname === '/board/pin' && req.method === 'POST') {
      const on = new URL(req.url || '/', 'http://x').searchParams.get('on') === '1';
      send(200, { ok: board.pin(id, on) }); return;
    }
    send(404, { error: 'khong co' });
    return;
  }
  if (handleAppApi(req, res, routeUrl)) return;
  if (handleHomeApi(req, res, routeUrl)) return;
  if (handleLauncherApi(req, res, routeUrl)) return;
  // (08/10/2026) Trang Dashboard -> tab "Màn khóa": cam bien nang luong cho widget (src/lockWidgets.ts).
  if (handleLockWidgetsApi(req, res, routeUrl)) return;
  // (09/10/2026) Lich iCal (Google...) cho widget / trang Hom nay — src/calendarSource.ts.
  if (handleCalendarApi(req, res, routeUrl)) return;
  if (handleChatApi(req, res, routeUrl)) return;
  if (handleAlarmApi(req, res, routeUrl, () => connectedScreens().map((s) => ({
    id: s.id, name: screenNameOf(s.id) || `Màn hình ${s.w}×${s.h}`, spk: s.spk })))) return;

  // (25/09/2026) Vi tri nha trong Home Assistant cho weather.html (cung nguon goc 127.0.0.1:HEALTH_PORT).
  if (pathname === '/weather-location') {
    // (09/10/2026) Toa do NHA: chi trang trong Chromium cua add-on (127.0.0.1) — truoc day ca LAN doc duoc.
    if (!/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '')) { res.writeHead(403); res.end('{}'); return; }
    getHaLocation().then((loc) => {
      res.writeHead(loc ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(loc ?? { error: 'khong co vi tri HA' }));
    }).catch(() => { res.writeHead(500); res.end('{}'); });
    return;
  }

  // (16/10/2026) Goc ingress ("/") = trang chu Dashboard. Truoc day tra "ok" 2 byte khong co content-type -> nut "‹ Trang chu" (href="./")
  // o Man hinh / Chuong cong / Goi lam trinh duyet TAI VE tep "Tai xuong". Van giu "ok" cho kiem tra suc khoe (127.0.0.1 / Docker).
  const ingressRoot = pathname === '/' && (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';
  if (ingressRoot || STATIC_PAGES.includes(pathname.slice(1)) || pathname === '/os/home') {
    const page = staticCache.get(ingressRoot ? '/launcher-config.html' : pathname === '/os/home' ? '/os-home.html' : pathname);
    if (!page) { res.writeHead(500); res.end(`${pathname.slice(1)} khong tai duoc`); return; }
    // no-store: file co the duoc cap nhat qua rebuild addon, khong muon
    // Chromium cache lau nhu HA tung lam voi /local/ (31 ngay).
    const type = !ingressRoot && pathname.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(page);
    return;
  }

  res.writeHead(200); res.end('ok');
}).on('upgrade', (req, socket, head) => {
  // (17/11/2026) GD9 — WebSocket mo tu trang chay qua ingress cung mang tien to
  // (`/api/hassio_ingress/<TOKEN>/calls/web`, `/call/video`, `/go2rtc/...`). Bo tien to ngay tai day de moi handler
  // nang cap thay dung duong dan (truoc day /calls/web + /call/video da dung `endsWith` nen van chay, con
  // /go2rtc/* thi bi huy socket).
  try {
    const u = new URL(req.url || '/', 'http://x');
    const rp = routeOf(u.pathname);
    if (rp !== u.pathname) req.url = rp + u.search;
  } catch { /* URL hong: giu nguyen, handler tu quyet dinh */ }
  if (!handleCallUpgrade(req, socket, head) && !handleCallsUpgrade(req, socket, head) && !handleGo2rtcUpgrade(req, socket, head) && !handleControlUpgrade(req, socket, head)) socket.destroy();
}).listen(HEALTH_PORT);
initPush();

setInterval(() => cleanupIdleAsync(), 60_000);

// (01/10/2026) Tin nhan noi bo (src/chat.ts): ten man hinh lay tu so dang ky thiet bi HA (ten nguoi dung dat), 5 phut/lan.
const screenNames = new Map<string, string>();
// (14/10/2026) Ten than thien firmware gui kem (?fn=) — du phong khi so dang ky HA khong tim ra (MAC cong mang khac).
const fwNames = new Map<string, string>();
async function refreshScreenNames(): Promise<void> {
  try {
    const reg = await getRegistry();
    for (const s of connectedScreens()) {
      const mac = macFromDeviceId(s.id);
      const d = mac ? findDeviceByMac(reg.devices, mac) : undefined;
      if (d) screenNames.set(s.id, d.name_by_user || d.name || s.id);
    }
  } catch { /* HA chua san sang */ }
}
refreshScreenNames();
setInterval(refreshScreenNames, 5 * 60_000);
// (09/10/2026) Luc khoi dong chua man nao noi -> bang ten trong toi 5 phut (Tin nhan / Bao thuc / Quan ly file hien ma thô).
// Gap man chua co ten -> nap lai ngay (toi da 30 s / lan).
let namesAt = 0;
function screenNameOf(id: string): string | undefined {
  const n = screenNames.get(id) || fwNames.get(id);
  if (!n && Date.now() - namesAt > 30_000) { namesAt = Date.now(); void refreshScreenNames(); }
  return n;
}
// (14/10/2026) Cuoc goi video: ten man trong danh ba / man hinh cuoc goi.
setCallHooks({ name: (id) => screenNameOf(id) });
setDoorHooks({ name: (id) => screenNameOf(id) });
setScreenCtlHooks({ name: (id) => screenNameOf(id) });
setChatHooks({
  screens: () => connectedScreens().map((s) => {
    if (!screenNames.has(s.id)) refreshScreenNames();
    return { ...s, name: screenNameOf(s.id) || '', online: true };  // '' = chua co ten HA -> chat.ts dung ten da luu
  }),
  notify: (device, title, message, conv, image) => { postNotify({ device, title, message, priority: 'high', app: 'chat', arg: conv, ...(image ? { image } : {}) }); },
  people: async () => {
    const r = await haFetch('/states');
    if (!r.ok) throw new Error(`HA ${r.status}`);
    return ((await r.json()) as { entity_id: string; attributes?: Record<string, any> }[])
      .filter((s) => s.entity_id.startsWith('person.') && typeof s.attributes?.user_id === 'string')
      .map((s) => ({ userId: s.attributes!.user_id as string, name: String(s.attributes!.friendly_name || s.entity_id.slice(7)),
        pic: typeof s.attributes!.entity_picture === 'string' && s.attributes!.entity_picture.startsWith('/') ? s.attributes!.entity_picture as string : null }));
  },
  changed: () => chatChanged(),
  haImage: async (p) => { const r = await haGetRaw(p); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; },
  chatActive: (device) => isUserViewing(device, 'chat'),
  haEvent: (data) => { haFetch('/events/dashboard_chat_message', { method: 'POST', body: JSON.stringify(data) }).catch(() => { }); },
  camFetch,
});
setNoticeArgHook((device, app, arg) => { if (app === 'chat') requestOpenConv(device, arg); else if (app === 'doorlog') requestOpenLog(device, arg); });
setChatUnreadProvider(unreadForScreen);
setFileManagerHooks({ mediaBusy: (device) => isMediaPlaying(device), screenName: (id) => screenNameOf(id) || id });
// (13/10/2026) The IPTV (trang Dashboard): nut "phat tren man" — o chon man + gui lenh phat kenh (xem src/iptv.ts).
setIptvHooks({
  screens: () => connectedScreens().map((s) => ({ id: s.id, name: screenNameOf(s.id) || s.id, online: true })),
  cast: (ids, urlOf) => castUrlToDevices(ids, urlOf),
  status: (id) => iptvStatus(id),
  control: (id, act) => iptvControl(id, act),
});
startWeatherMini();
// (27/09/2026) Truyen YouTube tu dien thoai: panel hien nhu mot TV trong nut truyen (DIAL). Tat: tuy chon cast_enabled.
if (!['0', 'false'].includes(process.env.CAST_ENABLED ?? '')) {
  startDial(dialHooks, {
    httpPort: Number(process.env.DIAL_PORT) || 56790,
    ssdpPort: Number(process.env.DIAL_SSDP_PORT) || 1900,
    ytUrl: YT_TV_URL,
  });
}
startDebugProxy();
// bieu tuong MDI cua cau hinh cu (neu bo dem bi mat) + bieu tuong mac dinh cua ung dung co san. (01/10/2026) Tai xong ma co
// bieu tuong moi -> nap lai launcher tren cac tab dang mo: man hinh noi lai NGAY khi khoi dong nhan cau hinh truoc khi tai
// xong (do 01/10: 4 ung dung tien ich thieu bieu tuong toi lan nap trang sau).
ensureMdiIcons().then((changed) => { if (changed) return reloadAllLaunchers(); }).catch(() => { });
// (14/09/2026) GD2: 30s/lan xin so lieu decode tu cac thiet bi -> /metrics
// (17/09/2026) 30s -> 10s. Sau khi ha tick dieu tiet ve 5s, chinh chu ky XIN
// SO LIEU nay tro thanh thu chan toc do phan ung: vong dieu khien chay 5s/lan
// nhung van doc lai cung mot mau decode cu cho den khi co mau moi.
// Do that: ha tai 7 buoc mat 55s, trong khi ly thuyet (tick 5s + tre 5s) la ~35s.
// (23/09/2026) 10s -> 5s, BANG dung chu ky runAdaptiveTick ben duoi.
//
// Le ra buoc 17/09 da phai di den day: de 10s thi moi mau decode duoc dung cho
// HAI lan quyet dinh lien tiep, tuc mot lan do xau co the bi phat hai lan (ha
// quality roi lai gian nhip) va mot lan do tot co the keo nhip len hai nac ma
// khong he co bang chung moi. Bang nhip thi moi tick co dung mot mau moi.
//
// Truoc day khong dam ha vi goi xin so lieu con xep trong hang doi khung hinh;
// nay no gui thang (xem startSelfTestMeasurement) nen chi ton 8 byte/5 giay.
setInterval(() => requestStatsFromDevices(), 5_000);
// (26/09/2026 OS-5) Man hinh cho — xem screensaverTick().
setInterval(() => screensaverTick(), 5_000);
// (16/10/2026) Nguon dien (cam / rut sac) moi 2 s — xem powerTick().
setInterval(() => powerTick(), 2_000);
// (14/09/2026) GĐ3: 15s/lan chinh quality/nhip theo so do thuc (tat bang CCR_ADAPTIVE=0)
// (17/09/2026) 15s -> 5s. Do that: AIMD hoan tat 7 buoc trong 90 giay chu khong
// phai ~25 giay nhu tinh toan. Ly do: chu ky tick nay CHI PHOI, con cooldownDownMs
// (5s) them o 2.7.0 gan nhu khong co tac dung vi no NGAN HON chu ky tick.
// Ha tick ve 5s de cooldownDownMs thuc su co hieu luc -> ha tai xong trong ~35s.
// Nhip NANG LAI khong bi anh huong: van bi cooldownMs (20s) giu cham nhu cu.
setInterval(() => runAdaptiveTick(), 5_000);
// (15/09/2026) 60s/lan ep full-frame -> chong "man hinh trang" (tat bang CCR_REFRESH_MS=0)
// (17/09/2026) 60s -> 5 phut, VA doc dung bien moi truong.
// Truoc day CCR_REFRESH_MS chi duoc doc BEN TRONG refreshDisplaysTick() de lam
// co bat/tat — con nhip that bi ghi cung 60_000 ngay day, nen dat bien do
// khong bao gio doi duoc nhip. Nay bien dieu khien ca hai.
const REFRESH_MS = Number(process.env.CCR_REFRESH_MS ?? 300_000);
if (REFRESH_MS > 0) setInterval(() => refreshDisplaysTick(), REFRESH_MS);
console.log(`[server] WebSocket listening on :${WS_PORT}`);
