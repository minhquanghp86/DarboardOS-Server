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
    expect(p.items("esp32-0a0b0c0d0002", D).filter((i) => i.sec === "screen").map((i) => [i.id, i.on, i.value])).toEqual([
      ["rwv.morning", true, ""], ["rwv.cast", true, ""], ["rwv.cast_name", true, "Darboard 0218"]]);
    expect(p.set("a", "rwv.morning", false)).toBe(true);
    expect(p.morning("a", true)).toBe(false);
    expect(p.set("a", "rwv.saver_idle", "Tắt")).toBe(true);
    expect(p.saverIdleS("a", 120)).toBe(0);
    expect(p.set("a", "rwv.saver_idle", "5 phút")).toBe(true);
    expect(p.saverIdleS("a", 120)).toBe(300);
    expect(p.set("a", "rwv.saver_idle", "7 phút")).toBe(false);
    // Tuy chon addon la (vd 45 s) van hien duoc trong danh sach
    expect(new PanelPrefsStore(null).items("b", { ...D, saverIdleS: 45 }).find((i) => i.id === "rwv.saver_idle")?.options).toContain("1 phút");
  });
});

describe("man hinh khoa (07/10/2026)", () => {
  it("mac dinh: tat khoa, giu do sang, dong ho lon, thoi tiet chi tiet; nhom 'lock' du muc", () => {
    const p = new PanelPrefsStore(null);
    expect([p.lockMode("a"), p.lockBrightness("a"), p.clockSize("a"), p.wxDetail("a")]).toEqual([false, 0, "l", true]);
    expect(p.items("a", D).filter((i) => i.sec === "lock").map((i) => [i.id, i.value || i.on])).toEqual([
      ["rwv.lock", false], ["rwv.saver_idle", "2 phút"], ["rwv.lock_bright", "Giữ nguyên"], ["rwv.clock_size", "Lớn"],
      ["rwv.wx_detail", true], ["rwv.lw_energy", true], ["rwv.lw_cal", true], ["rwv.lw_cam", true],
      ["rwv.saver_photos", true], ["rwv.photo_interval", "1 phút"]]);
  });
  it("(08/10/2026) widget man khoa: mac dinh bat ca ba, tat rieng tung loai theo man hinh", () => {
    const p = new PanelPrefsStore(null);
    expect(p.lockWidgets("a")).toEqual({ en: true, cal: true, cam: true });
    expect(p.set("a", "rwv.lw_cam", false)).toBe(true);
    expect(p.set("a", "rwv.lw_energy", "Tắt")).toBe(false);
    expect(p.lockWidgets("a")).toEqual({ en: true, cal: true, cam: false });
    expect(p.lockWidgets("b")).toEqual({ en: true, cal: true, cam: true });
  });
  it("doi tung muc, tu choi gia tri la", () => {
    const p = new PanelPrefsStore(null);
    expect(p.set("a", "rwv.lock", true)).toBe(true);
    expect(p.set("a", "rwv.lock_bright", "10%")).toBe(true);
    expect(p.set("a", "rwv.clock_size", "Rất lớn")).toBe(true);
    expect(p.set("a", "rwv.wx_detail", false)).toBe(true);
    expect(p.set("a", "rwv.saver_idle", "30 giây")).toBe(true);
    expect([p.lockMode("a"), p.lockBrightness("a"), p.clockSize("a"), p.wxDetail("a"), p.saverIdleS("a", 120)]).toEqual([true, 10, "xl", false, 30]);
    expect(p.items("a", D).find((i) => i.id === "rwv.saver_idle")?.value).toBe("30 giây");
    expect(p.set("a", "rwv.lock", "co")).toBe(false);
    expect(p.set("a", "rwv.lock_bright", "15%")).toBe(false);
    expect(p.set("a", "rwv.clock_size", "Khổng lồ")).toBe(false);
    expect(p.lockMode("b")).toBe(false);
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

describe("truyen YouTube", () => {
  it("bat mac dinh, tat rieng tung man hinh, doi ten (loc ky tu la)", () => {
    const p = new PanelPrefsStore(null);
    expect(p.cast("a", true)).toBe(true);
    expect(p.set("a", "rwv.cast", false)).toBe(true);
    expect(p.cast("a", true)).toBe(false);
    expect(p.castName("esp32-0a0b0c0d0002")).toBe("Darboard 0218");
    expect(p.set("a", "rwv.cast_name", "Phòng <khách>")).toBe(true);
    expect(p.castName("a")).toBe("Phòng khách");
    expect(p.set("a", "rwv.cast_name", "x".repeat(41))).toBe(false);
  });
});

describe("(08/10/2026) Cai dat kieu iOS — muc cua addon", () => {
  it("moi muc deu co muc lon + nhom con", () => {
    const p = new PanelPrefsStore(null);
    const items = p.items("a", D);
    for (const i of items) { expect(i.cat, i.id).toBeTruthy(); expect(i.sub, i.id).toBeTruthy(); }
    expect(items.filter((i) => i.cat === "lock").map((i) => i.sub)).toEqual(["Khóa", "Khóa", "Khóa", "Hiển thị", "Hiển thị", "Widget", "Widget", "Widget"]);
  });
});
