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
import { reloadAllLaunchers, broadcaster, ensureDeviceAsync, cleanupIdleAsync, requestStatsFromDevices, runAdaptiveTick, refreshDisplaysTick, markInteraction, screensaverTick, postNotify, repaintRect, onDeviceStatePacket, onDeviceEvent, anyTzOffset, postDoorbell, closeDoorbell, unlockDoorbell, dialHooks, YT_TV_URL, hostMem, pipelineStats } from './deviceManager.js';
import type { DeviceSession } from './deviceManager.js';
import { camFetch, handleCamProxy, noteCameraHost } from './camProxy.js';
import { handleFileManager, setFileManagerHooks } from './fileManager.js';
import { handleChatApi, requestOpenConv, setChatHooks, unreadForScreen } from './chat.js';
import { chatChanged, connectedScreens, isMediaPlaying, isUserViewing, setChatUnreadProvider, setNoticeArgHook, syncSoundToDevice } from './deviceManager.js';
import { handleAlarmApi } from './alarms.js';
import { getRegistry, haFetch, haGetRaw } from './haSettings.js';
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
import { handleIptvApi } from './iptv.js';
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

  const cfg = makeConfigFromParams(url.searchParams);
  setConfigFor(id, cfg);
  logDeviceConfig(id, cfg);

  broadcaster.addClient(id, ws);
  noteCameraHost(id, req.socket.remoteAddress, cfg.camPort);

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
// (18/09/2026) cam.html (trang xem camera qua go2rtc MSE, xem docs/PUBLIC.md)
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
const STATIC_PAGES = ['cam.html', 'camera.html', 'weather.html', 'cams.html', 'calendar.html', 'radio.html', 'timer.html', 'lunar.js',
  'launcher-config.html', 'os-home.html', 'ui.css', 'ui.js', 'settings.html', 'rooms.html', 'todo.html', 'remote.html', 'photos.html', 'today.html', 'board.html', 'doorbell.html',
  // (01/10/2026) Thu vien / Tep (the SD cua P4), Tin nhan noi bo, bieu tuong dung chung.
  'files.html', 'chat.html', 'icons.js', 'alarm.html',
  // (07/10/2026) IPTV (src/iptv.ts).
  'iptv.html'];
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
  const pathname = reqUrl.pathname;
  // (01/10/2026) Ung dung Camera: chuyen tiep toi cam_app cua panel co camera (src/camProxy.ts).
  if (handleCamProxy(req, res, pathname, reqUrl.search)) return;
  // (02/10/2026) Quan ly file (the SD cua P4) tu trang Darboard — chi ingress.
  if (handleFileManager(req, res, reqUrl)) return;
  // (07/10/2026) IPTV: danh sach kenh, proxy luong, yeu thich, cau hinh tu trang Darboard (src/iptv.ts).
  if (handleIptvApi(req, res, reqUrl)) return;
  const vendor = vendorCache.get(pathname);
  if (vendor) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    res.end(vendor);
    return;
  }

  // (14/09/2026) /metrics: số liệu thật để đo hiệu năng (GĐ0)
  if (pathname.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ...metrics.snapshot(), host: hostMem(), pipeline: pipelineStats() }, null, 2));
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
  // (27/09/2026) Chuong cua: HA goi POST /doorbell (LAN, nhu /notify); trang chuong goi /doorbell/unlock|close (chi
  // tu chinh panel). Mo cong chi chay thuc the HA da khai trong POST /doorbell.
  if (pathname === '/doorbell' || pathname.startsWith('/doorbell/')) {
    const local = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
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
    const local = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
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
  if (handleAppApi(req, res, new URL(req.url || '/', `http://localhost:${HEALTH_PORT}`))) return;
  if (handleHomeApi(req, res, new URL(req.url || '/', `http://localhost:${HEALTH_PORT}`))) return;
  if (handleLauncherApi(req, res, new URL(req.url || '/', `http://localhost:${HEALTH_PORT}`))) return;
  if (handleChatApi(req, res, new URL(req.url || '/', `http://localhost:${HEALTH_PORT}`))) return;
  if (handleAlarmApi(req, res, new URL(req.url || '/', `http://localhost:${HEALTH_PORT}`), () => connectedScreens().map((s) => ({
    id: s.id, name: screenNames.get(s.id) || `Màn hình ${s.w}×${s.h}`, spk: s.spk })))) return;

  // (25/09/2026) Vi tri nha trong Home Assistant cho weather.html (cung nguon goc 127.0.0.1:HEALTH_PORT).
  if (pathname === '/weather-location') {
    getHaLocation().then((loc) => {
      res.writeHead(loc ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(loc ?? { error: 'khong co vi tri HA' }));
    }).catch(() => { res.writeHead(500); res.end('{}'); });
    return;
  }

  if (STATIC_PAGES.includes(pathname.slice(1)) || pathname === '/os/home') {
    const page = staticCache.get(pathname === '/os/home' ? '/os-home.html' : pathname);
    if (!page) { res.writeHead(500); res.end(`${pathname.slice(1)} khong tai duoc`); return; }
    // no-store: file co the duoc cap nhat qua rebuild addon, khong muon
    // Chromium cache lau nhu HA tung lam voi /local/ (31 ngay).
    const type = pathname.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(page);
    return;
  }

  res.writeHead(200); res.end('ok');
}).listen(HEALTH_PORT);

setInterval(() => cleanupIdleAsync(), 60_000);

// (01/10/2026) Tin nhan noi bo (src/chat.ts): ten man hinh lay tu so dang ky thiet bi HA (ten nguoi dung dat), 5 phut/lan.
const screenNames = new Map<string, string>();
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
setChatHooks({
  screens: () => connectedScreens().map((s) => {
    if (!screenNames.has(s.id)) refreshScreenNames();
    return { ...s, name: screenNames.get(s.id) || '', online: true };  // '' = chua co ten HA -> chat.ts dung ten da luu
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
  haEvent: (data) => { haFetch('/events/darboard_chat_message', { method: 'POST', body: JSON.stringify(data) }).catch(() => { }); },
  camFetch,
});
setNoticeArgHook((device, app, arg) => { if (app === 'chat') requestOpenConv(device, arg); });
setChatUnreadProvider(unreadForScreen);
setFileManagerHooks({ mediaBusy: (device) => isMediaPlaying(device) });
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
