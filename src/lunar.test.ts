import { describe, expect, it } from "vitest";
import "../public/lunar.js";

// (07/10/2026) Lich van nien: public/lunar.js (IIFE gan globalThis.RwvLunar — dung chung launcher + calendar.html).
const L = (globalThis as unknown as { RwvLunar: Record<string, any> }).RwvLunar;
const jd = (d: number, m: number, y: number): number => L.jdFromDate(d, m, y);

describe("lunar.js — lich van nien", () => {
  it("am lich, doi am -> duong (Tet Binh Ngo 17/2/2026, Tet Dinh Mui 6/2/2027)", () => {
    expect(L.solar2lunar(7, 10, 2026, 7)).toMatchObject({ day: 27, month: 8, year: 2026, leap: 0 });
    expect(L.lunar2solar(1, 1, 2026, 0, 7)).toEqual({ day: 17, month: 2, year: 2026 });
    expect(L.lunar2solar(1, 1, 2027, 0, 7)).toEqual({ day: 6, month: 2, year: 2027 });
    expect(L.lunar2solar(15, 8, 2026, 0, 7)).toEqual({ day: 25, month: 9, year: 2026 });  // Trung thu 2026
    for (let j = jd(1, 1, 2025); j < jd(31, 12, 2027); j += 37) {  // hai chieu khop nhau
      const d = L.jdToDate(j), l = L.solar2lunar(d.day, d.month, d.year, 7);
      expect(L.lunar2solar(l.day, l.month, l.year, l.leap, 7)).toEqual(d);
    }
  });
  it("tiet khi: ngay bat dau mang ten moi (Dong chi 22/12/2026, Han lo 8/10/2026)", () => {
    expect(L.TIETKHI[L.solarTerm(jd(22, 12, 2026))]).toBe("Đông chí");
    expect(L.TIETKHI[L.solarTerm(jd(21, 12, 2026))]).toBe("Đại tuyết");
    expect(L.termStartsOn(jd(22, 12, 2026))).toBe(true);
    expect(L.TIETKHI[L.solarTerm(jd(10, 10, 2026))]).toBe("Hàn lộ");
    expect(L.TIETKHI[L.solarTerm(jd(5, 10, 2026))]).toBe("Thu phân");
  });
  it("gio hoang dao theo chi ngay", () => {
    let j = jd(1, 1, 2026); while ((j + 1) % 12 !== 0) j++;  // ngay Ty
    expect(L.gioHoangDao(j).map((g: { chi: string }) => g.chi)).toEqual(["Tý", "Sửu", "Mão", "Ngọ", "Thân", "Dậu"]);
    expect(L.gioHoangDao(j)[0]).toEqual({ chi: "Tý", from: 23, to: 1 });
    expect(L.gioHoangDao(j + 1).map((g: { chi: string }) => g.chi)).toEqual(["Dần", "Mão", "Tỵ", "Thân", "Tuất", "Hợi"]);  // Suu
  });
  it("than truc nhat: thang Gieng ngay Ty = Thanh Long (hoang dao), ngay Dan = Thien Hinh (hac dao)", () => {
    let j = jd(1, 1, 2026); while ((j + 1) % 12 !== 0) j++;
    expect(L.thanNgay(j, 1)).toEqual({ name: "Thanh Long", good: true });
    expect(L.thanNgay(j + 1, 1)).toEqual({ name: "Minh Đường", good: true });
    expect(L.thanNgay(j + 2, 1)).toEqual({ name: "Thiên Hình", good: false });
    expect(L.thanNgay(j + 2, 2)).toEqual({ name: "Thanh Long", good: true });  // thang 2: Thanh Long o ngay Dan
  });
  it("truc: ngay co chi trung chi thang tiet khi la Kien", () => {
    let j = jd(10, 2, 2026); while ((j + 1) % 12 !== 2) j++;  // ngay Dan sau Lap xuan 2026 (thang Dan)
    expect(L.TIETKHI[L.solarTerm(j)]).toMatch(/Lập xuân|Vũ thủy/);
    expect(L.truc(j)).toBe("Kiến");
    expect(L.truc(j + 1)).toBe("Trừ");
  });
  it("nap am + tuoi xung theo vong Giap Ty", () => {
    let j = jd(1, 1, 2026); while ((j + 49) % 60 !== 0) j++;
    expect(L.canChiDay(j)).toBe("Giáp Tý");
    expect(L.napAm(j)).toBe("Hải Trung Kim");
    expect(L.napAm(j + 1)).toBe("Hải Trung Kim");
    expect(L.napAm(j + 2)).toBe("Lư Trung Hỏa");
    expect(L.xung(j)).toBe("Ngọ");
  });
});
