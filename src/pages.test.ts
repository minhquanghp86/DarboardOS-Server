// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// (16/10/2026) Goc ingress "/" khong phai trang (tra "ok" 2 byte) -> link href="./" lam trinh duyet TAI VE tep "Tai xuong".
describe('trang public: lien ket quay ve trang chu', () => {
  const dir = path.join(process.cwd(), 'public');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    it(`${f} khong dung href "./"`, () => {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(t).not.toMatch(/href\s*=\s*["']\.\/["']/);
      expect(t).not.toMatch(/\.href\s*=\s*["']\.\/["']/);
    });
  }
});
