// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from 'vitest';
import { cleanName, cleanSdPath } from './fileManager.js';

describe('Quan ly file: duong dan + ten tep', () => {
  it('chi nhan duong tuyet doi trong the, khong ..', () => {
    expect(cleanSdPath('/')).toBe('/');
    expect(cleanSdPath('/DCIM/')).toBe('/DCIM');
    expect(cleanSdPath('/Phim/Gia đình 2026.mp4')).toBe('/Phim/Gia đình 2026.mp4');
    expect(cleanSdPath('DCIM')).toBeNull();
    expect(cleanSdPath('/a/../b')).toBeNull();
    expect(cleanSdPath('/a//b')).toBeNull();
    expect(cleanSdPath('/a/./b')).toBeNull();
    expect(cleanSdPath('/a\\b')).toBeNull();
    expect(cleanSdPath('/c:x')).toBeNull();
    expect(cleanSdPath('/x\u0001')).toBeNull();
    expect(cleanSdPath('/' + 'a'.repeat(300))).toBeNull();
    expect(cleanSdPath(42)).toBeNull();
  });
  it('ten tep: bo ky tu FAT32 cam, dau cham/khoang trang dau cuoi', () => {
    expect(cleanName('Video: "Tết" *2026*?.mp4')).toBe('Video_ _Tết_ _2026__.mp4');
    expect(cleanName('a/b')).toBe('a_b');
    expect(cleanName('  .an.mp4. ')).toBe('an.mp4');
    expect(cleanName('...')).toBeNull();
    expect(cleanName('')).toBeNull();
    expect(cleanName('x'.repeat(200))!.length).toBe(120);
  });
});
