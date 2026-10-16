// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from 'vitest';
import { camHostOf, noteCameraHost } from './camProxy.js';
import { sdRef } from './iptv.js';

describe('(09/10/2026) nha nhieu man co the nho', () => {
  it('sdRef: sd:/ = man dau, sd@<man>:/ = man do; duong dan hong -> null', () => {
    expect(sdRef('sd:/iptv/a.m3u')).toEqual({ p: '/iptv/a.m3u' });
    expect(sdRef('sd@esp32-0a0b0c0d0003:/iptv/a.m3u')).toEqual({ p: '/iptv/a.m3u', dev: 'esp32-0a0b0c0d0003' });
    expect(sdRef('sd@bad id:/a.m3u')).toBeNull();
    expect(sdRef('sd:/')).toBeNull();
    expect(sdRef('https://x/a.m3u')).toBeNull();
  });
  it('camHostOf: strict khong thay man tat bang man khac', () => {
    noteCameraHost('esp32-cccccccccccc', '192.168.1.13', 8080);
    expect(camHostOf('esp32-cccccccccccc').h?.ip).toBe('192.168.1.13');
    expect(camHostOf('esp32-dddddddddddd', true)).toEqual({ id: 'esp32-dddddddddddd' });
    expect(camHostOf('esp32-dddddddddddd').h).toBeDefined();   // khong strict -> man dau
  });
});

describe('(09/10/2026) man chi co the nho (S3 sd_files)', () => {
  it('man co camera van la mac dinh khi man chi co the noi truoc', async () => {
    const { cameraDeviceId, noteCameraHost: note } = await import('./camProxy.js');
    note('esp32-111111111111', '192.168.1.21', 8082, null, true);
    const before = cameraDeviceId();
    expect(before).not.toBe('esp32-111111111111');   // da co man camera (test tren) -> khong bi cuop
    note('esp32-111111111111', '192.168.1.21', 0);
  });
  it('S3 co Thu vien + Quan ly file, KHONG co Camera', async () => {
    const { buildLauncherApps } = await import('./launcherApps.js');
    const ids = buildLauncherApps(undefined, false, true).map((a) => a.id);
    expect(ids).toContain('gallery');
    expect(ids).toContain('files');
    expect(ids).not.toContain('camera');
    const none = buildLauncherApps(undefined, false, false).map((a) => a.id);
    expect(none).not.toContain('files');
  });
});
