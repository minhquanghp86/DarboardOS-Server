// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { esc, tgText } from './telegram.js';

describe('telegram: noi dung tin', () => {
  it('thoat ky tu HTML trong ten', () => {
    expect(esc('<Cổng & sân>')).toBe('&lt;Cổng &amp; sân&gt;');
    expect(tgText('missed', { door: '<b>x</b>', ringS: 45 })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('du cac loai su kien, co thoi gian', () => {
    const ts = Date.UTC(2026, 9, 16, 7, 5, 12);
    expect(tgText('ring', { door: 'Cổng', ts })).toMatch(/^🔔 <b>Có người bấm chuông<\/b> — Cổng\n🕒 \d\d:\d\d:\d\d · /);
    expect(tgText('missed', { door: 'Cổng', ringS: 45, ts })).toContain('Không ai nghe trong 45 giây.');
    expect(tgText('declined', { door: 'Cổng', ts })).toContain('bị từ chối');
    expect(tgText('call', { from: 'P4', to: 'Trình duyệt', ts })).toContain('Từ: P4\nĐến: Trình duyệt');
    expect(tgText('call', { ts })).toContain('2026');
  });
});
