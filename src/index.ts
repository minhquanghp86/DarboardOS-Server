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
import { broadcaster, ensureDeviceAsync, cleanupIdleAsync, requestStatsFromDevices, runAdaptiveTick, refreshDisplaysTick, markInteraction, onDeviceStatePacket } from './deviceManager.js';
import type { DeviceSession } from './deviceManager.js';
import { InputRouter } from "./inputRouter.js";
import { bootstrapAsync } from './browser.js';
import { subscribeDeviceAudio, unsubscribeDeviceAudio } from './audioCapture.js';
import { MsgType } from './protocol.js';
import { metrics } from './metrics.js';
import type WebSocket from 'ws';

const WS_PORT   = env.get("WS_PORT").default("8081").asIntPositive();
const HEALTH_PORT = env.get("HEALTH_PORT").default("18080").asIntPositive();

const wss = new WebSocketServer({ port: WS_PORT, perMessageDeflate: false });
const inputRouter = new InputRouter();

await bootstrapAsync();

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
const STATIC_PAGES = ['cam.html', 'weather.html'];
const staticCache = new Map<string, Buffer>();
for (const name of STATIC_PAGES) {
  const p = path.join(__dirname, '..', 'public', name);
  try {
    staticCache.set('/' + name, fs.readFileSync(p));
  } catch (e) {
    console.warn(`[static] khong doc duoc ${p}: ${(e as Error).message}`);
  }
}

http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", `http://localhost:${HEALTH_PORT}`).pathname;

  // (14/09/2026) /metrics: số liệu thật để đo hiệu năng (GĐ0)
  if (pathname.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(metrics.snapshot(), null, 2));
    return;
  }

  if (STATIC_PAGES.includes(pathname.slice(1))) {
    const page = staticCache.get(pathname);
    if (!page) { res.writeHead(500); res.end(`${pathname.slice(1)} khong tai duoc`); return; }
    // no-store: file co the duoc cap nhat qua rebuild addon, khong muon
    // Chromium cache lau nhu HA tung lam voi /local/ (31 ngay).
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
    return;
  }

  res.writeHead(200); res.end('ok');
}).listen(HEALTH_PORT);

setInterval(() => cleanupIdleAsync(), 60_000);
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
