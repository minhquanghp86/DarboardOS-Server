import { describe, expect, it } from "vitest";
import { PanelPrefsStore } from "./panelPrefs.js";

const D = { saverPhotos: true, morning: true, saverIdleS: 120 };
describe("cai dat addon theo tung man hinh", () => {
  it("mac dinh theo tuy chon addon, doi rieng tung man hinh, tu choi muc la", () => {
    const p = new PanelPrefsStore(null);
    expect(p.saverPhotos("a", true)).toBe(true);
    expect(p.set("a", "rwv.saver_photos", false)).toBe(true);
    expect(p.saverPhotos("a", true)).toBe(false);
    expect(p.saverPhotos("b", true)).toBe(true);
    expect(p.set("a", "rwv.khac", true)).toBe(false);
    expect(p.set("a", "rwv.saver_photos", "yes")).toBe(false);
  });
  it("chao buoi sang + thoi gian cho", () => {
    const p = new PanelPrefsStore(null);
    expect(p.items("a", D).map((i) => [i.id, i.on, i.value])).toEqual([
      ["rwv.saver_idle", true, "2 phút"], ["rwv.saver_photos", true, ""], ["rwv.morning", true, ""]]);
    expect(p.set("a", "rwv.morning", false)).toBe(true);
    expect(p.morning("a", true)).toBe(false);
    expect(p.set("a", "rwv.saver_idle", "Tắt")).toBe(true);
    expect(p.saverIdleS("a", 120)).toBe(0);
    expect(p.set("a", "rwv.saver_idle", "5 phút")).toBe(true);
    expect(p.saverIdleS("a", 120)).toBe(300);
    expect(p.set("a", "rwv.saver_idle", "7 phút")).toBe(false);
    // Tuy chon addon la (vd 45 s) van hien duoc trong danh sach
    expect(new PanelPrefsStore(null).items("b", { ...D, saverIdleS: 45 })[0].options).toContain("1 phút");
  });
});
