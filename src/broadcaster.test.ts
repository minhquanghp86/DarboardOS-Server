// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { trackStall } from "./broadcaster.js";

describe("trackStall", () => {
  it("socket thong: byte roi server tang -> khong ket", () => {
    let r = trackStall(undefined, 1000, 500, 0, 30_000);
    r = trackStall(r.track, 2000, 900, 20_000, 30_000);
    r = trackStall(r.track, 3000, 1000, 40_000, 30_000);
    expect(r.stalled).toBe(false);
  });

  it("con ton dong ma 0 byte roi server trong 30 s -> ket", () => {
    let r = trackStall(undefined, 1000, 500, 0, 30_000);
    r = trackStall(r.track, 5000, 4500, 10_000, 30_000); // drained van 500
    expect(r.stalled).toBe(false);
    r = trackStall(r.track, 9000, 8500, 30_000, 30_000);
    expect(r.stalled).toBe(true);
  });

  it("ton dong ve 0 -> dat lai, khong ket", () => {
    let r = trackStall(undefined, 1000, 500, 0, 30_000);
    r = trackStall(r.track, 1000, 0, 20_000, 30_000);
    r = trackStall(r.track, 1000, 0, 60_000, 30_000);
    expect(r.stalled).toBe(false);
  });

  it("chi nhich them chut van la tien trien", () => {
    let r = trackStall(undefined, 1000, 500, 0, 30_000);
    for (let t = 10_000, sent = 2000, back = 1400; t <= 90_000; t += 10_000, sent += 1000, back += 900) {
      r = trackStall(r.track, sent, back, t, 30_000);
      expect(r.stalled).toBe(false);
    }
  });
});
