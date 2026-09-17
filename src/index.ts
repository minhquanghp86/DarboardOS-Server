import http from 'http';
import { WebSocketServer } from "ws"
import env from "env-var";
import { makeConfigFromParams, setConfigFor, logDeviceConfig } from "./config.js";
import { broadcaster, ensureDeviceAsync, cleanupIdleAsync, requestStatsFromDevices, runAdaptiveTick, refreshDisplaysTick, markInteraction } from './deviceManager.js';
import type { DeviceSession } from './deviceManager.js';
import { InputRouter } from "./inputRouter.js";
import { bootstrapAsync } from './browser.js';
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

// ── Health check ─────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  // (14/09/2026) /metrics: số liệu thật để đo hiệu năng (GĐ0)
  if (req.url && req.url.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(metrics.snapshot(), null, 2));
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
setInterval(() => requestStatsFromDevices(), 10_000);
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
