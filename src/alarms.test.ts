import { describe, expect, it } from 'vitest';
import { AlarmStore, nextFire, normAlarm, type Ringing } from './alarms.js';
import { SoundPrefsStore, Sound, soundForNotice } from './sound.js';

const TZ = 420;  // GMT+7
// 2026-10-01 (thu Nam) 06:00 gio VN = 2026-09-30T23:00Z
const T0 = Date.UTC(2026, 8, 30, 23, 0);

function store() {
  const s = new AlarmStore(null);
  const log: string[] = [];
  s.hooks = {
    tz: () => TZ, screens: () => ['p4', 's3'],
    ring: (r: Ringing) => log.push('ring ' + r.id + ' ' + r.devices.join(',')),
    stop: (r: Ringing) => log.push('stop ' + r.id), missed: (r: Ringing) => log.push('missed ' + r.id), changed: () => { },
  };
  return { s, log };
}

describe('Bao thuc', () => {
  it('nextFire theo mui gio, lap theo thu va mot lan', () => {
    const daily = normAlarm({ time: '06:30', days: [0, 1, 2, 3, 4, 5, 6] });
    expect(nextFire(daily, T0, TZ)).toBe(T0 + 30 * 60_000);
    const weekend = normAlarm({ time: '06:30', days: [0, 6] });  // T7 = 03/10
    expect(nextFire(weekend, T0, TZ)).toBe(T0 + 2 * 86400_000 + 30 * 60_000);
    const once = normAlarm({ time: '05:00', days: [] });  // da qua hom nay -> mai
    expect(nextFire(once, T0, TZ)).toBe(T0 + 86400_000 - 3600_000);
    expect(nextFire({ ...daily, enabled: false }, T0, TZ)).toBeNull();
  });
  it('reo dung phut (mot lan), tu tat bao thuc mot lan; tat tren mot man = ngung ca nhom', () => {
    const { s, log } = store();
    const a = s.upsert({ time: '06:30', days: [], devices: 'all' });
    s.tick(T0 + 29 * 60_000);
    expect(log).toEqual([]);
    s.tick(T0 + 30 * 60_000 + 5_000); s.tick(T0 + 30 * 60_000 + 10_000);
    expect(log).toEqual([`ring ${a.id} p4,s3`]);
    expect(s.alarms[0].enabled).toBe(false);
    expect(s.ringingOn('s3')?.id).toBe(a.id);
    expect(s.stop(a.id)).toBe(true);
    expect(log[1]).toBe('stop ' + a.id);
    expect(s.ringingOn('p4')).toBeNull();
  });
  it('bao lai sau N phut; reo qua 5 phut khong tat -> lo', () => {
    const { s, log } = store();
    const a = s.upsert({ time: '06:00', days: [4], devices: ['p4'], snooze: 5 });  // thu Nam
    s.tick(T0 + 1000);
    expect(log[0]).toBe(`ring ${a.id} p4`);
    s.snooze(a.id, T0 + 2000);
    expect(s.next(T0 + 3000, TZ)?.at).toBe(T0 + 2000 + 5 * 60_000);
    s.tick(T0 + 2000 + 5 * 60_000);
    expect(log.filter((x) => x.startsWith('ring')).length).toBe(2);
    s.tick(T0 + 2000 + 11 * 60_000);
    expect(log.slice(-2)).toEqual(['stop ' + a.id, 'missed ' + a.id]);
  });
  it('hen gio reo dung man hinh, bao lai = tat', () => {
    const { s, log } = store();
    s.ringTimer('s3', 'Luoc trung');
    expect(log[0]).toBe('ring timer:s3 s3');
    s.snooze('timer:s3');
    expect(log[1]).toBe('stop timer:s3');
  });
  it('kiem tra du lieu', () => {
    expect(() => normAlarm({ time: '25:00' })).toThrow();
    expect(normAlarm({ time: '07:05', days: [1, 1, 9, 2], snooze: 7, devices: [] })).toMatchObject({ days: [1, 2], snooze: 10, devices: 'all' });
  });
});

describe('Am thanh', () => {
  it('am theo loai thong bao', () => {
    expect(soundForNotice({ priority: 'normal' })).toBeNull();
    expect(soundForNotice({ priority: 'high', app: 'chat' })).toBe(Sound.Notify);
    expect(soundForNotice({ priority: 'high' })).toBe(Sound.NotifyHigh);
    expect(soundForNotice({ priority: 'critical', app: 'chat' })).toBe(Sound.Critical);
  });
  it('am luong rieng tung man, bao thuc toi thieu 20%', () => {
    const p = new SoundPrefsStore(null);
    expect(p.get('x')).toEqual({ alert: 60, alarm: 80 });
    expect(p.set('x', { alarm: 5, alert: 130 })).toEqual({ alert: 100, alarm: 20 });
    expect(p.get('y').alert).toBe(60);
  });
});
