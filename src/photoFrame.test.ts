// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { albumImageUrl, exifDate, isAlbumUrl, parseAlbumHtml, renderPhoto } from "./photoFrame.js";

describe("khung anh so", () => {
  it("anh vua khung: dung kich thuoc man hinh, nen mo (khong den)", async () => {
    const src = await sharp({ create: { width: 600, height: 1200, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
    const out = await renderPhoto(src, 1024, 600, "frame");
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([1024, 600]);
    const { data } = await sharp(out).extract({ left: 10, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(60);   // goc trai: nen do toi (anh mo), khong phai den
    const cover = await sharp(await renderPhoto(src, 480, 272, "cover")).metadata();
    expect([cover.width, cover.height]).toEqual([480, 272]);
  });
  it("ngay chup EXIF", () => {
    expect(exifDate(Buffer.from("xx2025:01:02 03:04:05\0yy2024:05:01 10:20:30\0", "latin1"))).toBe("01/05/2024");
    expect(exifDate(Buffer.from("none"))).toBeNull();
    expect(exifDate(undefined)).toBeNull();
  });
  it("album Google Photos chia se: link hop le, lay anh /pw/, bo anh dai dien", () => {
    expect(isAlbumUrl("https://photos.app.goo.gl/AbCd1234EfGh")).toBe(true);
    expect(isAlbumUrl("https://photos.google.com/share/AF1QipABC?key=xyz")).toBe(true);
    expect(isAlbumUrl("http://evil.local/x")).toBe(false);
    const id1 = "AP1GczM" + "a".repeat(40), id2 = "AP1GczN" + "b".repeat(40);
    const html = `x "https://lh3.googleusercontent.com/pw/${id1}",1600,1200 "https://lh3.googleusercontent.com/a/ACg8ocAvatar" ` +
      `"https://lh3.googleusercontent.com/pw/${id2}" "https://lh3.googleusercontent.com/pw/${id1}"`;
    expect(parseAlbumHtml(html)).toEqual([`https://lh3.googleusercontent.com/pw/${id1}`, `https://lh3.googleusercontent.com/pw/${id2}`]);
    expect(albumImageUrl("https://lh3.googleusercontent.com/pw/X", 1024, 600)).toBe("https://lh3.googleusercontent.com/pw/X=w1024-h600");
  });
});
