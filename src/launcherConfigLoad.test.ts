import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// (09/10/2026) Loi that: `let cfg = load()` chay truoc khi ID_RE / ICON_RE duoc khai bao -> cau hinh da luu bi bo qua sau
// moi lan khoi dong lai. Thu: dat tep cau hinh roi NAP MOI module -> phai thay ngay cau hinh da luu.
describe("cau hinh Menu panel nap luc khoi dong + dia chi ung dung web", () => {
  it("nap tep da luu ngay khi khoi dong; Solar trong + sua duoc; ghi de dia chi duoc ap dung", async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rwv-")), "launcher.json");
    fs.writeFileSync(f, JSON.stringify({
      hidden: ["tiktok"], custom: [{ id: "c_x", label: "X", url: "https://x.example", group: "nha" }],
      overrides: { youtube: { url: "https://www.youtube.com/feed/subscriptions" }, solar: { url: "javascript:alert(1)" } },
    }));
    vi.stubEnv("LAUNCHER_CONFIG_FILE", f);
    vi.resetModules();
    const cfgMod = await import("./launcherConfig.js");
    const c = cfgMod.getLauncherConfig();
    expect(c.hidden).toEqual(["tiktok"]);
    expect(c.custom.map((a) => a.id)).toEqual(["c_x"]);
    expect(c.overrides.youtube).toEqual({ url: "https://www.youtube.com/feed/subscriptions" });
    expect(c.overrides.solar).toBeUndefined();                       // chi http(s)
    const { listAllApps } = await import("./launcherApps.js");
    const apps = listAllApps("http://ha.local:8123/lovelace/0");
    const solar = apps.find((a) => a.id === "solar")!;
    expect(solar.urlEditable).toBe(true);
    expect(solar.setUrl).toBe("");
    expect(solar.url).toMatch(/\/no-url\.html\?app=Solar$/);           // chua dien -> trang huong dan
    expect(apps.find((a) => a.id === "youtube")!.url).toBe("https://www.youtube.com/feed/subscriptions");
    expect(apps.find((a) => a.id === "home")!.urlEditable).toBeUndefined();     // HA: o rieng
    expect(apps.find((a) => a.id === "settings")!.urlEditable).toBeUndefined(); // trang he thong
    vi.unstubAllEnvs();
  });
});
