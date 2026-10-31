// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (05/12/2026) EQ CHO NHANH XUONG LOA MAN (P4) — bu loa nho cua P4.
//
// Loa cua P4 (ES8311 + loa ~2 W trong vo may) chi phat duoc tu khoang 300-400 Hz tro len, va o 1-3 kHz no "hop" hon
// dai thap. Tieng thoai tu dien thoai (wideband 50-7000 Hz) di qua day bi hai thu:
//   (a) nang luong DUOI 120 Hz (tieng u, gio, rung ban, xuong giong) loa KHONG phat duoc nhung van an headroom —
//       no lam AGC phai ha gain xuong trong khi tai khong nghe thay gi -> "P4 khong nhay";
//   (b) vung 1-3 kHz (phu am, do ro cua loi noi) thieu -> nghe "đục", phai văn am luong len -> de bi "ru rit"
//       do vong lap am hoc (loa P4 -> mic dien thoai).
// Module nay loc nhiu duoi bang mot biquad high-pass 12 dB/oct tai 120 Hz, roi nang vung presence +4 dB @ 1,5 kHz
// (Q = 1,0 — du rong de khong thanh "choi tai"), dung RBJ Audio EQ Cookbook, transposed direct form II, trang thai
// rieng cho tung man (khong co trang thai toan cuc -> hai man khong anh huong nhau).
//
// Nhuong cho AGC: EQ chay TRUOC AGC/limiter (xem `sendToSpeaker()` trong src/callBridge.ts), nen dinh tang them do
// presence boost van bi limiter chan o -4 dBFS — khong bao gio day lao xuong loa qua muc lam vo tieng.
//
// Bat/tat: env `CCR_CALL_EQ` — mac dinh BAT ('0'/'off'/'false'/'no' = TAT de A/B tren cung mot tep mau:
// `POST /call/test/play?dev=<id>&file=tone-1k&eq=0` hoac dat env roi khoi dong lai add-on).
// Cung ho tro ghi de THEO TUNG LAN GOI qua tham so `eq` cua `sendToSpeaker()` (dung cho phep do A/B khong can restart).

/** Tan so cat high-pass (Hz) — duoi muc nay loa P4 khong phat duoc, chi an headroom. */
export const EQ_HP_HZ = 120;
/** Q cua high-pass (0,7071 = Butterworth: khong gio, khong don). */
export const EQ_HP_Q = Math.SQRT1_2;
/** Tam tan so presence (Hz) — vung phu am / do ro loi noi. */
export const EQ_PRESENCE_HZ = 1500;
/** Muc nang presence (dB). */
export const EQ_PRESENCE_DB = 4;
/** Q cua presence (1,0 = ~1 octave). */
export const EQ_PRESENCE_Q = 1;

/** Doc env MOT lan luc khoi dong: mac dinh BAT, chi '0' (hoac off/false/no) la TAT. */
function readEnabled(): boolean {
  const v = (process.env.CCR_CALL_EQ ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

export const EQ_ENABLED: boolean = readEnabled();
if (!process.env.VITEST) {
  console.log(`[audio] eq=${EQ_ENABLED ? 'on' : 'off'} hp=${EQ_HP_HZ}Hz presence=+${EQ_PRESENCE_DB}dB@${EQ_PRESENCE_HZ}Hz`);
}

/** He so cua mot biquad da chuan hoa theo a0 (a0 luon = 1). */
export interface BiquadCoef { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Mot biquad (RBJ cookbook), transposed direct form II — 2 o nho trang thai. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(readonly c: BiquadCoef) { }
  reset(): void { this.z1 = 0; this.z2 = 0; }
  /** Loc MOT mau (float) va tra ve mau ra. */
  step(x: number): number {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
}

/** High-pass biquad (RBJ): tan so cat `hz`, do doc Q (0,7071 = Butterworth 12 dB/oct). */
export function highpassCoef(hz: number, q: number, sampleRate: number): BiquadCoef {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Peaking EQ biquad (RBJ): nang/ha `db` tai `hz`, do rong Q. */
export function peakingCoef(hz: number, db: number, q: number, sampleRate: number): BiquadCoef {
  const A = 10 ** (db / 40);
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cos) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

/** Trang thai EQ cua MOT man (hai biquad noi tiep: high-pass -> presence). */
export interface EqState {
  hp: Biquad;
  presence: Biquad;
}

/** Trang thai EQ moi cho mot duong tieng (mot man). */
export function newEqState(sampleRate = 16000): EqState {
  return {
    hp: new Biquad(highpassCoef(EQ_HP_HZ, EQ_HP_Q, sampleRate)),
    presence: new Biquad(peakingCoef(EQ_PRESENCE_HZ, EQ_PRESENCE_DB, EQ_PRESENCE_Q, sampleRate)),
  };
}

/**
 * Loc ca mot buffer PCM s16le mono: LOC TAI CHO (khong cap phat), do dai khong doi (byte vao = byte ra).
 * Goi y: AGC/limiter phia sau nhan cung buffer nen khong co them mot lan copy nua.
 * `enabled === false` (A/B) -> khong cham vao mau nao (tra ve dung buffer dau vao).
 */
export function eqProcessPcm(state: EqState, pcm: Buffer, enabled: boolean = EQ_ENABLED): Buffer {
  if (!enabled || pcm.length < 2) return pcm;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) {
    const x = pcm.readInt16LE(i * 2) / 32768;
    let y = state.hp.step(x);
    y = state.presence.step(y);
    const s = Math.max(-32768, Math.min(32767, Math.round(y * 32768)));
    pcm.writeInt16LE(s, i * 2);
  }
  return pcm;
}

/**
 * Copy roi loc — dung khi buffer dau vao con duoc noi khac giu (buffer cua WebSocket).
 * `enabled === false` -> tra ve NGUYEN buffer dau vao (khong copy), giong het duong cu.
 */
export function eqApply(state: EqState, pcm: Buffer, enabled: boolean = EQ_ENABLED): Buffer {
  if (!enabled) return pcm;
  const out = Buffer.from(pcm);
  return eqProcessPcm(state, out, true);
}

/** Do loi (dB) cua biquad tai tan so `hz` — dung cho test/chan doan (khong can thiet bi that). */
export function responseDb(c: BiquadCoef, hz: number, sampleRate: number): number {
  // H(e^jw) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2), z = e^{jw}
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos1 = Math.cos(-w), sin1 = Math.sin(-w);
  const cos2 = Math.cos(-2 * w), sin2 = Math.sin(-2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2, ni = c.b1 * sin1 + c.b2 * sin2;
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2, di = c.a1 * sin1 + c.a2 * sin2;
  const mag = Math.hypot(nr, ni) / Math.hypot(dr, di);
  return 20 * Math.log10(Math.max(mag, 1e-12));
}
