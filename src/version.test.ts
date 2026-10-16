// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import fs from "node:fs";
import { expect, it } from "vitest";

// (27/09/2026) Phien ban hien o trang Cai dat (Chan doan) doc tu package.json — phai khop phien ban addon.
it("package.json / package-lock.json khop phien ban addon (config.yaml)", () => {
  const addon = /^version:\s*"([^"]+)"/m.exec(fs.readFileSync("hassio/remote_webview_server/config.yaml", "utf8"))?.[1];
  expect(JSON.parse(fs.readFileSync("package.json", "utf8")).version).toBe(addon);
  expect(JSON.parse(fs.readFileSync("package-lock.json", "utf8")).version).toBe(addon);
});
