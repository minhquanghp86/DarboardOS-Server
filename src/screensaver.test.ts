// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { shouldShowSaver } from "./screensaver.js";

const base = { now: 200_000, lastTouchMs: 0, idleMs: 120_000, mediaPlaying: false, backlightOn: true, shown: false };

describe("man hinh cho", () => {
  it("hien khi khong cham du lau", () => {
    expect(shouldShowSaver(base)).toBe(true);
    expect(shouldShowSaver({ ...base, lastTouchMs: 100_000 })).toBe(false);
  });
  it("khong hien khi dang phat video/camera, den nen tat, da hien, hoac tat tinh nang", () => {
    expect(shouldShowSaver({ ...base, mediaPlaying: true })).toBe(false);
    expect(shouldShowSaver({ ...base, backlightOn: false })).toBe(false);
    expect(shouldShowSaver({ ...base, shown: true })).toBe(false);
    expect(shouldShowSaver({ ...base, idleMs: 0 })).toBe(false);
  });
  it("ngung phat cung tinh la vua dung: dem ranh tu luc video ngung (YouTube nap dem thoang qua khong lam hien)", () => {
    expect(shouldShowSaver({ ...base, mediaStoppedMs: 195_000 })).toBe(false);
    expect(shouldShowSaver({ ...base, mediaStoppedMs: 100_000 })).toBe(false);
    expect(shouldShowSaver({ ...base, mediaStoppedMs: 70_000 })).toBe(true);
  });
  it("cam bien con bao co nguoi -> khong hien; bao trong -> dem ranh tu luc trong", () => {
    expect(shouldShowSaver({ ...base, presenceOn: true })).toBe(false);
    expect(shouldShowSaver({ ...base, presenceOn: false, presenceOffMs: 150_000 })).toBe(false);
    expect(shouldShowSaver({ ...base, presenceOn: false, presenceOffMs: 70_000 })).toBe(true);
  });
  it("chua biet trang thai den nen -> coi nhu sang", () => {
    expect(shouldShowSaver({ ...base, backlightOn: null })).toBe(true);
  });
});

import { deviceHour, isNightHour, nextSaverPhoto } from "./screensaver.js";
describe("man hinh cho khung anh", () => {
  it("gio thiet bi + ban dem", () => {
    const t = Date.UTC(2026, 8, 27, 16, 30);  // 16:30 UTC = 23:30 gio VN
    expect(deviceHour(t, 420)).toBe(23);
    expect(isNightHour(23)).toBe(true); expect(isNightHour(5)).toBe(true); expect(isNightHour(6)).toBe(false); expect(isNightHour(21)).toBe(false);
  });
  it("anh ke tiep: khong lap lai anh vua hien", () => {
    expect(nextSaverPhoto([], null)).toBeNull();
    expect(nextSaverPhoto(["a"], "a")).toBe("a");
    let r = 0; const seq = [0, 0, 0.9];
    expect(nextSaverPhoto(["a", "b"], "a", () => seq[r++])).toBe("b");
  });
});
