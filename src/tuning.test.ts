// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { sanitizeTuning } from "./tuning.js";

describe("tinh chỉnh lúc chạy (25/09/2026)", () => {
  it("chỉ nhận khoá đã biết, đúng kiểu, trong khoảng", () => {
    expect(sanitizeTuning({ adaptive: false, fixedIntervalMs: 50, maxBacklogBytes: 200000, lạ: 1 }))
      .toEqual({ adaptive: false, fixedIntervalMs: 50, maxBacklogBytes: 200000 });
    expect(sanitizeTuning({ adaptive: "no", fixedIntervalMs: 1, decodeBudgetRatio: 9 })).toEqual({});
    expect(sanitizeTuning(null)).toEqual({});
  });
  it("iptvHalf chi nhan boolean (07/10/2026)", () => {
    expect(sanitizeTuning({ iptvHalf: false })).toEqual({ iptvHalf: false });
    expect(sanitizeTuning({ iptvHalf: "false" })).toEqual({});
  });
  it("passthroughFit chi nhan boolean", () => {
    expect(sanitizeTuning({ passthroughFit: false })).toEqual({ passthroughFit: false });
    expect(sanitizeTuning({ passthroughFit: 0 })).toEqual({});
  });
});
