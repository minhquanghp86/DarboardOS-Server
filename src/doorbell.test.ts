import { describe, expect, it } from 'vitest';
import { parseDoorbell } from './doorbell.js';

describe('parseDoorbell', () => {
  it('body toi thieu: camera hop le, mode mac dinh mse', () => {
    const r = parseDoorbell({ camera: 'cong_truoc' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bell.camera).toBe('cong_truoc');
    expect(r.bell.mode).toBe('mse');
    expect(r.bell.device).toBe('all');
  });

  it('mode=mjpeg cho camera ESPHome MJPEG', () => {
    const r = parseDoorbell({ camera: 'cong', mode: 'mjpeg' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bell.mode).toBe('mjpeg');
  });

  it('mode khong phan biet hoa thuong', () => {
    const r = parseDoorbell({ camera: 'cong', mode: 'MJPEG' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bell.mode).toBe('mjpeg');
  });

  it('mode la thi tu choi', () => {
    const r = parseDoorbell({ camera: 'cong', mode: 'webrtc' });
    expect(r.ok).toBe(false);
  });

  it('camera phai la ten luong go2rtc, khong phai URL', () => {
    expect(parseDoorbell({ camera: 'http://192.168.1.10/stream' }).ok).toBe(false);
    expect(parseDoorbell({}).ok).toBe(false);
  });

  it('unlock chi nhan script/button/lock', () => {
    expect(parseDoorbell({ camera: 'cong', unlock: 'script.mo_cong' }).ok).toBe(true);
    expect(parseDoorbell({ camera: 'cong', unlock: 'light.phong' }).ok).toBe(false);
  });
});
