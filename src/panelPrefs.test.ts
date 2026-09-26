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
    expect(p.items("a", D).filter((i) => i.sec === "screen").map((i) => [i.id, i.on, i.value])).toEqual([
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

describe("cai dat khung anh so", () => {
  it("mac dinh + doi tung muc + album dung chung, chi link album hop le", () => {
    const p = new PanelPrefsStore(null);
    expect(p.frame("a")).toEqual({ intervalS: 60, effect: "fade", fit: "cover", order: "random", clock: true, info: true, source: "both", album: "" });
    expect(p.set("a", "rwv.photo_interval", "15 giây")).toBe(true);
    expect(p.set("a", "rwv.photo_effect", "Trượt")).toBe(true);
    expect(p.set("a", "rwv.photo_fit", "Vừa khung")).toBe(true);
    expect(p.set("a", "rwv.photo_order", "Theo thứ tự")).toBe(true);
    expect(p.set("a", "rwv.photo_clock", false)).toBe(true);
    expect(p.set("a", "rwv.photo_source", "Google Photos")).toBe(true);
    expect(p.set("a", "rwv.gphotos_url", "http://evil/x")).toBe(false);
    expect(p.set("a", "rwv.gphotos_url", "https://photos.app.goo.gl/AbC123")).toBe(true);
    expect(p.frame("a")).toMatchObject({ intervalS: 15, effect: "slide", fit: "frame", order: "name", clock: false, source: "google", album: "https://photos.app.goo.gl/AbC123" });
    expect(p.frame("b").album).toBe("https://photos.app.goo.gl/AbC123");   // album dung chung
    expect(p.frame("b").intervalS).toBe(60);                                // con lai rieng tung man hinh
    expect(p.items("a", D).find((i) => i.id === "rwv.photo_effect")?.value).toBe("Trượt");
  });
});
