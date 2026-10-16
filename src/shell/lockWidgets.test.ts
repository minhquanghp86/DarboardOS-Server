// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { energyStats, eventWhen, fmtKwh, fmtW, lwModel, lwRows } from "./lockWidgets.js";

const TZ = 420;                                     // Viet Nam
const at = (iso: string) => Date.parse(iso);        // ISO co mui gio
const NOW = at("2026-10-08T09:30:00+07:00");        // Thu Nam 08/10/2026 9:30

describe("widget man khoa — dinh dang", () => {
  it("cong suat / san luong kieu Viet", () => {
    expect([fmtW(0), fmtW(239), fmtW(-239), fmtW(999.4), fmtW(999.6), fmtW(1234), fmtW(12500)]).toEqual(
      ["0 W", "239 W", "239 W", "999 W", "1,0 kW", "1,2 kW", "13 kW"]);
    expect([fmtKwh(12.44), fmtKwh(0), fmtKwh(3)]).toEqual(["12,4 kWh", "0 kWh", "3 kWh"]);
  });
  it("nang luong 6 chi so (16/10): PV hom nay, tai hom nay, luoi, tai, pin", () => {
    expect(energyStats({ pv: 0, pvd: 0, soc: 64, bat: 239, load: 222, grid: 0, ld: 3.6 })).toEqual([
      { k: "pvd", v: "0 kWh", l: "PV hôm nay", cls: "sun off" },
      { k: "pv", v: "0 W", l: "Công suất PV", cls: "sun off" },
      { k: "ld", v: "3,6 kWh", l: "Tải hôm nay", cls: "load" },
      { k: "grid", v: "0 W", l: "Tiêu thụ lưới", cls: "grid" },
      { k: "load", v: "222 W", l: "Tiêu thụ tải", cls: "load" },
      { k: "bat", v: "64%", l: "Đang xả 239 W", cls: "b-ok", soc: 64 },
    ]);
    const day = energyStats({ pv: 3150, soc: 18, bat: -1800, load: 900, grid: 400 });
    expect(day.map((s) => [s.v, s.l, s.cls])).toEqual([["3,2 kW", "Mặt trời", "sun"], ["400 W", "Tiêu thụ lưới", "grid"], ["900 W", "Tiêu thụ tải", "load"], ["18%", "Đang sạc 1,8 kW", "b-low"]]);
    expect(energyStats({ grid: -500 })).toEqual([{ k: "grid", v: "500 W", l: "Bán lưới", cls: "grid" }]);
  });
  it("lich theo gio thiet bi: hom nay / mai / thu, ca ngay, dang dien ra", () => {
    const ev = (s: string, e: string, ad?: 1) => ({ t: "x", s: at(s), e: at(e), ...(ad ? { ad } : {}) });
    expect(eventWhen(ev("2026-10-08T14:00:00+07:00", "2026-10-08T15:00:00+07:00"), NOW, TZ)).toBe("14:00");
    expect(eventWhen(ev("2026-10-09T07:05:00+07:00", "2026-10-09T08:00:00+07:00"), NOW, TZ)).toBe("Mai 07:05");
    expect(eventWhen(ev("2026-10-10T20:00:00+07:00", "2026-10-10T21:00:00+07:00"), NOW, TZ)).toBe("Thứ Bảy 20:00");
    expect(eventWhen(ev("2026-10-08T09:00:00+07:00", "2026-10-08T10:00:00+07:00"), NOW, TZ)).toBe("Đang diễn ra");
    expect(eventWhen(ev("2026-10-08T00:00:00+07:00", "2026-10-09T00:00:00+07:00", 1), NOW, TZ)).toBe("Hôm nay");
    expect(eventWhen(ev("2026-10-09T00:00:00+07:00", "2026-10-10T00:00:00+07:00", 1), NOW, TZ)).toBe("Ngày mai");
    expect(eventWhen(ev("2026-10-10T00:00:00+07:00", "2026-10-11T00:00:00+07:00", 1), NOW, TZ)).toBe("Thứ Bảy 10/10");
    // 23:30 dem nay theo gio VN (16:30 UTC) van la "hom nay" — khong lech ngay theo UTC
    expect(eventWhen(ev("2026-10-08T23:30:00+07:00", "2026-10-09T00:30:00+07:00"), NOW, TZ)).toBe("23:30");
  });
  it("camera: dang phat hien len dau, het 1 gio thi an; lich da xong bi bo", () => {
    const lw = {
      ev: [{ t: "Họp", s: at("2026-10-08T14:00:00+07:00"), e: at("2026-10-08T15:00:00+07:00") },
        { t: "Cũ", s: at("2026-10-08T07:00:00+07:00"), e: at("2026-10-08T08:00:00+07:00") }],
      cam: { id: "1.2-a", c: "ezviz", l: "person", s: NOW - 5 * 60_000 },
    };
    expect(lwRows(lw, NOW, TZ).map((r) => [r.b, r.t])).toEqual([["14:00", "Họp"], ["5 phút trước", "Người · Ezviz"]]);
    const live = lwRows({ ...lw, cam: { ...lw.cam, live: 1 as const, sub: "Minh" } }, NOW, TZ);
    expect(live[0]).toMatchObject({ b: "Đang phát hiện", t: "Người (Minh) · Ezviz", cls: "cam live" });
    expect(lwRows({ cam: { ...lw.cam, s: NOW - 61 * 60_000 } }, NOW, TZ)).toEqual([]);
    expect(lwModel({ ev: [] }, NOW, TZ)).toBeNull();
    expect(lwModel(null, NOW, TZ)).toBeNull();
  });
});
