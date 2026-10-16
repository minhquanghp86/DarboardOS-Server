// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { briefingText, deviceClock, eventTime, greeting, parseWindow, shouldGreet, wxText } from "./today.js";
import { BoardStore, parseNote } from "./board.js";

describe("Hom nay / chao buoi sang", () => {
  it("loi chao, thoi tiet, khung gio", () => {
    expect(greeting(7)).toBe("Chào buổi sáng"); expect(greeting(20)).toBe("Chào buổi tối"); expect(greeting(1)).toBe("Chúc ngủ ngon");
    expect(wxText(61)).toBe("có mưa"); expect(wxText(95)).toBe("có dông");
    expect(parseWindow("06:00-09:30")).toEqual([360, 570]);
    expect(parseWindow("9:30-06:00")).toBeNull(); expect(parseWindow("x")).toBeNull();
  });
  it("chao moi ngay mot lan, trong khung gio, theo gio thiet bi", () => {
    const c = deviceClock(Date.UTC(2026, 8, 27, 0, 15), 420);   // 07:15 gio VN
    expect(c).toEqual({ minute: 435, date: "2026-09-27" });
    const w = parseWindow("06:00-09:30");
    expect(shouldGreet({ ...c, window: w, lastDate: null })).toBe(true);
    expect(shouldGreet({ ...c, window: w, lastDate: "2026-09-27" })).toBe(false);
    expect(shouldGreet({ minute: 600, date: "2026-09-27", window: w, lastDate: null })).toBe(false);
    expect(shouldGreet({ ...c, window: null, lastDate: null })).toBe(false);
  });
  it("cau doc tom tat", () => {
    expect(eventTime({ title: "Họp", start: "2026-09-27T14:30:00+07:00", allDay: false })).toBe("14:30");
    const s = briefingText({ greet: "Chào buổi sáng", wx: { t: 31.4, code: 61, pp: 70, name: "Hà Nội" },
      events: [{ title: "Họp phụ huynh", start: "2026-09-27T14:30:00+07:00", allDay: false }, { title: "Sinh nhật bà", start: "2026-09-27", allDay: true }],
      todos: ["Sữa", "Gạo"], notes: ["Con nhớ mang áo mưa"] });
    expect(s).toBe("Chào buổi sáng. Hôm nay ở Hà Nội có mưa, 31 độ, khả năng mưa 70 phần trăm, nhớ mang áo mưa. " +
      "Lịch hôm nay: Họp phụ huynh lúc 14 giờ 30; Sinh nhật bà. Có 2 việc cần làm, gồm Sữa, Gạo. Ghi chú: Con nhớ mang áo mưa.");
    expect(briefingText({ greet: "Chào buổi sáng", wx: null, events: [], todos: [], notes: [] })).toBe("Chào buổi sáng.");
  });
});

describe("Bang tin gia dinh", () => {
  it("kiem tra ghi chu, gioi han, ghim khong bi day ra", () => {
    expect(parseNote({ text: "  " })).toMatchObject({ ok: false });
    expect(parseNote({ text: "Mua sữa", color: "evil", by: "Mẹ" })).toEqual({ ok: true, note: { text: "Mua sữa", by: "Mẹ", color: "yellow", pin: false } });
    const b = new BoardStore(null);
    const pinned = b.add({ text: "ghim", by: "", color: "blue", pin: true }, 1);
    for (let i = 0; i < 35; i++) b.add({ text: "n" + i, by: "", color: "yellow" }, 10 + i);
    const l = b.list();
    expect(l.length).toBe(30);
    expect(l[0].id).toBe(pinned.id);
    expect(l[1].text).toBe("n34");
    expect(l.some((n) => n.text === "n0")).toBe(false);
    expect(b.remove(pinned.id)).toBe(true);
    expect(b.remove(9999)).toBe(false);
  });
});
