// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { deviceConfigsEqual, makeConfigFromParams } from "./config.js";

describe("co half cua firmware", () => {
  const cfg = (q: string) => makeConfigFromParams(new URLSearchParams("w=480&h=480&" + q));
  it("half=1: nhan duoc khung nua (P4), khong ep cho moi video", () => {
    expect(cfg("half=1")).toMatchObject({ halfScale: true, halfVideo: false });
  });
  it("half=2: nhan duoc VA muon khung nua cho moi video (S3)", () => {
    expect(cfg("half=2")).toMatchObject({ halfScale: true, halfVideo: true });
  });
  it("khong co half: firmware cu", () => {
    expect(cfg("")).toMatchObject({ halfScale: false, halfVideo: false });
  });
  it("co dinh theo firmware: khong lam doi deviceConfigsEqual", () => {
    expect(deviceConfigsEqual(cfg("half=2"), cfg(""))).toBe(true);
  });
});
