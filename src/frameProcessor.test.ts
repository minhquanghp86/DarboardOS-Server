import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FrameProcessor, type FrameProcessorCfg, type RGBA } from "./frameProcessor.js";
import { FRAME_HEADER_BYTES, TILE_HEADER_BYTES } from "./protocol.js";

// (14/09/2026) Test cho bản vá "không gửi khối đỏ":
// Trước đây khi 1 rect vượt maxBytesPerMessage, FrameProcessor thay nó bằng MỘT ẢNH ĐỎ
// toàn khung (xem _makeRedFrameAsync) -> người dùng thấy màn hình đỏ. Nay phải: hạ quality
// (hoặc chia nhỏ) để vừa cap, và trong mọi trường hợp KHÔNG trả về ảnh đỏ.

const MBPM = 32 * 1024;
const CAP_TILE = MBPM - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;

function makeFrame(w: number, h: number, kind: "ui" | "noise" | "photo"): RGBA {
  const data = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r: number, g: number, b: number;
      if (kind === "noise") {
        r = (Math.random() * 256) | 0;
        g = (Math.random() * 256) | 0;
        b = (Math.random() * 256) | 0;
      } else if (kind === "ui") {
        const blk = ((x / 60) | 0) + ((y / 60) | 0) * 8;
        const t = blk % 3 === 0;
        r = t ? 40 : 245;
        g = t ? 90 : 245;
        b = t ? 200 : 240;
      } else {
        const base = 60 + ((x * 120) / w | 0) + ((y * 60) / h | 0);
        r = Math.min(255, base + ((Math.random() * 24) | 0));
        g = Math.min(255, base + 20 + ((Math.random() * 24) | 0));
        b = Math.min(255, base + 40 + ((Math.random() * 24) | 0));
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

async function isUniformRed(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] < 200 || data[i + 1] > 60 || data[i + 2] > 60) return false;
  }
  return true;
}

function mkProc(over: Partial<FrameProcessorCfg> = {}): FrameProcessor {
  const cfg: FrameProcessorCfg = {
    tileSize: 64,
    fullframeTileCount: 4,
    fullframeAreaThreshold: 0.5,
    jpegQuality: 60,
    fullFrameEvery: 50,
    maxBytesPerMessage: MBPM,
    ...over,
  };
  return new FrameProcessor(cfg);
}

describe("FrameProcessor - không bao giờ trả về khối đỏ", () => {
  it("480x272, full_frame_tile_count=1 (cả khung 1 tile), nội dung chi tiết", async () => {
    const out = await mkProc({ fullframeTileCount: 1 }).processFrameAsync(makeFrame(480, 272, "noise"));
    expect(out.rects.length).toBeGreaterThan(0);
    for (const r of out.rects) {
      expect(r.data.length).toBeLessThanOrEqual(CAP_TILE);
      expect(await isUniformRed(r.data)).toBe(false);
    }
  });

  it("1024x600, fftc=1, q=80, cap 256KB - nội dung chi tiết vẫn không đỏ", async () => {
    const m = 256 * 1024;
    const out = await mkProc({ fullframeTileCount: 1, jpegQuality: 80, maxBytesPerMessage: m })
      .processFrameAsync(makeFrame(1024, 600, "noise"));
    const cap = m - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
    expect(out.rects.length).toBeGreaterThan(0);
    for (const r of out.rects) {
      expect(r.data.length).toBeLessThanOrEqual(cap);
      expect(await isUniformRed(r.data)).toBe(false);
    }
  });

  it("480x480, fftc=4 (panel đang chạy) - nội dung UI bình thường", async () => {
    const out = await mkProc().processFrameAsync(makeFrame(480, 480, "ui"));
    expect(out.rects.length).toBeGreaterThan(0);
    for (const r of out.rects) {
      expect(r.data.length).toBeLessThanOrEqual(CAP_TILE);
      expect(await isUniformRed(r.data)).toBe(false);
    }
  });

  it("khung thứ 2 không đổi -> không gửi gì", async () => {
    const proc = mkProc();
    await proc.processFrameAsync(makeFrame(480, 480, "ui"));
    const out2 = await proc.processFrameAsync(makeFrame(480, 480, "ui"));
    expect(out2.rects.length).toBe(0);
  });

  it("thống kê được ghi lại để đo hiệu năng", async () => {
    const proc = mkProc({ fullframeTileCount: 1 });
    await proc.processFrameAsync(makeFrame(480, 272, "noise"));
    expect(proc.stats.frames).toBe(1);
    expect(proc.stats.rects).toBeGreaterThan(0);
    expect(proc.stats.bytes).toBeGreaterThan(0);
    expect(proc.stats.oversizeDropped).toBe(0);
  });
});
