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
