// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FrameProcessor, splitBands, type FrameProcessorCfg, type RGBA } from "./frameProcessor.js";
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

// (23/09/2026) Nhớ "cỡ này không nén vừa cap" để bỏ thang chất lượng vô ích.
// Đo trên addon thật (P4 1024x600, cap 16KB): thang 4 nấc trên CẢ KHUNG tốn
// 67ms và KHÔNG nấc nào vừa, lại chạy hai lần mỗi khung -> 73% thời gian nén
// là vô ích. Điều kiện bắt buộc của bản vá: KẾT QUẢ KHÔNG ĐƯỢC ĐỔI.

/** Ảnh nhiều chi tiết nhưng TẤT ĐỊNH (không dùng Math.random) để so hai khung. */
function makeSeededDetail(w: number, h: number): RGBA {
  const data = Buffer.allocUnsafe(w * h * 4);
  let s = 0x2545f491;
  for (let i = 0; i < w * h; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    const o = i * 4;
    data[o] = s & 0xff;
    data[o + 1] = (s >> 8) & 0xff;
    data[o + 2] = (s >> 16) & 0xff;
    data[o + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("bỏ thang chất lượng khi đã biết chắc không vừa cap", () => {
  it("khung 2 (bỏ thang) cho ra ĐÚNG kết quả như khung 1 (chạy thang)", async () => {
    const m = 16 * 1024;
    const cap = m - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
    const proc = mkProc({
      fullframeTileCount: 1, fullFrameEvery: 1,
      jpegQuality: 70, maxBytesPerMessage: m, tileSize: 128,
    });
    const frame = makeSeededDetail(1024, 600);

    const a = await proc.processFrameAsync(frame);
    const b = await proc.processFrameAsync(frame);

    // cả khung không đời nào vừa 16KB -> phải chia nhỏ, không có wholeFrameHit
    expect(proc.stats.wholeFrameHits).toBe(0);
    expect(a.rects.length).toBeGreaterThan(1);
    const shape = (o: typeof a) => o.rects.map((r) => [r.x, r.y, r.w, r.h, r.data.length]);
    expect(shape(b)).toEqual(shape(a));
    for (const r of b.rects) expect(r.data.length).toBeLessThanOrEqual(cap);
  });

  it("đổi trần chất lượng thì số đo đã nhớ hết hiệu lực", async () => {
    const proc = mkProc({
      fullframeTileCount: 1, fullFrameEvery: 1,
      jpegQuality: 80, maxBytesPerMessage: 256 * 1024, tileSize: 128,
    });
    const frame = makeSeededDetail(480, 272);
    const a = await proc.processFrameAsync(frame);

    // Hạ trần -> ảnh phải NHỎ ĐI. Nếu bộ nhớ không được xoá thì thang bị bỏ
    // qua theo số đo của trần cũ và kích thước sẽ không đổi.
    proc.setTuning({ jpegQuality: 30 });
    const b = await proc.processFrameAsync(frame);
    expect(b.rects.length).toBeGreaterThan(0);
    const bytesOf = (o: typeof a) => o.rects.reduce((n, r) => n + r.data.length, 0);
    expect(bytesOf(b)).toBeLessThan(bytesOf(a));
  });
});

describe("GD2 - full-frame gửi 1 ảnh khi vừa giới hạn", () => {
  it("UI 480x480 fftc=4: full-frame chỉ 1 rect (1 lần decode trên thiết bị)", async () => {
    const proc = mkProc({ fullframeTileCount: 4 });
    const out = await proc.processFrameAsync(makeFrame(480, 480, "ui"));
    expect(out.isFullFrame).toBe(true);
    expect(out.rects.length).toBe(1);
    expect(out.rects[0].w).toBe(480);
    expect(out.rects[0].h).toBe(480);
    expect(out.rects[0].data.length).toBeLessThanOrEqual(CAP_TILE);
    expect(proc.stats.wholeFrameHits).toBe(1);
  });

  it("nội dung chi tiết vượt cap: tự quay về chia mảnh, không đỏ, không quá cap", async () => {
    const proc = mkProc({ fullframeTileCount: 4 });
    const out = await proc.processFrameAsync(makeFrame(480, 480, "noise"));
    expect(out.isFullFrame).toBe(true);
    expect(out.rects.length).toBeGreaterThanOrEqual(1);
    for (const r of out.rects) {
      expect(r.data.length).toBeLessThanOrEqual(CAP_TILE);
      expect(await isUniformRed(r.data)).toBe(false);
    }
  });
});

describe("chia dải ngang cho giải mã thẳng vào framebuffer (25/09/2026)", () => {
  it("1024x600, 4 phần: dải lẻ 24 dòng trên cùng rồi 4 dải 144 (bội 16), phủ kín, không chồng", () => {
    const b = splitBands(1024, 600, 4);
    expect(b.map((r) => r.h)).toEqual([24, 144, 144, 144, 144]);
    expect(b.every((r) => r.x === 0 && r.w === 1024)).toBe(true);
    let y = 0; for (const r of b) { expect(r.y).toBe(y); y += r.h; }
    expect(y).toBe(600);
    expect(b.slice(1).every((r) => r.h % 16 === 0)).toBe(true);
  });
  it("chiều cao chia hết: không có dải lẻ", () => {
    expect(splitBands(480, 480, 3).map((r) => r.h)).toEqual([160, 160, 160]);
  });
});

describe("khung doi kich thuoc giua chung (OS-2: tab moi bat screencast)", () => {
  it("tao lai luoi o va gui ca khung, khong loi canh o am", async () => {
    const p = mkProc({ fullFrameEvery: 1000 });
    await p.processFrameAsync(makeFrame(480, 480, "ui"));
    await p.processFrameAsync(makeFrame(480, 480, "ui"));
    const out = await p.processFrameAsync(makeFrame(400, 300, "ui"));   // truoc day: Buffer.allocUnsafe(so am)
    expect(out.isFullFrame).toBe(true);
    for (const r of out.rects) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x + r.w).toBeLessThanOrEqual(400);
      expect(r.y + r.h).toBeLessThanOrEqual(300);
    }
    const back = await p.processFrameAsync(makeFrame(480, 480, "ui"));
    expect(back.isFullFrame).toBe(true);
  });
});

describe("ve lai vung (xoa vong tron phan hoi cham cua thiet bi)", () => {
  it("khung giong het van gui lai DUNG cac o chong len vung xin ve lai", async () => {
    const p = mkProc({ tileSize: 64, fullFrameEvery: 1000, fullframeAreaThreshold: 0.9 });
    const f = makeFrame(256, 256, "ui");
    await p.processFrameAsync(f);                      // khung dau: ca khung
    expect((await p.processFrameAsync(f)).rects).toEqual([]);   // khong doi: khong gui gi
    p.invalidateRect(100, 100, 44, 44);                // vung 100..143 -> o (1,1),(2,1),(1,2),(2,2)
    const out = await p.processFrameAsync(f);
    const area = out.rects.reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBe(4 * 64 * 64);
    for (const r of out.rects) expect(r.x < 144 && r.x + r.w > 100 && r.y < 144 && r.y + r.h > 100).toBe(true);
    expect((await p.processFrameAsync(f)).rects).toEqual([]);   // chi mot lan
  });
});
