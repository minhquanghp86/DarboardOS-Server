import { describe, expect, it } from "vitest";
import { resolveLayout, sanitizeLayout } from "./homeLayout.js";

const apps = ["home", "cams", "youtube", "weather", "radio", "scenes", "timer", "calendar"];

describe("bo cuc man hinh chinh", () => {
  it("chua sap: dock mac dinh (HA + 4 hay dung), con lai theo thu tu Menu panel", () => {
    expect(resolveLayout(null, apps)).toEqual({ dock: ["home", "youtube"], items: ["cams", "weather", "radio", "scenes", "timer", "calendar"] });
    // (01/10/2026) dock mac dinh 6 ung dung: HA, Camera, YouTube, Tin nhan, NhacCuaTui, Google Maps (S3 khong co Camera)
    const all = ["home", "camera", "youtube", "chat", "nhaccuatui", "giaothong", "timer"];
    expect(resolveLayout(null, all).dock).toEqual(["home", "camera", "youtube", "chat", "nhaccuatui", "giaothong"]);
    expect(resolveLayout(null, all.filter((a) => a !== "camera")).dock).toEqual(["home", "youtube", "chat", "nhaccuatui", "giaothong"]);
    expect(resolveLayout(null, ["timer", "scenes"])).toEqual({ dock: [], items: ["timer", "scenes"] });
  });

  it("kiem tra du lieu: bo id xau, trung lap, dock qua 6, thu muc sai; ten thu muc mac dinh", () => {
    const l = sanitizeLayout({
      dock: ["home", "home", "a b", "cams", "youtube", "weather", "radio", "music", "timer"],
      items: ["scenes", { f: "f_1", n: "  <b>x</b>  ", a: ["timer", "scenes", 5] }, { f: "bad", a: ["calendar"] }, { f: "f_2", n: "", a: ["calendar"] }],
    });
    expect(l).toEqual({
      dock: ["home", "cams", "youtube", "weather", "radio", "music"],
      items: ["scenes", { f: "f_1", n: "bx/b", a: ["timer"] }, { f: "f_2", n: "Thư mục", a: ["calendar"] }],
    });
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout({ dock: [] })).toBeNull();
  });

  it("ap vao danh sach hien tai: bo ung dung da an, them ung dung moi vao cuoi, thu muc 1 ung dung -> ung dung thuong", () => {
    const saved = { dock: ["weather", "gone"], items: [{ f: "f_a", n: "Nhà", a: ["cams", "scenes"] }, { f: "f_b", n: "X", a: ["timer", "gone"] }, "youtube"] };
    expect(resolveLayout(saved, apps)).toEqual({
      dock: ["weather"],
      items: [{ f: "f_a", n: "Nhà", a: ["cams", "scenes"] }, "timer", "youtube", "home", "radio", "calendar"],
    });
  });
});
