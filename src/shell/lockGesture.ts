// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (07/10/2026) Cu chi tren man hinh khoa / man hinh cho — ham thuan (src/shell/lockGesture.test.ts).
// Vuot LEN de mo khoa: bat dau o 65% duoi man hinh, di len >= 22% chieu cao (toi thieu 70 px), gan thang dung, trong
// 2,5 s — cham / quet nham / ngon tay ty len man hinh khong mo duoc. Vuot ngang (khi co anh) = anh sau / truoc.
export type LockGesture = 'unlock' | 'next' | 'prev' | 'tap' | 'none';

export interface GestureInput {
  sx: number; sy: number; ex: number; ey: number; ms: number; w: number; h: number; photo: boolean;
}

export function classifyLockGesture(g: GestureInput): LockGesture {
  const dx = g.ex - g.sx, dy = g.ey - g.sy, adx = Math.abs(dx), ady = Math.abs(dy);
  if (dy < 0 && ady >= Math.max(70, g.h * 0.22) && adx <= ady * 0.7 && g.sy >= g.h * 0.35 && g.ms <= 2500) return 'unlock';
  if (g.photo && adx > 60 && adx > ady * 1.3) return dx < 0 ? 'next' : 'prev';
  if (adx < 12 && ady < 12) return 'tap';
  return 'none';
}
