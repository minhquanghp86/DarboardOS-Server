import { describe, expect, it } from "vitest";
import { sanitize } from "./launcherConfig.js";

describe("cau hinh menu (trang Menu panel)", () => {
  it("chi giu gia tri hop le", () => {
    const c = sanitize({
      hidden: ["tiktok", "bad id!", 5],
      order: { nha: ["cams", "home"], xyz: ["a"] },
      custom: [
        { id: "c_abc", label: " Bếp ", url: "http://ha/bep", group: "nha", icon: "mdi:stove", color: "#ff0000" },
        { id: "c_x", label: "JS", url: "javascript:alert(1)" },
        { id: "noprefix", label: "A", url: "https://a.vn" },
        { id: "c_y", label: "Y", url: "https://y.vn", icon: "fa:car", color: "red", group: "lung_tung" },
      ],
      overrides: { home: { label: "Nhà tôi", icon: "mdi:home-heart", color: "#123456", group: "tien_ich", evil: 1 }, "x y": { label: "z" } },
    });
    expect(c.hidden).toEqual(["tiktok"]);
    expect(c.order).toEqual({ nha: ["cams", "home"] });
    expect(c.custom).toEqual([
      { id: "c_abc", label: "Bếp", url: "http://ha/bep", group: "nha", icon: "mdi:stove", color: "#ff0000" },
      { id: "c_y", label: "Y", url: "https://y.vn", group: "tien_ich", icon: "", color: "#0891b2" },
    ]);
    expect(c.overrides).toEqual({ home: { label: "Nhà tôi", icon: "mdi:home-heart", color: "#123456", group: "tien_ich" } });
  });
  it("du lieu rac -> cau hinh rong", () => {
    expect(sanitize(null)).toEqual({ hidden: [], order: {}, custom: [], overrides: {} });
    expect(sanitize("x")).toEqual({ hidden: [], order: {}, custom: [], overrides: {} });
  });
});
