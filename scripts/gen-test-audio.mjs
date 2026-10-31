#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (05/12/2026) FILE AM THANH MAU CO DINH de do duong PHAT tren man P4 — khong phu thuoc mic nguoi.
//
// Vi sao can: do bang giong noi that thi moi lan mot khac (mic dien thoai, khoang cach, phong), khong so sanh duoc
// A/B. Ba tep duoi day la dau vao CO DINH cho `POST /call/test/play` (xem src/testAudio.ts):
//   speech-like.wav  chuoi am tiet 300 ms + lang 100 ms — mo phong giong noi (kiem tra "giat cuc / hut hoi");
//   tone-1k.wav      sin 1 kHz lien tuc            — do gain / limiter / muc ra loa;
//   noise.wav        nhieu hong (pink) muc thap    — do nen / tieng "rè" / khoang lang bi cat.
//
// Quy cach CHUNG cho ca ba tep: WAV, 16 kHz, mono, s16le (dung bang dinh dang server gui xuong man: AudioFrame
// 640 byte = 20 ms), dai 10,000 s (160 000 mau), chuan hoa RMS = -20 dBFS, dinh <= -6 dBFS (tran dinh).
//
// Vi sao RMS va dinh khong the cung "bang" mot con so cho MOI tep: dinh/RMS (crest factor) la thuoc tinh cua tin hieu
// (sin ~3 dB, nhieu hong ~12 dB, giong noi ~15-20 dB). Vi vay: chuan hoa RMS = -20 dBFS truoc, roi ha them neu dinh
// vuot -6 dBFS. Nghia la: RMS LUON = -20 dBFS, dinh LUON <= -6 dBFS; rieng sin 1 kHz co dinh tu nhien -17 dBFS
// (khong the vua RMS -20 vua dinh -6 voi mot sin thuan — script in so do that ra man hinh).
//
// Chay: node scripts/gen-test-audio.mjs [thu-muc-ra]     (mac dinh: <repo>/test-audio)
// Kiem tra lai tep da co: node scripts/gen-test-audio.mjs --check
//
// Khong phu thuoc thu vien ngoai (khong can ffmpeg/sox) — chi Node thuan, RNG co hat giong CO DINH nen chay lai
// cho ra BYTE Y HET (commit ca tep, khong sinh luc deploy).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 16000;
export const CHANNELS = 1;
export const BITS = 16;
export const DURATION_S = 10;
export const SAMPLES = SAMPLE_RATE * DURATION_S;     // 160 000 mau = 320 000 byte PCM = 500 khung 20 ms
export const FRAME_BYTES = 640;                       // 20 ms
export const TARGET_RMS_DBFS = -20;
export const PEAK_CEIL_DBFS = -6;

const dbToLin = (db) => 10 ** (db / 20);
/** RMS (0..1) cua mang mau float [-1, 1]. */
export function rmsOf(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / samples.length);
}
/** Dinh tuyet doi (0..1). */
export function peakOf(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
  return p;
}

/**
 * Chuan hoa: (1) dua RMS ve `TARGET_RMS_DBFS`, (2) neu dinh vuot `PEAK_CEIL_DBFS` thi ha toan bo xuong dung tran.
 * Tra ve he so da ap va so do that.
 */
export function normalize(samples) {
  const rms0 = rmsOf(samples);
  let gain = dbToLin(TARGET_RMS_DBFS) / (rms0 || 1);
  let peak = peakOf(samples) * gain;
  const ceil = dbToLin(PEAK_CEIL_DBFS);
  if (peak > ceil) { gain *= ceil / peak; peak = ceil; }
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { gain, rmsDb: 20 * Math.log10(rmsOf(samples) || 1e-12), peakDb: 20 * Math.log10(peak || 1e-12) };
}

/** RNG hat giong co dinh (mulberry32) — chay lai cho ra cung mot tep. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 1. speech-like: chuoi am tiet 300 ms, lang 100 ms, tong hop formant don gian ────────────────────────────────
/** Nguyen am (F1, F2, F3) Hz — du 5 nguyen am co ban de chuoi am tiet nghe "giong noi" chu khong thanh mot not nhac. */
const VOWELS = [
  [730, 1090, 2440],   // a
  [530, 1840, 2480],   // e
  [270, 2290, 3010],   // i
  [570, 840, 2410],    // o
  [300, 870, 2240],    // u
];
const SYL_MS = 300;
const GAP_MS = 100;
const ATTACK_MS = 20;
const RELEASE_MS = 60;
const F0_HZ = 120;         // giong nam
const F_MAX_HZ = 4000;     // du 4 hai dau tien cua F0 120 Hz (120/240/360/480) va van giu formant F2/F3

/** Do loi cua mot cong huong (formant) tai tan so f — dinh 1 tai F, giam dan hai ben. */
const formantGain = (f, F, bw) => 1 / (1 + ((f - F) / bw) ** 2);

/**
 * Mot am tiet dai `SYL_MS`: tong cac hai cua F0 (co contour xuong nhe) voi bien do = tong 3 formant + rolloff 1/k,
 * nhan duong bao attack/decay. Tra ve mang float [-1, 1] (chua chuan hoa).
 */
function syllable(rand, i) {
  const n = Math.round(SAMPLE_RATE * SYL_MS / 1000);
  const out = new Float64Array(n);
  const [F1, F2, F3] = VOWELS[Math.floor(rand() * VOWELS.length)];
  const f0Start = F0_HZ * (0.9 + rand() * 0.25);          // 108..138 Hz
  const f0End = f0Start * (0.86 + rand() * 0.1);          // xuong giong cuoi am tiet (nhu cau noi)
  const aN = Math.round(SAMPLE_RATE * ATTACK_MS / 1000);
  const rN = Math.round(SAMPLE_RATE * RELEASE_MS / 1000);
  // So hai nhieu nhat co the xuat hien: F0 THAP NHAT la f0End (contour di xuong) -> cap theo f0End, khong theo
  // f0Start (thieu slot -> phases[k] = undefined -> ca khung thanh NaN).
  const phases = new Float64Array(Math.ceil(F_MAX_HZ / f0End) + 2);
  for (let k = 1; k < phases.length; k++) phases[k] = rand() * 2 * Math.PI;   // pha ngau nhien: khong "dinh" dinh
  let phase = 0;
  for (let s = 0; s < n; s++) {
    const t = s / n;
    const f0 = f0Start + (f0End - f0Start) * t;
    phase += (2 * Math.PI * f0) / SAMPLE_RATE;
    // Duong bao: attack 20 ms (raised cosine) -> giu -> release 60 ms.
    let env = 1;
    if (s < aN) env = 0.5 - 0.5 * Math.cos((Math.PI * s) / aN);
    else if (s > n - rN) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - s)) / rN);
    let v = 0;
    for (let k = 1; k * f0 < F_MAX_HZ; k++) {
      const f = k * f0;
      const amp = (formantGain(f, F1, 80) + 0.5 * formantGain(f, F2, 100) + 0.25 * formantGain(f, F3, 140)) / k;
      v += amp * Math.sin(phases[k] + k * phase);
    }
    out[s] = v * env;
  }
  return out;
}

export function speechLike() {
  const rand = rng(0x5eed0001);
  const out = new Float64Array(SAMPLES);
  const sylN = Math.round(SAMPLE_RATE * SYL_MS / 1000);
  const gapN = Math.round(SAMPLE_RATE * GAP_MS / 1000);
  const period = sylN + gapN;
  let pos = 0;
  while (pos < SAMPLES) {
    // Doan am tiet ngan dan ve cuoi (het "cau") de khong bi mot tieng dai bat thuong.
    const l = Math.min(sylN, SAMPLES - pos);
    const s = syllable(rand, pos / period);
    out.set(s.subarray(0, l), pos);
    pos += period;
  }
  return out;
}

// ── 2. tone-1k: sin 1 kHz lien tuc (pha tu 0, khong co "bup" o dau/cuoi) ───────────────────────────────────────
export function tone1k() {
  const out = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) out[i] = Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  return out;
}

// ── 3. noise: nhieu hong (pink, -3 dB/octave) muc thap — do nen / khoang lang bi cat ───────────────────────────
export function pinkNoise() {
  const rand = rng(0x5eed0002);
  const out = new Float64Array(SAMPLES);
  // Paul Kellet (refined) — loc trang -> hong, 7 trang thai; du chinh xac cho muc do nen.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  // Vai giay dau/cuoi mo dan (5 ms) de tep khong bat dau bang mot buoc nhay DC.
  const fade = Math.round(SAMPLE_RATE * 0.005);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[SAMPLES - 1 - i] *= g;
  }
  return out;
}

// ── WAV 16 kHz mono s16le ──────────────────────────────────────────────────────────────────────────────────────
/** Dong goi mang mau float [-1, 1] thanh WAV (44 byte header chuan RIFF/WAVE + PCM s16le). */
export function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1');
  h.writeUInt32LE(16, 16);                                    // kich thuoc chunk fmt
  h.writeUInt16LE(1, 20);                                     // PCM
  h.writeUInt16LE(CHANNELS, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * CHANNELS * BITS / 8, 28);     // byte/giay
  h.writeUInt16LE(CHANNELS * BITS / 8, 32);                   // byte/khung
  h.writeUInt16LE(BITS, 34);
  h.write('data', 36, 'latin1');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Doc so do THAT tu mot tep WAV da ghi (de in ra man hinh / kiem tra lai). */
export function measureWav(buf) {
  const n = (buf.length - 44) / 2;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(44 + i * 2) / 32767;
  const rms = rmsOf(s), peak = peakOf(s);
  return {
    samples: n,
    ms: Math.round((n / SAMPLE_RATE) * 1000),
    bytes: buf.length,
    rmsDb: Math.round(20 * Math.log10(rms || 1e-12) * 10) / 10,
    peakDb: Math.round(20 * Math.log10(peak || 1e-12) * 10) / 10,
    crestDb: Math.round(20 * Math.log10((peak || 1e-12) / (rms || 1e-12)) * 10) / 10,
  };
}

export const FILES = [
  { name: 'speech-like.wav', make: speechLike, what: 'chuoi am tiet 300 ms + lang 100 ms (giong noi)' },
  { name: 'tone-1k.wav', make: tone1k, what: 'sin 1 kHz lien tuc (gain/limiter)' },
  { name: 'noise.wav', make: pinkNoise, what: 'nhieu hong muc thap (nen/giat)' },
];

function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, '..', 'test-audio');
  const check = argv.includes('--check');
  const arg = argv.find((a) => !a.startsWith('--'));
  const dir = arg ? path.resolve(arg) : outDir;
  const rows = [];
  if (!check) fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    const p = path.join(dir, f.name);
    if (check) {
      if (!fs.existsSync(p)) { console.log(`THIEU ${p}`); process.exitCode = 1; continue; }
      rows.push({ name: f.name, ...measureWav(fs.readFileSync(p)) });
      continue;
    }
    const s = f.make();
    const norm = normalize(s);
    const buf = toWav(s);
    fs.writeFileSync(p, buf);
    rows.push({ name: f.name, ...measureWav(buf), gainDb: Math.round(20 * Math.log10(norm.gain) * 10) / 10 });
  }
  for (const r of rows) {
    console.log(`${r.name.padEnd(16)} ${String(r.samples).padStart(7)} mau  ${String(r.ms).padStart(5)} ms  ` +
      `${String(r.bytes).padStart(7)} B  RMS ${r.rmsDb} dBFS  dinh ${r.peakDb} dBFS  crest ${r.crestDb} dB`);
  }
  if (!check) {
    console.log(`\nDa ghi ${rows.length} tep vao ${dir}`);
    for (const f of FILES) console.log(`  ${f.name.padEnd(16)} ${f.what}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
