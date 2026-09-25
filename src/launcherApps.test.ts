import { afterEach, describe, expect, it } from "vitest";
import { buildLauncherApps } from "./launcherApps.js";

describe("buildLauncherApps (25/09/2026: menu chia nhom + tu them/an)", () => {
  afterEach(() => { delete process.env.LAUNCHER_APPS_JSON; delete process.env.LAUNCHER_HIDE_JSON; });

  it("du 3 nhom, ung dung HA chi khi co homeUrl", () => {
    const withHome = buildLauncherApps("http://192.168.1.2:8123/dashboard-mobile/3");
    expect(new Set(withHome.map(a => a.group))).toEqual(new Set(["nha", "giai_tri", "tien_ich"]));
    expect(withHome.find(a => a.kind === "energy")?.url).toBe("http://192.168.1.2:8123/energy");
    const noHome = buildLauncherApps(undefined);
    expect(noHome.some(a => a.kind === "home" || a.kind === "energy" || a.kind === "media")).toBe(false);
  });

  it("them ung dung hop le, bo URL khong phai http(s), an theo ten", () => {
    process.env.LAUNCHER_APPS_JSON = JSON.stringify([
      { label: "Bếp", url: "http://ha.local/bep", group: "nha", icon: "home" },
      { label: "Xấu", url: "javascript:alert(1)" },
      { label: "Lạ", url: "https://x.vn", icon: "khong-co", color: "red" },
    ]);
    process.env.LAUNCHER_HIDE_JSON = JSON.stringify(["tiktok", " Tin tức "]);
    const apps = buildLauncherApps(undefined);
    expect(apps.find(a => a.label === "Bếp")).toMatchObject({ group: "nha", kind: "home" });
    expect(apps.some(a => a.label === "Xấu")).toBe(false);
    expect(apps.find(a => a.label === "Lạ")).toMatchObject({ group: "tien_ich", kind: "generic", color: "#0891b2" });
    expect(apps.some(a => a.label === "TikTok" || a.label === "Tin tức")).toBe(false);
  });
});
