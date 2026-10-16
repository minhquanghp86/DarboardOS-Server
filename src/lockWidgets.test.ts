// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { buildEnergy, energyFromPrefs, lockWidgetsFor, numIn, pickEvents, sanitizeEnergyCfg } from "./lockWidgets.js";

const st = (state: string, unit = "W") => ({ state, attributes: { unit_of_measurement: unit } });

describe("widget man khoa — nang luong", () => {
  it("doc trang Nang luong HA 2026.9 (cau hinh that 08/10): cong suat PV / pin / luoi + % pin", () => {
    const prefs = { energy_sources: [
      { type: "solar", stat_energy_from: "sensor.luxpower_tong_san_luong_pv", stat_rate: "sensor.luxpower_tong_cong_suat_pv" },
      { type: "battery", stat_energy_from: "sensor.a", stat_energy_to: "sensor.b", power_config: { stat_rate: "sensor.luxpower_pin_luxpower_cong_suat_pin" },
        stat_soc: "sensor.luxpower_soc_pin", stat_rate: "sensor.luxpower_pin_luxpower_cong_suat_pin" },
      { type: "grid", stat_energy_from: "sensor.c", power_config: { stat_rate: "sensor.luxpower_cong_suat_nhap_luoi" }, stat_rate: "sensor.luxpower_cong_suat_nhap_luoi" },
    ] };
    expect(energyFromPrefs(prefs)).toEqual({ pv: "sensor.luxpower_tong_cong_suat_pv", soc: "sensor.luxpower_soc_pin",
      bat: "sensor.luxpower_pin_luxpower_cong_suat_pin", grid: "sensor.luxpower_cong_suat_nhap_luoi" });
    expect(energyFromPrefs({ energy_sources: [{ type: "battery", power_config: { stat_rate_inverted: "sensor.p" } }] }))
      .toEqual({ bat: "sensor.p", batInvert: true });
    expect(energyFromPrefs(null)).toEqual({});
  });
  it("loc cau hinh luu: chi sensor.*, dao dau chi khi co cam bien", () => {
    expect(sanitizeEnergyCfg({ pv: " sensor.pv ", soc: "light.x", bat: "sensor.b", batInvert: true, gridInvert: true, load: 3 }))
      .toEqual({ pv: "sensor.pv", bat: "sensor.b", batInvert: true });
  });
  it("don vi: kW -> W, Wh -> kWh, unavailable -> bo", () => {
    expect(numIn(st("1.25", "kW"), "W")).toBe(1250);
    expect(numIn(st("12400", "Wh"), "kWh")).toBe(12.4);
    expect(numIn(st("64", "%"), "%")).toBe(64);
    expect(numIn(st("unavailable"), "W")).toBeUndefined();
    expect(numIn(st("5", "A"), "W")).toBeUndefined();
    expect(numIn(null, "W")).toBeUndefined();
  });
  it("cam bien pin nguoc dau (do that: cong_suat_pin = -239 W luc dang xa ban dem) -> + = dang xa", () => {
    const cfg = { pv: "sensor.pv", soc: "sensor.soc", bat: "sensor.bat", batInvert: true, load: "sensor.load", grid: "sensor.grid" };
    expect(buildEnergy(cfg, { pv: st("0.0"), soc: st("64.0", "%"), bat: st("-239.0"), load: st("222.0"), grid: st("0.0") }))
      .toEqual({ pv: 0, soc: 64, bat: 239, load: 222, grid: 0 });
    expect(buildEnergy(cfg, { pv: st("unknown"), soc: st("140", "%") })).toEqual({});
  });
});

describe("widget man khoa — lich", () => {
  const TZ = 420, NOW = Date.parse("2026-10-08T01:30:00+07:00");
  const allDay = (d: string, e: string, summary = "x") => ({ summary, start: { date: d }, end: { date: e } });
  it("bo lich nen moi ngay mot su kien ca ngay (Lịch âm '28/8'), giu ngay le, giu su kien co gio chua xong", () => {
    const lichAm = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map((d, i) =>
      allDay(d, `2026-10-${String(8 + i).padStart(2, "0")}`, `${27 + i}/8`));
    const ngayLe = [allDay("2026-10-10", "2026-10-11", "Ngày Giải phóng Thủ đô")];
    const timed = [
      { summary: "Họp", start: { dateTime: "2026-10-08T14:00:00+07:00" }, end: { dateTime: "2026-10-08T15:00:00+07:00" } },
      { summary: "Đã xong", start: { dateTime: "2026-10-07T20:00:00+07:00" }, end: { dateTime: "2026-10-07T21:00:00+07:00" } },
    ];
    const out = pickEvents([lichAm, ngayLe, timed], NOW, TZ);
    expect(out.map((e) => [e.t, e.ad ?? 0])).toEqual([["Họp", 0], ["Ngày Giải phóng Thủ đô", 1]]);
    expect(out[1].s).toBe(Date.parse("2026-10-10T00:00:00+07:00"));   // nua dem gio VN
    expect(out[1].e).toBe(Date.parse("2026-10-11T00:00:00+07:00"));
  });
  it("tieu de rong / khong co ngay -> bo; toi da 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ summary: `S${i}`, start: { dateTime: `2026-10-08T1${i}:00:00+07:00` } }));
    expect(pickEvents([[{ summary: "  ", start: { date: "2026-10-08" } }, { summary: "y" }], many], NOW, TZ).map((e) => e.t))
      .toEqual(["S0", "S1", "S2", "S3", "S4", "S5"]);
  });
  it("chua co so lieu -> null", () => {
    expect(lockWidgetsFor("esp32-x", { en: true, cal: true, cam: true })).toBeNull();
  });
});
