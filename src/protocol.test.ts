// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { CURRENTURL_HEADER_BYTES, Encoding, FLAG_HALF_SCALE, FLAG_IS_FULL_FRAME, FLAG_LAST_OF_FRAME, MsgType, buildCurrentURLPacket, buildFramePackets, buildSetDisplayURLPacket, parseFrameHeader } from "./protocol.js";

describe("giao thức khung — cờ nửa độ phân giải (24/09/2026)", () => {
  const rect = { x: 0, y: 0, w: 1024, h: 600, data: Buffer.alloc(20_000, 7) };

  it("khung video nửa độ phân giải mang FLAG_HALF_SCALE cùng các cờ cũ, tile giữ kích thước THẬT", () => {
    const pk = buildFramePackets([rect], Encoding.JPEG, 42, true, 32_768, FLAG_HALF_SCALE);
    expect(pk.length).toBe(1);
    const h = parseFrameHeader(pk[0])!;
    expect(h.flags & FLAG_HALF_SCALE).toBeTruthy();
    expect(h.flags & FLAG_IS_FULL_FRAME).toBeTruthy();
    expect(h.flags & FLAG_LAST_OF_FRAME).toBeTruthy();
    expect(pk[0].readUInt16LE(h.payloadOffset + 4)).toBe(1024);  // w theo man hinh that
    expect(pk[0].readUInt16LE(h.payloadOffset + 6)).toBe(600);
  });

  it("mặc định (thiết bị không báo half=1) KHÔNG có cờ — firmware cũ không bao giờ thấy", () => {
    const h = parseFrameHeader(buildFramePackets([rect], Encoding.JPEG, 1, true, 32_768)[0])!;
    expect(h.flags & FLAG_HALF_SCALE).toBe(0);
  });
});

describe("gói SetDisplayURL — ô nhập URL của nút mở rộng (25/09/2026)", () => {
  it("cùng bố cục với CurrentURL ([type][ver][len u32le] + URL utf8), chỉ khác byte loại = 8", () => {
    const url = "https://vnexpress.net/tin-tức";
    const p = buildSetDisplayURLPacket(url);
    const c = buildCurrentURLPacket(url);
    expect(p.readUInt8(0)).toBe(MsgType.SetDisplayURL);
    expect(MsgType.SetDisplayURL).toBe(8);
    expect(c.readUInt8(0)).toBe(MsgType.CurrentURL);
    expect(p.subarray(1).equals(c.subarray(1))).toBe(true);
    expect(p.readUInt32LE(2)).toBe(Buffer.byteLength(url, "utf8"));
    expect(p.subarray(CURRENTURL_HEADER_BYTES).toString("utf8")).toBe(url);
  });
});
