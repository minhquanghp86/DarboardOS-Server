// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AlarmStore, alarmsOn, handleAlarmApi, nextFire, normAlarm, type Ringing } from './alarms.js';
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

// (26/11/2026) LOI: tao bao thuc tren man 480x272 (JC4827w543) roi mo trang Bao thuc cua man P4
// (alarm.html?dev=esp32-80f1b2d35fb5) thi thay CA bao thuc cua 480x272 — GET /alarm/list tra toan bo
// store.alarms ma khong loc theo ?dev= (chi `next` duoc loc). Test nay chay HTTP THAT qua handleAlarmApi
// va khoa: ?dev=A -> chi A + 'all'; khong thay cua B; khong co ?dev= (hoac rong) -> tat ca; 'all' o moi man.
describe('Bao thuc theo man hinh — GET /alarm/list', () => {
  const P4 = 'esp32-80f1b2d35fb5';    // man P4
  const JC = 'esp32-jc4827w543';      // man 480x272
  const SCREENS = [{ id: P4, name: 'P4', spk: true }, { id: JC, name: 'JC4827w543', spk: false }];

  async function serve(s: AlarmStore) {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!handleAlarmApi(req, res, url, () => SCREENS, s)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    return {
      get: async (p: string) => {
        const r = await fetch(`http://127.0.0.1:${port}${p}`, { cache: 'no-store' });
        expect(r.status).toBe(200);
        return JSON.parse(await r.text()) as {
          alarms: { id: string; time: string; devices: 'all' | string[]; next: number | null; snoozed: boolean }[];
          next: { id: string; time: string } | null; screens: { id: string }[]; now: number; tz: number;
        };
      },
      close: () => new Promise<void>((ok) => server.close(() => ok())),
    };
  }

  function seed() {
    const { s } = store();
    const a = s.upsert({ time: '06:30', days: [1, 2, 3, 4, 5], label: 'Dậy đi học', devices: [P4] });
    const all = s.upsert({ time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], label: 'Cả nhà', devices: 'all' });
    const b = s.upsert({ time: '05:00', days: [0, 1, 2, 3, 4, 5, 6], label: 'Màn 480×272', devices: [JC] });
    return { s, a, all, b };
  }

  it('?dev=A: chi thay bao thuc cua A + bao thuc "all", khong thay cua B', async () => {
    const { s, a, all, b } = seed();
    const api = await serve(s);
    try {
      const r = await api.get(`/alarm/list?dev=${encodeURIComponent(P4)}`);
      const ids = r.alarms.map((x) => x.id);
      expect(ids.sort()).toEqual([a.id, all.id].sort());
      expect(ids).not.toContain(b.id);
      expect(r.alarms.find((x) => x.id === all.id)?.devices).toBe('all');
      // `next` van loc theo man: bao thuc cua man 480x272 KHONG bao gio duoc tra ve cho P4.
      expect([a.id, all.id]).toContain(r.next?.id);
      expect(r.next?.id).not.toBe(b.id);
      // Giu nguyen `screens`, `now`, `tz` va `next`/`snoozed` tung bao thuc.
      expect(r.screens.map((x) => x.id)).toEqual([P4, JC]);
      expect(r.tz).toBe(TZ);
      expect(typeof r.now).toBe('number');
      expect(r.alarms.every((x) => 'next' in x && typeof x.snoozed === 'boolean')).toBe(true);
    } finally { await api.close(); }
  });

  it('?dev=B: chi thay bao thuc cua B + "all", khong thay cua A', async () => {
    const { s, a, all, b } = seed();
    const api = await serve(s);
    try {
      const r = await api.get(`/alarm/list?dev=${encodeURIComponent(JC)}`);
      const ids = r.alarms.map((x) => x.id);
      expect(ids.sort()).toEqual([all.id, b.id].sort());
      expect(ids).not.toContain(a.id);
      expect(ids).toContain(r.next?.id);   // `next` chi trong so bao thuc cua man nay + 'all'
    } finally { await api.close(); }
  });

  it('khong co ?dev= (trang quan ly tong) va ?dev= rong (alarm.html DEV rong) -> thay TAT CA', async () => {
    const { s, a, all, b } = seed();
    const api = await serve(s);
    try {
      for (const p of ['/alarm/list', '/alarm/list?dev=', '/alarm/list?dev=%20']) {
        const r = await api.get(p);
        const ids = r.alarms.map((x) => x.id).sort();
        expect(ids, p).toEqual([a.id, all.id, b.id].sort());
        expect(ids, p).toContain(r.next?.id);   // `next` som nhat toan cuc, van trong danh sach tra ve
      }
    } finally { await api.close(); }
  });

  it('bao thuc "all" hien o MOI man hinh (ke ca man chua duoc chon)', async () => {
    const { s, all } = seed();
    const api = await serve(s);
    try {
      for (const dev of [P4, JC, 'man-la', 'esp32-80f1b2d35fb6']) {
        const r = await api.get(`/alarm/list?dev=${encodeURIComponent(dev)}`);
        expect(r.alarms.map((x) => x.id), dev).toContain(all.id);
      }
    } finally { await api.close(); }
  });

  it('alarmsOn(): loc thuan (khong co dev = tat ca)', () => {
    const a = normAlarm({ time: '06:30', devices: [P4] });
    expect(alarmsOn(a, P4)).toBe(true);
    expect(alarmsOn(a, JC)).toBe(false);
    expect(alarmsOn(a)).toBe(true);
    expect(alarmsOn(a, '')).toBe(true);
    expect(alarmsOn(normAlarm({ time: '06:30', devices: 'all' }), 'bat-ky')).toBe(true);
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
