// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (31/10/2026) DO MUC TIENG THAT (web -> man P4) — kiem tra THUAN, khong can thiet bi/hen gio that
// (src/audioMeter.ts):
//   - cong don khung 20 ms trong cua so 2 s: `frames` (~100) va `silent` dem dung;
//   - `in`/`out` lay TRUNG BINH NANG LUONG (khong phai trung binh dB), `peak` = dinh lon nhat, `gain` = gain moi nhat;
//   - dong log DUNG dinh dang: `[audio] dev=<id> in=<a>dBFS out=<b>dBFS peak=<c>dBFS gain=<g>dB frames=<n> silent=<m>`;
//   - RESET sau moi cua so 2 s (cua so sau khong cong don so cua so truoc) va `NO-FRAMES` khi khong co khung nao;
//   - man KHONG con trong cuoc goi -> khong log gi (khong spam khi ranh).
import { describe, expect, it } from 'vitest';

import {
  AudioMeter, AudioMeters, METER_FLOOR_DBFS, METER_WINDOW_MS, fmtDb, meterLine, noFramesLine,
} from './audioMeter.js';

/** Mot khung 20 ms "binh thuong" (khong im lang) voi cac muc cho truoc. */
const frame = (inDb: number, outDb = -18, gainDb = 22, peakDb = -6, silent = false, frames?: number) =>
  ({ inDb, outDb, peakDb, gainDb, silent, ...(frames === undefined ? {} : { frames }) });

describe('audioMeter — dinh dang dong log', () => {
  it('dung DUNG chuoi da thong nhat (thu tu truong / don vi khong doi)', () => {
    const line = meterLine('p4-bep', { inDb: -40, outDb: -18, peakDb: -6, gainDb: 22, frames: 100, silent: 0 });
    expect(line).toBe('[audio] dev=p4-bep in=-40.0dBFS out=-18.0dBFS peak=-6.0dBFS gain=22.0dB frames=100 silent=0');
  });

  it('so 1 chu so le, san -120 dBFS, khong bao gio in "-0.0"', () => {
    expect(fmtDb(-18.34)).toBe('-18.3');
    expect(fmtDb(-0.04)).toBe('0.0');
    expect(fmtDb(-999)).toBe('-120.0');            // im lang tuyet doi
    expect(fmtDb(Number.NaN)).toBe('-120.0');
    expect(fmtDb(METER_FLOOR_DBFS)).toBe('-120.0');
  });

  it('dong NO-FRAMES dung dinh dang rieng', () => {
    expect(noFramesLine('p4-bep')).toBe('[audio] dev=p4-bep NO-FRAMES');
  });
});

describe('audioMeter — cong don trong cua so 2 s', () => {
  it('100 khung 20 ms -> frames=100, silent=0 (ky vong cua 2 s o 16 kHz)', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 0);
    for (let i = 0; i < 100; i++) m.add(frame(-40));
    const r = m.flush(METER_WINDOW_MS);
    expect(r).not.toBeNull();
    expect(r!.frames).toBe(100);
    expect(r!.silent).toBe(0);
    expect(r!.line).toBe('[audio] dev=p4-bep in=-40.0dBFS out=-18.0dBFS peak=-6.0dBFS gain=22.0dB frames=100 silent=0');
  });

  it('mot goi WS nhieu khung: `frames` = so khung 20 ms, khong phai so goi', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 0);
    m.add(frame(-40, -18, 22, -6, false, 5));       // 5 khung 20 ms trong MOT mau PCM
    m.add(frame(-40, -18, 22, -6, false, 5));
    const r = m.flush(0)!;
    expect(r.frames).toBe(10);
  });

  it('khung im lang duoc dem rieng (silent)', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 0);
    for (let i = 0; i < 40; i++) m.add(frame(-75, -75, 0, -75, true));
    for (let i = 0; i < 60; i++) m.add(frame(-40));
    const r = m.flush(0)!;
    expect(r.frames).toBe(100);
    expect(r.silent).toBe(40);
  });

  it('in/out la TRUNG BINH NANG LUONG: -40 dBFS + -60 dBFS -> -43,0 dBFS (khong phai -50)', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 0);
    m.add(frame(-40, -18));
    m.add(frame(-60, -18));
    const r = m.flush(0)!;
    expect(r.inDb).toBeCloseTo(10 * Math.log10((1e-4 + 1e-6) / 2), 6);
    expect(fmtDb(r.inDb)).toBe('-43.0');
  });

  it('peak = dinh LON NHAT trong cua so; gain = gain MOI NHAT', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 0);
    m.add(frame(-40, -18, 6, -20));
    m.add(frame(-40, -18, 12.5, -1.2));
    m.add(frame(-40, -18, 9, -8));
    const r = m.flush(0)!;
    expect(r.peakDb).toBe(-1.2);
    expect(r.gainDb).toBe(9);
  });
});

describe('audioMeter — cua so 2 s va reset', () => {
  it('chua du 2 s -> `due()` false, du -> true', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 1000);
    m.add(frame(-40));
    expect(m.due(1000 + METER_WINDOW_MS - 1)).toBe(false);
    expect(m.due(1000 + METER_WINDOW_MS)).toBe(true);
  });

  it('flush RESET so lieu: cua so sau khong cong don so cua so truoc, va khong co khung -> null', () => {
    const m = new AudioMeter('p4-bep', METER_WINDOW_MS, 0);
    for (let i = 0; i < 100; i++) m.add(frame(-40));
    expect(m.flush(2000)!.frames).toBe(100);
    expect(m.count).toBe(0);
    expect(m.totals()).toBeNull();                  // chua co khung nao trong cua so moi
    m.add(frame(-50, -20, 10, -4));
    const r = m.flush(4000)!;                       // KHONG con 100 khung cua cua so truoc
    expect(r.frames).toBe(1);
    expect(r.line).toBe('[audio] dev=p4-bep in=-50.0dBFS out=-20.0dBFS peak=-4.0dBFS gain=10.0dB frames=1 silent=0');
    expect(m.due(5000)).toBe(false);                // moc cua so moi tinh tu lan flush
    expect(m.due(6000)).toBe(true);
  });
});

describe('audioMeters — nhieu man, khong co cuoc goi thi khong log', () => {
  it('add() cho man KHONG duoc mo bo do -> false (khong do, khong log)', () => {
    const ms = new AudioMeters(METER_WINDOW_MS);
    expect(ms.add('p4-bep', frame(-40))).toBe(false);
    expect(ms.tick(METER_WINDOW_MS, () => true)).toEqual([]);
    expect(ms.size).toBe(0);
  });

  it('start() mo bo do (goi lai vo hai), stop() dong', () => {
    const ms = new AudioMeters(METER_WINDOW_MS);
    ms.start('p4-bep', 0);
    ms.start('p4-bep', 0);
    expect(ms.size).toBe(1);
    expect(ms.add('p4-bep', frame(-40))).toBe(true);
    ms.stop('p4-bep');
    expect(ms.size).toBe(0);
    expect(ms.tick(METER_WINDOW_MS, () => true)).toEqual([]);
  });

  it('chua du 2 s -> chua log gi', () => {
    const ms = new AudioMeters(METER_WINDOW_MS);
    ms.start('p4-bep', 0);
    ms.add('p4-bep', frame(-40));
    expect(ms.tick(1999, () => true)).toEqual([]);
  });

  it('du 2 s + co khung -> MOT dong; cua so sau khong khung -> NO-FRAMES', () => {
    const ms = new AudioMeters(METER_WINDOW_MS);
    ms.start('p4-bep', 0);
    for (let i = 0; i < 100; i++) ms.add('p4-bep', frame(-40));
    expect(ms.tick(2000, () => true)).toEqual([
      '[audio] dev=p4-bep in=-40.0dBFS out=-18.0dBFS peak=-6.0dBFS gain=22.0dB frames=100 silent=0']);
    expect(ms.tick(4000, () => true)).toEqual(['[audio] dev=p4-bep NO-FRAMES']);
  });

  it('cuoc goi da ket thuc (`open` false) -> bo bo do, KHONG log (ranh thi khong spam)', () => {
    const ms = new AudioMeters(METER_WINDOW_MS);
    ms.start('p4-bep', 0);
    for (let i = 0; i < 100; i++) ms.add('p4-bep', frame(-40));
    expect(ms.tick(2000, () => false)).toEqual([]);
    expect(ms.size).toBe(0);
  });

  it('moi man mot cua so rieng: man mo sau dong cua so sau (khong lech)', () => {
    const ms = new AudioMeters(METER_WINDOW_MS);
    ms.start('p4-bep', 0);
    ms.start('p4-khach', 1000);
    ms.add('p4-bep', frame(-40));
    ms.add('p4-khach', frame(-30));
    expect(ms.tick(2000, () => true)).toEqual([
      '[audio] dev=p4-bep in=-40.0dBFS out=-18.0dBFS peak=-6.0dBFS gain=22.0dB frames=1 silent=0']);
    expect(ms.tick(2500, () => true)).toEqual([]);
    expect(ms.tick(3000, () => true)).toEqual([
      '[audio] dev=p4-khach in=-30.0dBFS out=-18.0dBFS peak=-6.0dBFS gain=22.0dB frames=1 silent=0']);
  });
});
