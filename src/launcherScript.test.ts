import { describe, expect, it } from "vitest";
import { buildLauncherScript } from "./deviceManager.js";

describe("launcher script (chuoi JS tiem vao moi trang)", () => {
  it("cu phap hop le (co va khong co homeUrl), co am lich + nhom ung dung", () => {
    for (const home of ["http://192.168.10.2:8123/dashboard-mobile/3", undefined]) {
      const src = buildLauncherScript(home);
      expect(() => new Function(src)).not.toThrow();
      expect(src).toContain("RwvLunar");
      expect(src).toContain('"giai_tri"');
    }
  });
});
