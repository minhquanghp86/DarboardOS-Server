// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (05/12/2026) EQ cho nhanh xuong loa man (src/callEq.ts) — kiem tra bang so hoc, khong can thiet bi:
//   - CCR_CALL_EQ=0 -> BYPASS hoan toan (tra ve DUNG buffer dau vao, khong copy, khong doi mot mau);
//   - high-pass 120 Hz: 60 Hz bi giam > 10 dB, 1 kHz di qua gan nhu nguyen ven;
//   - presence +4 dB @ 1,5 kHz: 1,5 kHz duoc nang ~+4 dB, 200 Hz khong bi anh huong;
//   - khong doi do dai goi (640 byte vao = 640 byte ra) va khong co tran so (dinh ra <= dau vao * he so).
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Biquad, EQ_ENABLED, EQ_HP_HZ, EQ_PRESENCE_DB, EQ_PRESENCE_HZ,
  eqApply, eqProcessPcm, highpassCoef, newEqState, peakingCoef, responseDb,
} from './callEq.js';

const FRAME_BYTES = 640;      // 20 ms

/** Mot khung 20 ms hinh sin `hz`, dinh `dbfs`. */
function sineFrame(hz: number, dbfs = -20, offset = 0): Buffer {
  const amp = 32767 * 10 ** (dbfs / 20);
  const b = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES / 2; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * (i + offset)) / 16000) * amp), i * 2);
  return b;
}

const rms = (pcm: Buffer): number => {
  const n = pcm.length / 2;
  let s = 0;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / n);
};

/**
 * Do muc (dB) sau khi loc MOT tin hieu `hz`: bo qua 200 ms dau (qua do cua biquad), do 300 ms tiep theo.
 * Tra ve chenh lech so voi dau vao (dB) — dung de kiem HPF/presence ma khong phu thuoc pha.
 */
function gainDbAt(hz: number, enabled = true): number {
  const st = newEqState();
  const n = 25;                                       // 25 khung = 500 ms
  let inE = 0, outE = 0;
  for (let k = 0; k < n; k++) {
    const src = sineFrame(hz, -20, k * (FRAME_BYTES / 2));
    const out = eqProcessPcm(st, Buffer.from(src), enabled);   // eqProcessPcm LOC TAI CHO -> phai copy truoc khi do
    if (k >= 10) { inE += rms(src) ** 2; outE += rms(out) ** 2; }   // bo 200 ms dau (qua do cua biquad)
  }
  return 10 * Math.log10(outE / inE);
}

describe('callEq — bypass khi TAT (A/B)', () => {
  it('enabled=false -> tra ve DUNG buffer dau vao (khong copy, khong doi mau)', () => {
    const st = newEqState();
    const pcm = sineFrame(1000);
    const before = Buffer.from(pcm);
    const out = eqApply(st, pcm, false);
    expect(out).toBe(pcm);                             // khong cap phat, khong copy
    expect(pcm.equals(before)).toBe(true);             // khong sua mot mau nao
  });

  it('eqProcessPcm(enabled=false) -> nguyen byte', () => {
    const st = newEqState();
    const pcm = sineFrame(60);
    const before = Buffer.from(pcm);
    expect(eqProcessPcm(st, pcm, false)).toBe(pcm);
    expect(pcm.equals(before)).toBe(true);
  });

  it('mac dinh BAT (EQ_ENABLED = true khi khong dat env)', () => {
    expect(EQ_ENABLED).toBe(true);
  });

  it('CCR_CALL_EQ=0 doc MOT lan luc khoi dong -> EQ_ENABLED = false', async () => {
    vi.resetModules();
    process.env.CCR_CALL_EQ = '0';
    const off = await import('./callEq.js');
    expect(off.EQ_ENABLED).toBe(false);
    vi.resetModules();
    delete process.env.CCR_CALL_EQ;
    const on = await import('./callEq.js');
    expect(on.EQ_ENABLED).toBe(true);
  });
});

describe('callEq — high-pass 120 Hz', () => {
  it('dap tuyen tan so: 30/60 Hz bi giam manh, 300 Hz..4 kHz gan 0 dB', () => {
    const c = highpassCoef(EQ_HP_HZ, Math.SQRT1_2, 16000);
    expect(responseDb(c, 30, 16000)).toBeLessThan(-20);
    expect(responseDb(c, 60, 16000)).toBeLessThan(-10);
    expect(responseDb(c, 120, 16000)).toBeCloseTo(-3, 0);     // diem -3 dB dung tai tan so cat
    expect(responseDb(c, 300, 16000)).toBeGreaterThan(-1);
    expect(responseDb(c, 1000, 16000)).toBeGreaterThan(-0.2);
    expect(responseDb(c, 3000, 16000)).toBeGreaterThan(-0.1);
  });

  it('tin hieu 60 Hz qua EQ bi giam > 10 dB; 1 kHz chi lech < 1 dB', () => {
    expect(gainDbAt(60)).toBeLessThan(-10);
    expect(gainDbAt(1000)).toBeGreaterThan(-1);
  });
});

describe('callEq — presence +4 dB @ 1,5 kHz', () => {
  it('1,5 kHz duoc nang ~+4 dB', () => {
    const st = newEqState();
    // Do rieng biquad presence de khong lan voi high-pass (1,5 kHz high-pass ~0 dB).
    const n = 25;
    let inE = 0, outE = 0;
    for (let k = 0; k < n; k++) {
      const src = sineFrame(EQ_PRESENCE_HZ, -20, k * (FRAME_BYTES / 2));
      const out = Buffer.from(src);
      const p = st.presence;
      for (let i = 0; i < out.length / 2; i++) {
        const y = p.step(out.readInt16LE(i * 2) / 32768);
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y * 32768))), i * 2);
      }
      if (k >= 10) { inE += rms(src) ** 2; outE += rms(out) ** 2; }
    }
    expect(10 * Math.log10(outE / inE)).toBeCloseTo(EQ_PRESENCE_DB, 0);
  });

  it('200 Hz khong bi presence lam doi (< 0,5 dB) — khong "um" tieng', () => {
    const c = peakingCoef(EQ_PRESENCE_HZ, EQ_PRESENCE_DB, 1, 16000);
    expect(Math.abs(responseDb(c, 200, 16000))).toBeLessThan(0.5);
    expect(responseDb(c, 7000, 16000)).toBeLessThan(0.5);
  });

  it('khong doi do dai goi 640 byte va khong lam tran so', () => {
    const st = newEqState();
    const pcm = sineFrame(1500, -6);
    const out = eqProcessPcm(st, Buffer.from(pcm), true);
    expect(out.length).toBe(FRAME_BYTES);
    const peak = (b: Buffer): number => { let p = 0; for (let i = 0; i < b.length; i += 2) p = Math.max(p, Math.abs(b.readInt16LE(i))); return p; };
    expect(peak(out)).toBeLessThanOrEqual(32767);
    expect(peak(out)).toBeGreaterThan(peak(pcm) * 0.9);     // khong bi bop nho bat thuong
  });
});

describe('callEq — mot so tinh chat cua biquad', () => {
  it('Biquad.reset() xoa trang thai: cung dau vao -> cung dau ra', () => {
    const b = new Biquad(highpassCoef(EQ_HP_HZ, Math.SQRT1_2, 16000));
    const seq = [0.5, -0.5, 0.25, -0.25];
    const first = seq.map((x) => b.step(x));
    b.reset();
    const second = seq.map((x) => b.step(x));
    expect(second).toEqual(first);
  });

  it('high-pass khong khuech dai DC (tin hieu 1 chieu -> ve 0)', () => {
    const st = newEqState();
    const dc = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < FRAME_BYTES / 2; i++) dc.writeInt16LE(8000, i * 2);
    const out = eqProcessPcm(st, dc, true);
    const last = out.readInt16LE(out.length - 2);
    expect(Math.abs(last)).toBeLessThan(50);           // DC da bi loc bo
  });
});

afterEach(() => {
  delete process.env.CCR_CALL_EQ;
});
