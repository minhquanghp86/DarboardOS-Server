// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { Nav, photoUrl, sourceList, step } from "./photoSource.js";

const L = sourceList(["a.jpg", "b.jpg", "c.jpg"], ["https://lh3.googleusercontent.com/pw/G1"], "both");
describe("duyet anh khung anh so", () => {
  it("nguon: thu muc / google / ca hai", () => {
    expect(L.map((r) => r.k)).toEqual(["f", "f", "f", "g"]);
    expect(sourceList(["a.jpg"], ["g"], "folder").length).toBe(1);
    expect(sourceList(["a.jpg"], ["g"], "google")).toEqual([{ k: "g", id: "g" }]);
  });
  it("theo thu tu + vuot lui/tien trong lich su", () => {
    const nav: Nav = { hist: [], idx: -1 };
    expect(step(nav, L, 1, "name")!.id).toBe("a.jpg");
    expect(step(nav, L, 1, "name")!.id).toBe("b.jpg");
    expect(step(nav, L, 1, "name")!.id).toBe("c.jpg");
    expect(step(nav, L, -1, "name")!.id).toBe("b.jpg");
    expect(step(nav, L, -1, "name")!.id).toBe("a.jpg");
    expect(step(nav, L, -1, "name")!.id).toBe("a.jpg");          // dau lich su: dung yen
    expect(step(nav, L, 1, "name")!.id).toBe("b.jpg");           // tien lai trong lich su
    expect(step(nav, L, 1, "name")!.id).toBe("c.jpg");
    expect(step(nav, L, 1, "name")!.k).toBe("g");                 // het lich su: anh moi theo thu tu
    expect(step(nav, L, 1, "name")!.id).toBe("a.jpg");           // vong lai
  });
  it("ngau nhien khong lap lai gan day; danh sach rong", () => {
    const nav: Nav = { hist: [], idx: -1 };
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) seen.add(step(nav, L, 1, "random")!.id);
    expect(seen.size).toBe(4);
    expect(step({ hist: [], idx: -1 }, [], 1, "random")).toBeNull();
  });
  it("URL anh cho Chromium cua addon", () => {
    expect(photoUrl("http://127.0.0.1:18080", { k: "f", id: "he/a b.jpg" }, 1024, 600, "frame")).toBe("http://127.0.0.1:18080/photos/img?f=he%2Fa%20b.jpg&w=1024&h=600&fit=frame");
    expect(photoUrl("http://x", { k: "g", id: "https://lh3.googleusercontent.com/pw/G1" }, 480, 480, "cover")).toContain("/photos/gp?u=https%3A%2F%2Flh3");
  });
});
