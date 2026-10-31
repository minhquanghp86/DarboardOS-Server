// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (31/10/2026) DO MUC TIENG THAT tren server — luong WEB (dien thoai / trinh duyet) -> LOA MAN (P4).
//
// Vi sao co module nay: trieu chung "P4 khong nhay" (tieng tu dien thoai van nho) du da bat AGC (src/audioAgc.ts,
// 2.9.313) va am luong P4 da o 74-75 % (~0 dB theo ES8311). Doan tiep thi khong giai quyet duoc: can biet MUC THAT
// cua tin hieu dien thoai gui len (`in`), muc SAU AGC/limiter gui xuong man (`out`, `peak`), gain dang ap (`gain`) va
// co bao nhieu khung den trong 2 s (`frames`, `silent`). Tu do phan biet duoc:
//   - in thap (~-45 dBFS)              -> dien thoai/WebRTC gui tieng qua nho (xu ly phia may: tat AEC/NS/AGC, xem
//                                         `?raw=1` cua public/call-web.html);
//   - in tot ma out thap               -> AGC/limiter hoac duong xuong man co van de;
//   - frames ~0 / NO-FRAMES            -> khong co khung nao den (WS, mic bi tat, trang khong gui).
//
// Moi 2 s, MOT dong cho MOI man dang trong cuoc goi (log thuong, KHONG phai Diag):
//   [audio] dev=<id> in=<a>dBFS out=<b>dBFS peak=<c>dBFS gain=<g>dB frames=<n> silent=<m>
// Khong nhan duoc khung nao trong 2 s ma cuoc goi van mo:
//   [audio] dev=<id> NO-FRAMES
//
// Module THUAN: khong hen gio, khong console, khong phu thuoc thiet bi. `AudioMeters` cong don so lieu va
// `tick(now, open)` tra ve dung cac dong log da du 2 s; `open(dev)` cho phep "khong co cuoc goi thi khong log"
// (callBridge truyen `calls.has(dev)`). Nho vay test duoc bang vitest: src/audioMeter.test.ts.
//
// Dung thuc te: src/callBridge.ts — `startCall()`/`endCall()` mo/dong bo do, `sendToSpeaker()` cong don tung mau PCM
// (in = RMS truoc AGC, out = RMS sau AGC, peak = dinh sau limiter, gain = gain hien tai).

/** Cua so bao cao (ms) — dung yeu cau "moi 2 giay mot dong". */
export const METER_WINDOW_MS = 2000;
/** San dBFS khi in so lieu (im lang tuyet doi -> -120, khong phai -180/-Infinity). */
export const METER_FLOOR_DBFS = -120;

/** Mot mau PCM da do (1 goi WS = 1 hoac nhieu khung 20 ms). */
export interface MeterFrame {
  /** RMS TRUOC AGC (PCM nhan tu dien thoai), dBFS. */
  inDb: number;
  /** RMS SAU AGC (PCM gui xuong man), dBFS. */
  outDb: number;
  /** Dinh SAU limiter, dBFS. */
  peakDb: number;
  /** Gain dang ap (dB). */
  gainDb: number;
  /** true = khung bi coi la im lang (< -60 dBFS, xem AGC_SILENCE_DBFS cua src/audioAgc.ts). */
  silent: boolean;
  /** So khung 20 ms trong mau nay (640 byte = 1 khung, 2 s ~ 100 khung). Bo qua -> 1. */
  frames?: number;
}

export interface MeterTotals {
  inDb: number;
  outDb: number;
  peakDb: number;
  gainDb: number;
  frames: number;
  silent: number;
}

export interface MeterReading extends MeterTotals {
  dev: string;
  /** DONG LOG da dinh dang, xem `meterLine()`. */
  line: string;
}

const clampDb = (v: number): number => (Number.isFinite(v) ? Math.max(v, METER_FLOOR_DBFS) : METER_FLOOR_DBFS);

/** dBFS -> chuoi MOT so le ('-18.3'), san -120 ('-120.0'); '-0.0' -> '0.0' cho de doc. */
export function fmtDb(v: number): string {
  const s = clampDb(v).toFixed(1);
  return s === '-0.0' ? '0.0' : s;
}

/** Dung DUNG dinh dang dong log da thong nhat (thu tu truong khong doi — script/doc log dua vao day). */
export function meterLine(dev: string, t: MeterTotals): string {
  return `[audio] dev=${dev} in=${fmtDb(t.inDb)}dBFS out=${fmtDb(t.outDb)}dBFS peak=${fmtDb(t.peakDb)}dBFS ` +
    `gain=${fmtDb(t.gainDb)}dB frames=${Math.max(0, Math.round(t.frames))} silent=${Math.max(0, Math.round(t.silent))}`;
}

/** Cuoc goi dang mo ma KHONG nhan duoc khung nao trong ca cua so 2 s. */
export function noFramesLine(dev: string): string { return `[audio] dev=${dev} NO-FRAMES`; }

/**
 * Bo do cua MOT man: cong don tung mau PCM trong cua so hien tai (mac dinh 2 s) roi chot thanh mot dong log.
 * `frames`/`silent` dem theo khung 20 ms; `in`/`out` lay TRUNG BINH NANG LUONG (10^(dB/10)) chu khong phai trung binh
 * dB — dung cach do muc am thanh, khong bi mot khung im lang keo lech.
 */
export class AudioMeter {
  private frames = 0;
  private silentFrames = 0;
  private inEnergy = 0;
  private outEnergy = 0;
  private peakDb = METER_FLOOR_DBFS;
  private gainDb = 0;
  private since: number;

  constructor(readonly dev: string, private readonly windowMs: number = METER_WINDOW_MS, now: number = Date.now()) {
    this.since = now;
  }

  /** So khung 20 ms da cong don trong cua so hien tai. */
  get count(): number { return this.frames; }

  /** Cong don mot mau PCM. */
  add(f: MeterFrame): void {
    const n = Number.isFinite(f.frames) && (f.frames as number) > 0 ? (f.frames as number) : 1;
    const inDb = clampDb(f.inDb), outDb = clampDb(f.outDb);
    this.frames += n;
    this.inEnergy += 10 ** (inDb / 10) * n;
    this.outEnergy += 10 ** (outDb / 10) * n;
    const peak = clampDb(f.peakDb);
    if (peak > this.peakDb) this.peakDb = peak;
    if (Number.isFinite(f.gainDb)) this.gainDb = f.gainDb;
    if (f.silent) this.silentFrames += n;
  }

  /** Cua so 2 s da het chua. */
  due(now: number = Date.now()): boolean { return now - this.since >= this.windowMs; }

  /** So lieu cua cua so hien tai; null = chua co khung nao. Khong reset. */
  totals(): MeterTotals | null {
    if (!(this.frames > 0)) return null;
    return {
      inDb: clampDb(10 * Math.log10(this.inEnergy / this.frames)),
      outDb: clampDb(10 * Math.log10(this.outEnergy / this.frames)),
      peakDb: this.peakDb,
      gainDb: this.gainDb,
      frames: Math.max(1, Math.round(this.frames)),
      silent: Math.round(this.silentFrames),
    };
  }

  /**
   * Chot cua so hien tai va RESET (dau cua so 2 s tinh tu `now`).
   * null = khong co khung nao -> caller log `NO-FRAMES` (xem `AudioMeters.tick`).
   */
  flush(now: number = Date.now()): MeterReading | null {
    const t = this.totals();
    this.reset(now);
    return t ? { dev: this.dev, ...t, line: meterLine(this.dev, t) } : null;
  }

  /** Xoa so lieu, mo cua so moi tu `now`. */
  reset(now: number = Date.now()): void {
    this.frames = 0;
    this.silentFrames = 0;
    this.inEnergy = 0;
    this.outEnergy = 0;
    this.peakDb = METER_FLOOR_DBFS;
    this.gainDb = 0;
    this.since = now;
  }
}

/** Bo do cua NHIEU man (moi man trong cuoc goi mot bo do). */
export class AudioMeters {
  private readonly map = new Map<string, AudioMeter>();

  constructor(private readonly windowMs: number = METER_WINDOW_MS) { }

  get size(): number { return this.map.size; }

  get(dev: string): AudioMeter | undefined { return this.map.get(dev); }

  /** Mo bo do cho `dev` khi BAT DAU cuoc goi (goi lai vo hai). */
  start(dev: string, now: number = Date.now()): AudioMeter {
    const cur = this.map.get(dev);
    if (cur) return cur;
    const m = new AudioMeter(dev, this.windowMs, now);
    this.map.set(dev, m);
    return m;
  }

  /** Dong bo do khi KET THUC cuoc goi — khong log gi. */
  stop(dev: string): void { this.map.delete(dev); }

  clear(): void { this.map.clear(); }

  /** Cong don mot mau PCM; false = `dev` dang KHONG trong cuoc goi (khong do, khong log). */
  add(dev: string, f: MeterFrame): boolean {
    const m = this.map.get(dev);
    if (!m) return false;
    m.add(f);
    return true;
  }

  /**
   * Chot moi bo do da du 2 s. `open(dev)` = man do con trong cuoc goi khong: false -> bo bo do, KHONG log (ranh thi
   * khong spam). Tra ve cac DONG LOG theo thu tu mo bo do, gom ca `NO-FRAMES`.
   */
  tick(now: number = Date.now(), open: (dev: string) => boolean = () => true): string[] {
    const out: string[] = [];
    for (const [dev, m] of [...this.map]) {
      if (!open(dev)) { this.map.delete(dev); continue; }
      if (!m.due(now)) continue;
      const r = m.flush(now);
      out.push(r ? r.line : noFramesLine(dev));
    }
    return out;
  }
}
