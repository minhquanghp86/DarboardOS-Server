// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { needsServerRotate } from "./util.js";

describe("needsServerRotate", () => {
  it("huong 0: khong xoay", () => {
    expect(needsServerRotate(0, false)).toBe(false);
    expect(needsServerRotate(0, true)).toBe(false);
  });
  it("huong 180: server luon xoay (firmware ve nguyen khung)", () => {
    expect(needsServerRotate(180, false)).toBe(true);
    expect(needsServerRotate(180, true)).toBe(true);
  });
  it("90/270: firmware cu (khong drot) thi server xoay, firmware moi (?drot=1) thi khong", () => {
    for (const r of [90, 270] as const) {
      expect(needsServerRotate(r, false)).toBe(true);
      expect(needsServerRotate(r, true)).toBe(false);
    }
  });
});
