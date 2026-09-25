import { describe, expect, it } from "vitest";
import { sanitizeTuning } from "./tuning.js";

describe("tinh chỉnh lúc chạy (25/09/2026)", () => {
  it("chỉ nhận khoá đã biết, đúng kiểu, trong khoảng", () => {
    expect(sanitizeTuning({ adaptive: false, fixedIntervalMs: 50, maxBacklogBytes: 200000, lạ: 1 }))
      .toEqual({ adaptive: false, fixedIntervalMs: 50, maxBacklogBytes: 200000 });
    expect(sanitizeTuning({ adaptive: "no", fixedIntervalMs: 1, decodeBudgetRatio: 9 })).toEqual({});
    expect(sanitizeTuning(null)).toEqual({});
  });
});
