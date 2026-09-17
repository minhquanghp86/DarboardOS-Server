import { describe, expect, it } from "vitest";
import { parseFrameStats, FRAME_STATS_BYTES, FRAME_STATS_BYTES_LEGACY, MsgType, PROTOCOL_VERSION } from "./protocol.js";
import { DEFAULT_ADAPTIVE_CFG, decideAdaptive, initialAdaptiveState } from "./adaptive.js";

function statsPacket(avgTimeMs: number, heapFree?: number, psramFree?: number): Buffer {
  const size = heapFree === undefined ? FRAME_STATS_BYTES_LEGACY : FRAME_STATS_BYTES;
  const b = Buffer.alloc(size);
  b.writeUInt8(MsgType.FrameStats, 0);
  b.writeUInt8(PROTOCOL_VERSION, 1);
  b.writeUInt32LE(avgTimeMs, 2);
  if (heapFree !== undefined) {
    b.writeUInt32LE(heapFree, 10);
    b.writeUInt32LE(psramFree ?? 0, 14);
  }
  return b;
}

describe("GĐ3.5 - đọc gói FrameStats (tương thích ngược)", () => {
  it("gói CŨ 10 byte: chỉ có avgTime, heap = null", () => {
    const s = parseFrameStats(statsPacket(21));
    expect(s).not.toBeNull();
    expect(s!.avgTimeMs).toBe(21);
    expect(s!.heapFree).toBeNull();
    expect(s!.psramFree).toBeNull();
  });

  it("gói MỚI 18 byte: có thêm heap + psram", () => {
    const s = parseFrameStats(statsPacket(21, 30_000, 6_700_000));
    expect(s!.avgTimeMs).toBe(21);
    expect(s!.heapFree).toBe(30_000);
    expect(s!.psramFree).toBe(6_700_000);
  });

  it("gói rác -> null", () => {
    expect(parseFrameStats(Buffer.alloc(4))).toBeNull();
    const bad = statsPacket(5); bad.writeUInt8(99, 0);
    expect(parseFrameStats(bad)).toBeNull();
  });
});

describe("GĐ3.5 - phanh an toàn theo heap thiết bị", () => {
  const cfg = { ...DEFAULT_ADAPTIVE_CFG };
  const t0 = 5_000_000;

  it("heap thấp -> GIẢM quality ngay (không chờ decode vượt ngân sách)", () => {
    const st = initialAdaptiveState(60, 100, t0);
    const r = decideAdaptive(
      { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0, heapFree: cfg.minDeviceHeapFree - 1 },
      st, cfg, t0 + 60_000
    );
    expect(r.changed).toBe(true);
    expect(r.state.quality).toBe(50);
    expect(r.reason).toContain("heap");
  });

  it("heap thấp + đã chạm sàn quality -> giãn nhịp", () => {
    const st = { ...initialAdaptiveState(40, 100, t0), quality: 40 };
    const r = decideAdaptive(
      { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0, heapFree: 10_000 },
      st, cfg, t0 + 60_000
    );
    expect(r.changed).toBe(true);
    expect(r.state.minFrameIntervalMs).toBe(200); // AIMD: gian nhip nhan 2 (truoc day cong 50)
  });

  it("heap khoẻ -> không can thiệp (để đường decode quyết định)", () => {
    const st = initialAdaptiveState(60, 100, t0);
    const r = decideAdaptive(
      { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0, heapFree: 80_000 },
      st, cfg, t0 + 60_000
    );
    expect(r.changed).toBe(false);
  });

  it("firmware cũ (heapFree = null) -> vẫn chạy theo decode như trước", () => {
    const st = initialAdaptiveState(60, 100, t0);
    const r = decideAdaptive(
      { decodeMs: 200, bytesPerSec: 1000, frameErrors: 0, heapFree: null },
      st, cfg, t0 + 60_000
    );
    expect(r.changed).toBe(true);
    expect(r.state.quality).toBe(50);
  });
});
