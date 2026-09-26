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
  it("chua biet trang thai den nen -> coi nhu sang", () => {
    expect(shouldShowSaver({ ...base, backlightOn: null })).toBe(true);
  });
});
