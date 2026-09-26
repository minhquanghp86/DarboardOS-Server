import { describe, expect, it } from "vitest";
import { PanelPrefsStore } from "./panelPrefs.js";

describe("cai dat addon theo tung man hinh", () => {
  it("mac dinh theo tuy chon addon, doi rieng tung man hinh, tu choi muc la", () => {
    const p = new PanelPrefsStore(null);
    expect(p.saverPhotos("a", true)).toBe(true);
    expect(p.set("a", "rwv.saver_photos", false)).toBe(true);
    expect(p.saverPhotos("a", true)).toBe(false);
    expect(p.saverPhotos("b", true)).toBe(true);
    expect(p.set("a", "rwv.khac", true)).toBe(false);
    expect(p.set("a", "rwv.saver_photos", "yes")).toBe(false);
    expect(p.items("a", true)[0]).toMatchObject({ id: "rwv.saver_photos", kind: "switch", on: false });
  });
});
