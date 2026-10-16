import { describe, expect, it } from "vitest";
import { dropPath, sbKey } from "./statusIcons.js";

describe("(08/10/2026) bieu tuong canh dong ho", () => {
  it("khoa ve lai: chi doi khi vach / kieu mang / % pin doi", () => {
    expect(sbKey(null)).toBe("");
    expect(sbKey({ nw: { k: "wifi", q: 2 }, bt: 57 })).toBe("w2|57");
    expect(sbKey({ nw: { k: "eth" }, bt: null })).toBe("e|");
    expect(sbKey({ nw: null, bt: 5 })).toBe("|5");
    expect(sbKey({ nw: { k: "eth" }, bt: null, ch: "none" })).toBe("e||none");
    expect(sbKey({ nw: null, bt: 80, ch: "chg" })).toBe("|80|chg");
  });
  it("giot nuoc rong them giua, giu duong cong (0 = hinh cu)", () => {
    expect(dropPath(0)).toEqual({ w: 104, d: "M0 0H104C91 0 86 4 79 11C72 18 64 22 52 22H52C40 22 32 18 25 11C18 4 13 0 0 0Z" });
    const g = dropPath(50);
    expect(g.w).toBe(154);
    expect(g.d.startsWith("M0 0H154C141 0 136 4 129 11C122 18 114 22 102 22H52C40 22")).toBe(true);
  });
});
