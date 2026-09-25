import { describe, expect, it } from "vitest";
import { buildLauncherApps } from "./launcherApps.js";

describe("buildLauncherApps (25/09/2026: menu chia nhom)", () => {
  it("du 3 nhom, ung dung HA chi khi co homeUrl", () => {
    const withHome = buildLauncherApps("http://192.168.10.2:8123/dashboard-mobile/3");
    expect(new Set(withHome.map(a => a.group))).toEqual(new Set(["nha", "giai_tri", "tien_ich"]));
    expect(withHome.find(a => a.kind === "energy")?.url).toBe("http://192.168.10.2:8123/energy");
    const noHome = buildLauncherApps(undefined);
    expect(noHome.some(a => a.kind === "home" || a.kind === "energy" || a.kind === "media")).toBe(false);
  });

});
