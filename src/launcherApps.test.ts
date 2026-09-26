import { describe, expect, it } from "vitest";
import { buildLauncherApps } from "./launcherApps.js";

describe("buildLauncherApps (25/09/2026: menu chia nhom)", () => {
  it("du 3 nhom, ung dung HA chi khi co homeUrl", () => {
    const withHome = buildLauncherApps("http://192.168.1.2:8123/dashboard-mobile/3");
    expect(new Set(withHome.map(a => a.group))).toEqual(new Set(["nha", "giai_tri", "tien_ich"]));
    expect(withHome.find(a => a.kind === "media")?.url).toBe("http://192.168.1.2:8123/media-browser/browser");
    // (27/09/2026) Bo "Nang luong", thay bang Solar (trang rieng cua nguoi dung)
    expect(withHome.some(a => a.kind === "energy")).toBe(false);
    expect(withHome.find(a => a.id === "solar")?.url).toBe("http://solar.example.com");
    const noHome = buildLauncherApps(undefined);
    expect(noHome.some(a => a.id === "home" || a.kind === "media")).toBe(false);
  });

});
