import { describe, expect, it } from "vitest";
import { EdgeGestures } from "./gestures.js";
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
    expect(run(new EdgeGestures(), [[TouchKind.Down, 500, 595], [TouchKind.Move, 500, 560], [TouchKind.Move, 500, 480], [TouchKind.Up, 500, 480]]))
      .toEqual([{ type: "home" }]);
    expect(run(new EdgeGestures(), [[TouchKind.Down, 500, 595], [TouchKind.Move, 500, 570], [TouchKind.Up, 500, 562]])).toEqual([]);
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
    const a = runW(new EdgeGestures(), [[TouchKind.Down, 4, 300], [TouchKind.Move, 40, 302], [TouchKind.Move, 120, 305], [TouchKind.Up, 130, 305]]);
    expect(a.map((x) => x.type)).toEqual(["back", "back", "back"]);
    expect(a[2]).toEqual({ type: "back", phase: "end", side: "left", d: 126, y: 305, commit: true });
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
