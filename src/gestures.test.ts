// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { EdgeGestures, RECENTS_HOLD_MS } from "./gestures.js";
import { TouchKind } from "./protocol.js";

const H = 600;
const t = (kind: TouchKind, x: number, y: number) => ({ kind, x, y });
function run(g: EdgeGestures, seq: [TouchKind, number, number][]) {
  return seq.flatMap(([k, x, y]) => g.feed(t(k, x, y), x, y, H));
}

describe("cu chi mep man hinh (Shell)", () => {
  it("keo tu mep tren xuong -> dieu khien thanh trang thai, khong gui cho trang", () => {
    const a = run(new EdgeGestures(), [[TouchKind.Down, 300, 5], [TouchKind.Move, 300, 15], [TouchKind.Move, 300, 120], [TouchKind.Move, 300, 300], [TouchKind.Up, 300, 300]]);
    expect(a.every(x => x.type === "shade")).toBe(true);
    expect(a.map(x => x.type === "shade" && x.phase)).toEqual(["start", "move", "move", "end"]);
  });

  it("cham nhanh o mep tren -> van la cham cua trang (nut HA / nut dong ho)", () => {
    const a = run(new EdgeGestures(), [[TouchKind.Down, 512, 6], [TouchKind.Up, 512, 7]]);
    expect(a).toEqual([{ type: "pass", events: [t(TouchKind.Down, 512, 6), t(TouchKind.Up, 512, 7)] }]);
  });

  it("keo ngang o mep tren -> tra lai cho trang", () => {
    const a = run(new EdgeGestures(), [[TouchKind.Down, 100, 8], [TouchKind.Move, 140, 10], [TouchKind.Move, 180, 10], [TouchKind.Up, 180, 10]]);
    expect(a.map(x => x.type)).toEqual(["pass", "pass", "pass"]);
    expect(a[0]).toEqual({ type: "pass", events: [t(TouchKind.Down, 100, 8), t(TouchKind.Move, 140, 10)] });
  });

  it("vuot len tu mep duoi du xa -> Home; vuot ngan -> khong lam gi", () => {
    const a = run(new EdgeGestures(), [[TouchKind.Down, 500, 595], [TouchKind.Move, 500, 560], [TouchKind.Move, 500, 480], [TouchKind.Up, 500, 480]]);
    expect(a.filter(x => x.type !== "homeDrag")).toEqual([{ type: "home" }]);
    expect(a.filter(x => x.type === "homeDrag").map(x => x.type === "homeDrag" && x.phase)).toEqual(["start", "move", "end"]);
    const b = run(new EdgeGestures(), [[TouchKind.Down, 500, 595], [TouchKind.Move, 500, 570], [TouchKind.Up, 500, 562]]);
    expect(b.filter(x => x.type !== "homeDrag")).toEqual([]);
  });

  it("cham giua man hinh -> chuyen thang, khong tre", () => {
    const a = run(new EdgeGestures(), [[TouchKind.Down, 400, 300], [TouchKind.Move, 400, 310], [TouchKind.Up, 400, 310]]);
    expect(a.map(x => x.type === "pass" && x.events.length)).toEqual([1, 1, 1]);
  });
});

describe("cu chi Quay lai (mep trai/phai)", () => {
  const W = 1024;
  function runW(g: EdgeGestures, seq: [TouchKind, number, number][]) {
    return seq.flatMap(([k, x, y]) => g.feed(t(k, x, y), x, y, H, W));
  }
  it("keo tu mep trai vao du xa -> Quay lai", () => {
    // (08/10/2026) quang duong tinh toi lan DI CHUYEN cuoi (goi nhac tay cua firmware mang (0,0))
    const a = runW(new EdgeGestures(), [[TouchKind.Down, 4, 300], [TouchKind.Move, 40, 302], [TouchKind.Move, 120, 305], [TouchKind.Up, 0, 0]]);
    expect(a.map((x) => x.type)).toEqual(["back", "back", "back"]);
    expect(a[2]).toEqual({ type: "back", phase: "end", side: "left", d: 116, y: 305, commit: true });
  });
  it("keo tu mep phai vao chua du xa -> huy (commit=false), khong gui gi cho trang", () => {
    const a = runW(new EdgeGestures(), [[TouchKind.Down, 1020, 300], [TouchKind.Move, 990, 300], [TouchKind.Up, 970, 300]]);
    expect(a.every((x) => x.type === "back")).toBe(true);
    expect(a[a.length - 1]).toMatchObject({ phase: "end", side: "right", commit: false });
  });
  it("cham nhanh sat mep -> van la cham cua trang", () => {
    expect(runW(new EdgeGestures(), [[TouchKind.Down, 5, 300], [TouchKind.Up, 5, 300]]))
      .toEqual([{ type: "pass", events: [t(TouchKind.Down, 5, 300), t(TouchKind.Up, 5, 300)] }]);
  });
  it("keo DOC sat mep -> tra lai cho trang (cuon)", () => {
    const a = runW(new EdgeGestures(), [[TouchKind.Down, 6, 300], [TouchKind.Move, 8, 340], [TouchKind.Up, 8, 380]]);
    expect(a.every((x) => x.type === "pass")).toBe(true);
  });
  it("khong truyen chieu ngang (pageW=0) -> tat cu chi Quay lai nhu truoc", () => {
    const a = run(new EdgeGestures(), [[TouchKind.Down, 4, 300], [TouchKind.Move, 120, 300], [TouchKind.Up, 120, 300]]);
    expect(a.every((x) => x.type === "pass")).toBe(true);
  });
});

describe("vuot len tu mep duoi roi GIU -> Gan day", () => {
  const W = 1024;
  it("qua nguong + dung yen 350 ms -> Gan day; tha tay sau do khong ve Home", () => {
    const g = new EdgeGestures();
    g.feed(t(TouchKind.Down, 500, 596), 500, 596, H, W, 0);
    g.feed(t(TouchKind.Move, 500, 560), 500, 560, H, W, 20);
    g.feed(t(TouchKind.Move, 500, 480), 500, 480, H, W, 40);   // d = 116 >= 90
    expect(g.holdDeadline()).toBe(40 + RECENTS_HOLD_MS);
    expect(g.poll(200)).toEqual([]);                             // chua du lau
    g.feed(t(TouchKind.Move, 500, 484), 500, 484, H, W, 250);  // rung tay 4 px: van tinh la dung yen
    expect(g.poll(40 + RECENTS_HOLD_MS)).toEqual([{ type: "homeDrag", phase: "end", d: 112 }, { type: "recents" }]);
    expect(g.feed(t(TouchKind.Up, 500, 484), 500, 484, H, W, 500)).toEqual([]);
    expect(g.holdDeadline()).toBeNull();
  });
  it("van dang di chuyen -> hoan moc giu; tha nhanh -> Home nhu cu", () => {
    const g = new EdgeGestures();
    g.feed(t(TouchKind.Down, 500, 596), 500, 596, H, W, 0);
    g.feed(t(TouchKind.Move, 500, 480), 500, 480, H, W, 20);
    g.feed(t(TouchKind.Move, 500, 420), 500, 420, H, W, 300);  // di tiep 60 px -> moc giu bat dau lai
    expect(g.poll(20 + RECENTS_HOLD_MS)).toEqual([]);
    const up = g.feed(t(TouchKind.Up, 500, 400), 500, 400, H, W, 400);
    expect(up.filter(x => x.type !== "homeDrag")).toEqual([{ type: "home" }]);
  });
  it("chua qua nguong Gan day thi giu bao lau cung khong mo", () => {
    const g = new EdgeGestures();
    g.feed(t(TouchKind.Down, 500, 596), 500, 596, H, W, 0);
    g.feed(t(TouchKind.Move, 500, 540), 500, 540, H, W, 20);   // d = 56 < 90
    expect(g.holdDeadline()).toBeNull();
    expect(g.poll(5_000)).toEqual([]);
  });
});

import { tvSwipeKeys } from './gestures.js';
describe('YouTube TV: vuot -> phim mui ten', () => {
  it('cham / vuot ngan khong gui phim', () => { expect(tvSwipeKeys(10, -20)).toEqual([]); });
  it('huong tu nhien nhu dien thoai', () => {
    expect(tvSwipeKeys(0, -100)).toEqual(['ArrowDown']);
    expect(tvSwipeKeys(0, 130)).toEqual(['ArrowUp']);
    expect(tvSwipeKeys(-100, 10)).toEqual(['ArrowRight']);
    expect(tvSwipeKeys(90, -20)).toEqual(['ArrowLeft']);
  });
  it('vuot dai = nhieu buoc, toi da 6', () => {
    expect(tvSwipeKeys(-500, 0)).toHaveLength(4);
    expect(tvSwipeKeys(0, -2000)).toHaveLength(6);
  });
});

// (08/10/2026) Nguoi dung bao: P4 vuot mep trai, S3 (xoay 180°) vuot mep phai / tu duoi len khong tac dung. Chip GT911
// bao diem dau tien khi ngon tay da chay vao trong -> dai mep noi rong + dai mo rong nhan "lao vao tu ngoai vien".
import { FLICK_WINDOW_MS, edgeBands } from "./gestures.js";
describe("(08/10/2026) vuot tu vien vao: diem dau bao muon", () => {
  type Ev = [TouchKind, number, number, number];   // loai, x, y, thoi diem ms
  const feedAll = (g: EdgeGestures, W: number, Hh: number, seq: Ev[]) =>
    seq.flatMap(([k, x, y, ms]) => g.feed(t(k, x, y), x, y, Hh, W, 1000 + ms));
  it("dai mep: P4 26 px canh / 30 px duoi, S3 20 / 24 (cu 18-24 / 12-19)", () => {
    expect(edgeBands(1024, 600)).toMatchObject({ side: 46, bottom: 48, sideExt: 113, bottomExt: 84 });
    expect(edgeBands(480, 480)).toMatchObject({ side: 34, bottom: 38, sideExt: 80, bottomExt: 67 });
  });
  it("P4 mep trai: diem dau x=30 (ngoai dai cu 18) nhung dang lao vao -> Quay lai", () => {
    const g = new EdgeGestures();
    const a = feedAll(g, 1024, 600, [[TouchKind.Down, 50, 300, 0], [TouchKind.Move, 62, 301, 10], [TouchKind.Move, 90, 303, 22],
      [TouchKind.Move, 150, 305, 40], [TouchKind.Up, 150, 305, 50]]);
    expect(a.every((x) => x.type === "back")).toBe(true);
    expect(a[a.length - 1]).toMatchObject({ phase: "end", side: "left", commit: true });
    expect(g.takeReport()).toEqual({ edge: "left", band: "ext", x: 50, y: 300, first: { dt: 10, d: 12 }, result: "back" });
  });
  it("keo thanh truot gan mep (cham roi moi keo) -> chuyen cho trang sau toi da FLICK_WINDOW_MS, khong Quay lai", () => {
    const g = new EdgeGestures();
    const a = feedAll(g, 1024, 600, [[TouchKind.Down, 50, 300, 0], [TouchKind.Move, 52, 300, 15], [TouchKind.Move, 54, 301, 40]]);
    expect(a).toEqual([]);                                             // dang cho trong cua so
    expect(g.holdDeadline()).toBe(1000 + FLICK_WINDOW_MS);
    expect(g.poll(1000 + FLICK_WINDOW_MS)).toEqual([{ type: "pass", events: [t(TouchKind.Down, 50, 300)] }]);
    const b = feedAll(g, 1024, 600, [[TouchKind.Move, 120, 302, 100], [TouchKind.Up, 120, 302, 120]]);
    expect(b.every((x) => x.type === "pass")).toBe(true);
    expect(g.takeReport()).toMatchObject({ edge: "left", band: "ext", result: "trang" });
  });
  it("cham nhanh trong dai mo rong (nut sat mep) -> van la cham cua trang", () => {
    expect(feedAll(new EdgeGestures(), 1024, 600, [[TouchKind.Down, 40, 300, 0], [TouchKind.Up, 40, 300, 30]]))
      .toEqual([{ type: "pass", events: [t(TouchKind.Down, 40, 300), t(TouchKind.Up, 40, 300)] }]);
  });
  it("lao vao nhung CHEO / doc -> khong phai Quay lai", () => {
    const a = feedAll(new EdgeGestures(), 1024, 600, [[TouchKind.Down, 40, 300, 0], [TouchKind.Move, 52, 330, 10], [TouchKind.Up, 60, 380, 30]]);
    expect(a.every((x) => x.type === "pass")).toBe(true);
  });
  it("S3 480x480 xoay 180°: mep PHAI (toa do tho x=24 -> trang x=455) lao vao -> Quay lai", () => {
    const g = new EdgeGestures();
    const a = feedAll(g, 480, 480, [[TouchKind.Down, 455, 240, 0], [TouchKind.Move, 443, 241, 12], [TouchKind.Move, 400, 242, 25], [TouchKind.Move, 380, 242, 35], [TouchKind.Up, 479, 479, 40]]);
    expect(a[a.length - 1]).toMatchObject({ type: "back", phase: "end", side: "right", commit: true });
  });
  it("S3 mep DUOI: diem dau y=450 (ngoai dai cu 19) dang vuot len -> ve man hinh chinh", () => {
    const g = new EdgeGestures();
    const a = feedAll(g, 480, 480, [[TouchKind.Down, 240, 430, 0], [TouchKind.Move, 240, 418, 10], [TouchKind.Move, 240, 390, 20], [TouchKind.Move, 240, 340, 35], [TouchKind.Up, 479, 479, 40]]);
    expect(a.filter((x) => x.type !== "homeDrag")).toEqual([{ type: "home" }]);
    expect(g.takeReport()).toMatchObject({ edge: "bottom", band: "ext", result: "home" });
  });
  it("cuon trang tu gan mep duoi nhung bat dau CHAM (cham roi moi vuot) -> cuon trang, khong ve Home", () => {
    const g = new EdgeGestures();
    expect(feedAll(g, 480, 480, [[TouchKind.Down, 240, 425, 0], [TouchKind.Move, 240, 423, 20]])).toEqual([]);
    expect(g.poll(1000 + FLICK_WINDOW_MS).map((x) => x.type)).toEqual(["pass"]);
    expect(feedAll(g, 480, 480, [[TouchKind.Move, 240, 300, 120], [TouchKind.Up, 240, 250, 160]]).every((x) => x.type === "pass")).toBe(true);
  });
});
describe("(08/10/2026) goc duoi: dai mo rong canh + duoi chong nhau", () => {
  const go = (seq: [TouchKind, number, number, number][]) => { const g = new EdgeGestures();
    return { g, a: seq.flatMap(([k, x, y, ms]) => g.feed(t(k, x, y), x, y, 480, 480, 1000 + ms)) }; };
  it("S3 goc duoi trai (40,450) vuot LEN -> ve man hinh chinh (khong bi dai canh nuot)", () => {
    const { g, a } = go([[TouchKind.Down, 40, 420, 0], [TouchKind.Move, 41, 406, 10], [TouchKind.Move, 42, 380, 22], [TouchKind.Move, 42, 340, 35], [TouchKind.Up, 479, 479, 40]]);
    expect(a.filter((x) => x.type !== "homeDrag")).toEqual([{ type: "home" }]);
    expect(g.takeReport()).toMatchObject({ edge: "bottom", band: "ext", result: "home" });
  });
  it("cung goc do vuot NGANG vao trong -> Quay lai", () => {
    const { a } = go([[TouchKind.Down, 40, 420, 0], [TouchKind.Move, 54, 419, 10], [TouchKind.Move, 110, 417, 25], [TouchKind.Up, 120, 417, 40]]);
    expect(a[a.length - 1]).toMatchObject({ type: "back", phase: "end", side: "left", commit: true });
  });
});

// (08/10/2026) Log [cu chi] THAT: goi nhac tay cua firmware luon mang toa do tho (0,0).
describe("(08/10/2026) goi nhac tay (0,0) — dung vi tri di chuyen cuoi", () => {
  const feed = (g: EdgeGestures, W: number, Hh: number, seq: [TouchKind, number, number, number][]) =>
    seq.flatMap(([k, x, y, ms]) => g.feed(t(k, x, y), x, y, Hh, W, 1000 + ms));
  it("S3 xoay 180: mep phai (log 05:11:19 x=470) — nhac tay o (479,479) van Quay lai", () => {
    const a = feed(new EdgeGestures(), 480, 480, [[TouchKind.Down, 470, 228, 0], [TouchKind.Move, 450, 230, 30], [TouchKind.Move, 346, 232, 168],
      [TouchKind.Up, 479, 479, 200]]);
    expect(a[a.length - 1]).toMatchObject({ type: "back", phase: "end", side: "right", commit: true, d: 124 });
  });
  it("S3 xoay 180: tu duoi len (log 05:10:52 y=476) — nhac tay o (479,479) van ve man hinh chinh", () => {
    const g = new EdgeGestures();
    const a = feed(g, 480, 480, [[TouchKind.Down, 232, 476, 0], [TouchKind.Move, 232, 420, 40], [TouchKind.Move, 232, 286, 133], [TouchKind.Up, 479, 479, 150]]);
    expect(a.filter((x) => x.type !== "homeDrag")).toEqual([{ type: "home" }]);
    expect(g.takeReport()).toMatchObject({ edge: "bottom", result: "home" });
  });
  it("P4: mep trai — nhac tay o (0,0) van Quay lai (truoc day luon huy)", () => {
    const a = feed(new EdgeGestures(), 1024, 600, [[TouchKind.Down, 6, 300, 0], [TouchKind.Move, 60, 302, 20], [TouchKind.Move, 140, 305, 60], [TouchKind.Up, 0, 0, 80]]);
    expect(a[a.length - 1]).toMatchObject({ type: "back", side: "left", commit: true, d: 134 });
  });
  it("reset(): bo cu chi dang do", () => {
    const g = new EdgeGestures();
    feed(g, 480, 480, [[TouchKind.Down, 240, 476, 0], [TouchKind.Move, 240, 440, 20]]);
    g.reset();
    expect(feed(g, 480, 480, [[TouchKind.Down, 240, 240, 100]]).map((x) => x.type)).toEqual(["pass"]);
  });
});
