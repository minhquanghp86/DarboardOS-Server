// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { buildLauncherApps } from "./launcherApps.js";

describe("buildLauncherApps (25/09/2026: menu chia nhom)", () => {
  it("du 3 nhom, ung dung HA chi khi co homeUrl", () => {
    const withHome = buildLauncherApps("http://192.168.1.2:8123/dashboard-mobile/3");
    expect(new Set(withHome.map(a => a.group))).toEqual(new Set(["nha", "giai_tri", "tien_ich"]));
    // (14/10/2026) Media = ung dung rieng (public/media.html), van chi khi co Home Assistant.
    expect(withHome.find(a => a.kind === "media")?.url).toMatch(/\/media\.html$/);
    // (27/09/2026) Bo "Nang luong", thay bang Solar (trang rieng cua nguoi dung)
    expect(withHome.some(a => a.kind === "energy")).toBe(false);
    // (09/10/2026) "Solar" la ung dung chung, dia chi mac dinh trong (nguoi dung dien trong Menu panel).
    expect(withHome.find(a => a.id === "solar")?.url).toMatch(/no-url\.html/);
    const noHome = buildLauncherApps(undefined);
    expect(noHome.some(a => a.id === "home" || a.kind === "media")).toBe(false);
  });

});
