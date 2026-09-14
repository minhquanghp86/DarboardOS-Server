// Thống kê runtime cho endpoint /metrics (GĐ0 - đo hiệu năng).
// Chỉ đếm trong RAM, không phụ thuộc dịch vụ ngoài, không ảnh hưởng luồng dữ liệu.
import type { FrameOut } from "./frameProcessor.js";

export type DeviceMetricsConfig = {
  width: number;
  height: number;
  tileSize: number;
  fullFrameTileCount: number;
  jpegQuality: number;
  maxBytesPerMessage: number;
  minFrameInterval: number;
  rotation: number;
};

export type FrameProcessorStats = {
  frames: number;
  rects: number;
  bytes: number;
  encodeMs: number;
  qualityFallbacks: number;
  splits: number;
  droppedRects: number;
  oversizeDropped: number;
  wholeFrameHits: number;
};

export type DeviceMetrics = {
  id: string;
  connectedAt: number;
  config: DeviceMetricsConfig | null;
  clients: number;
  framesSent: number;
  framesSkipped: number;
  packetsSent: number;
  bytesSent: number;
  rectsTotal: number;
  encodeMsTotal: number;
  qualityFallbacks: number;
  splits: number;
  droppedRects: number;
  oversizeDropped: number;
  frameErrors: number;
  navigations: number;
  decodeMsTotal: number;
  decodeSamples: number;
  lastDecodeMs: number;
  recentDecode: number[];
  deviceHeapFree: number | null;
  devicePsramFree: number | null;
  appliedQuality: number | null;
  appliedMinFrameIntervalMs: number | null;
  lastAdaptiveReason: string | null;
  adaptiveChanges: number;
  lastUrl: string | null;
  lastFrameAt: number;
  lastError: string | null;
};

const startedAt = Date.now();
const devices = new Map<string, DeviceMetrics>();

function dev(id: string): DeviceMetrics {
  let d = devices.get(id);
  if (!d) {
    d = {
      id,
      connectedAt: Date.now(),
      config: null,
      clients: 0,
      framesSent: 0,
      framesSkipped: 0,
      packetsSent: 0,
      bytesSent: 0,
      rectsTotal: 0,
      encodeMsTotal: 0,
      qualityFallbacks: 0,
      splits: 0,
      droppedRects: 0,
      oversizeDropped: 0,
      frameErrors: 0,
      navigations: 0,
      decodeMsTotal: 0,
      decodeSamples: 0,
      lastDecodeMs: 0,
      recentDecode: [],
      deviceHeapFree: null,
      devicePsramFree: null,
      appliedQuality: null,
      appliedMinFrameIntervalMs: null,
      lastAdaptiveReason: null,
      adaptiveChanges: 0,
      lastUrl: null,
      lastFrameAt: 0,
      lastError: null,
    };
    devices.set(id, d);
  }
  return d;
}

export const metrics = {
  setConfig(id: string, cfg: DeviceMetricsConfig): void {
    dev(id).config = { ...cfg };
  },
  // ĐẶT số client hiện tại (không cộng/trừ) - tránh lệch khi một socket đóng
  // kích hoạt cả sự kiện 'close' lẫn 'error'.
  setClientCount(id: string, n: number): void {
    dev(id).clients = n;
  },
  onFrameSkipped(id: string): void {
    dev(id).framesSkipped++;
  },
  onFrameEncoded(id: string, out: FrameOut, stats: FrameProcessorStats, ms: number): void {
    const d = dev(id);
    d.framesSent++;
    d.rectsTotal += out.rects.length;
    d.encodeMsTotal += ms;
    d.lastFrameAt = Date.now();
    d.qualityFallbacks = stats.qualityFallbacks;
    d.splits = stats.splits;
    d.droppedRects = stats.droppedRects;
    d.oversizeDropped = stats.oversizeDropped;
  },
  onPacket(id: string, bytes: number): void {
    const d = dev(id);
    d.packetsSent++;
    d.bytesSent += bytes;
  },
  onFrameError(id: string, msg: string): void {
    const d = dev(id);
    d.frameErrors++;
    d.lastError = String(msg).slice(0, 200);
  },
  // (14/09/2026) GD2: thoi gian decode MA THIET BI bao ve (qua FrameStats)
  onDeviceDecodeMs(id: string, ms: number): void {
    const d = dev(id);
    d.decodeMsTotal += ms;
    d.decodeSamples++;
    d.lastDecodeMs = ms;
    // (14/09/2026) GĐ3: giữ 6 mẫu gần nhất để điều khiển theo TẢI HIỆN TẠI (không phải
    // trung bình từ lúc kết nối) - dùng giá trị CAO NHẤT để tránh giật khung.
    d.recentDecode.push(ms);
    if (d.recentDecode.length > 6) d.recentDecode.shift();
  },
  // (14/09/2026) GD3.5: RAM/PSRAM do thiet bi bao qua FrameStats
  onDeviceMemory(id: string, heapFree: number, psramFree: number): void {
    const d = dev(id);
    d.deviceHeapFree = heapFree;
    d.devicePsramFree = psramFree;
  },
  onAdaptiveChange(id: string, quality: number, minFrameIntervalMs: number, reason: string): void {
    const d = dev(id);
    d.appliedQuality = quality;
    d.appliedMinFrameIntervalMs = minFrameIntervalMs;
    d.lastAdaptiveReason = reason;
    d.adaptiveChanges++;
  },
  onNavigate(id: string, url: string): void {
    const d = dev(id);
    d.navigations++;
    d.lastUrl = String(url).slice(0, 200);
  },
  removeDevice(id: string): void {
    devices.delete(id);
  },
  snapshot() {
    const now = Date.now();
    const list = [...devices.values()].map((d) => {
      const upS = Math.max(1, (now - d.connectedAt) / 1000);
      return {
        ...d,
        uptimeSec: Math.round(upS),
        avgFps: +(d.framesSent / upS).toFixed(2),
        avgFrameBytes: d.framesSent ? Math.round(d.bytesSent / d.framesSent) : 0,
        avgEncodeMs: d.framesSent ? +(d.encodeMsTotal / d.framesSent).toFixed(1) : 0,
        avgDecodeMs: d.decodeSamples ? +(d.decodeMsTotal / d.decodeSamples).toFixed(1) : null,
        recentMaxDecodeMs: d.recentDecode.length ? Math.max(...d.recentDecode) : null,
        msSinceLastFrame: d.lastFrameAt ? now - d.lastFrameAt : null,
      };
    });
    return {
      ok: true,
      uptimeSec: Math.round((now - startedAt) / 1000),
      deviceCount: list.length,
      devices: list,
    };
  },
};
