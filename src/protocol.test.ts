// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { ControlField, buildDeviceControlPacket, parseDeviceStatePacket, CURRENTURL_HEADER_BYTES, Encoding, FLAG_HALF_SCALE, FLAG_IS_FULL_FRAME, FLAG_LAST_OF_FRAME, MsgType, buildCurrentURLPacket, buildFramePackets, buildSetDisplayURLPacket, parseFrameHeader } from "./protocol.js";

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

describe("DeviceControl / DeviceState (25/09/2026: thanh truot + dong ho menu)", () => {
  it("DeviceControl 4 byte, gia tri kep 0..100", () => {
    const p = buildDeviceControlPacket(ControlField.Volume, 140);
    expect([...p]).toEqual([MsgType.DeviceControl, 1, 2, 100]);
    expect(buildDeviceControlPacket(ControlField.Brightness, -3).readUInt8(3)).toBe(0);
  });

  function statePkt(bri: number, vol: number, flags: number, epoch: number, sod: number): Buffer {
    const b = Buffer.alloc(13);
    b.writeUInt8(MsgType.DeviceState, 0); b.writeUInt8(1, 1);
    b.writeUInt8(bri, 2); b.writeUInt8(vol, 3); b.writeUInt8(flags, 4);
    b.writeUInt32LE(epoch, 5); b.writeUInt32LE(sod, 9);
    return b;
  }

  it("suy mui gio +7 tu gio dia phuong, ke ca khi qua nua dem UTC", () => {
    const epoch = Date.UTC(2026, 8, 25, 13, 8, 52) / 1000;              // 13:08:52 UTC
    const s = parseDeviceStatePacket(statePkt(80, 55, 3, epoch, 20 * 3600 + 8 * 60 + 52))!;  // 20:08:52 +07
    expect(s).toMatchObject({ brightness: 80, volume: 55, backlightOn: true, timeValid: true, tzOffsetMin: 420 });
    const e2 = Date.UTC(2026, 8, 25, 20, 30, 0) / 1000;                  // 20:30 UTC = 03:30 hom sau (+7)
    expect(parseDeviceStatePacket(statePkt(80, 55, 2, e2, 3 * 3600 + 30 * 60))!.tzOffsetMin).toBe(420);
    const e3 = Date.UTC(2026, 8, 25, 2, 0, 0) / 1000;                    // 02:00 UTC = 21:00 hom truoc (-5)
    expect(parseDeviceStatePacket(statePkt(80, 55, 2, e3, 21 * 3600))!.tzOffsetMin).toBe(-300);
  });

  it("255 = chua biet; gio khong hop le khi thieu co hoac epoch qua cu", () => {
    const s = parseDeviceStatePacket(statePkt(255, 255, 1, 0, 0))!;
    expect(s.brightness).toBeNull();
    expect(s.volume).toBeNull();
    expect(s.timeValid).toBe(false);
    expect(parseDeviceStatePacket(Buffer.alloc(5))).toBeNull();
  });
});
