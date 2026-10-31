// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (05/12/2026) BO PHAT THU NGHIEM: file WAV CO DINH -> loa man P4, khong can nguoi nghe may.
//
// Vi sao: do duong phat tren P4 bang giong noi that thi moi lan mot khac (mic dien thoai, khoang cach, phong, AEC/NS
// cua trinh duyet) -> khong so sanh duoc A/B. Voi mot tep mau CO DINH, cung mot nhip 20 ms, cung mot gain, ta so duoc
// thang: `dropped`, so khung, khoang cach goi phia thiet bi va muc ra loa.
//
// Module nay chi lo phan THUAN (khong phu thuoc thiet bi, khong import module nao cua server):
//   - doc/kiem tra WAV (16 kHz, mono, s16le — dung dinh dang AudioFrame cua firmware);
//   - liet ke tep mau trong thu muc `test-audio/` (xem scripts/gen-test-audio.mjs);
//   - nhip phat: MOT khung moi 20 ms theo moc TUYET DOI t0 + k*20 ms (setTimeout chi quyet dinh "thuc day luc nao",
//     con moc thi tinh tu dong ho -> khong cong don drift nhu `setInterval`/`await sleep(20)`).
// Duong phat THAT (AGC/EQ/pacer/pacer -> broadcaster) nam o `sendToSpeaker()` trong src/callBridge.ts; module nay chi
// goi callback `send` ma callBridge truyen vao, nho vay test duoc bang vitest voi dong ho gia (src/testAudio.test.ts).

/** Dinh dang bat buoc: khop voi AudioFrame ma firmware phat ra loa (`i2s_audio` 16 kHz, s16le mono). */
export const WAV_SAMPLE_RATE = 16000;
export const WAV_CHANNELS = 1;
export const WAV_BITS = 16;
/** 20 ms PCM s16le mono 16 kHz = 320 mau = 640 byte (khop src/callBridge.ts FRAME_BYTES). */
export const FRAME_BYTES = 640;
export const FRAME_MS = 20;

export interface Wav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** PCM tho (s16le) — khong gom header. */
  data: Buffer;
  /** So mau MOI KENH. */
  samples: number;
  ms: number;
}

/**
 * Doc WAV (RIFF/WAVE) va KIEM TRA dung dinh dang duong xuong loa: 16 kHz, mono, 16-bit PCM.
 * Sai dinh dang -> nem loi co thong diep ro rang (endpoint tra 400 kèm ly do, khong gui bua xuong loa).
 */
export function parseWav(buf: Buffer): Wav {
  if (buf.length < 44) throw new Error('tep qua ngan (khong phai WAV)');
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WAVE')
    throw new Error('khong phai tep WAV (RIFF/WAVE)');
  // Di qua cac chunk: "fmt " cho dinh dang, "data" cho PCM (khong phai WAV nao cung dat fmt ngay sau header).
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = buf.subarray(o, o + 4).toString('latin1');
    const size = buf.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    o = body + size + (size % 2);        // chunk le duoc dem 1 byte cho chan
  }
  if (!fmt) throw new Error('thieu chunk "fmt "');
  if (!data) throw new Error('thieu chunk "data"');
  const f: { format: number; channels: number; sampleRate: number; bits: number } = fmt;
  const d: Buffer = data;
  if (f.format !== 1) throw new Error(`khong phai PCM (format=${f.format}) — can PCM 16-bit`);
  if (f.sampleRate !== WAV_SAMPLE_RATE) throw new Error(`sample rate ${f.sampleRate} Hz — can ${WAV_SAMPLE_RATE} Hz`);
  if (f.channels !== WAV_CHANNELS) throw new Error(`${f.channels} kenh — can mono`);
  if (f.bits !== WAV_BITS) throw new Error(`${f.bits}-bit — can ${WAV_BITS}-bit`);
  const bytesPerSample = (f.bits / 8) * f.channels;
  const usable = d.length - (d.length % bytesPerSample);
  const pcm: Buffer = usable === d.length ? d : d.subarray(0, usable);
  const samples = Math.floor(pcm.length / bytesPerSample);
  return { sampleRate: f.sampleRate, channels: f.channels, bitsPerSample: f.bits, data: pcm, samples, ms: Math.round((samples / f.sampleRate) * 1000) };
}

/** Thu muc tep mau: `CCR_TEST_AUDIO_DIR` neu dat, nguoc lai `test-audio/` canh repo (hoac canh dist/ khi da build). */
export function testAudioDirCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const custom = (env.CCR_TEST_AUDIO_DIR ?? '').trim();
  if (custom) return [custom];
  return [
    `${process.cwd()}/test-audio`,
    `${process.cwd()}/../test-audio`,     // chay tu dist/ (node dist/index.js)
  ];
}

/** Ten tep hop le: chi chu/so/._- va phai la .wav — khong cho `../`, khong cho duong dan tuyet doi. */
export function sanitizeName(name: string): string | null {
  const n = (name || '').trim();
  if (!n || n.length > 64) return null;
  if (!/^[A-Za-z0-9._-]+\.wav$/.test(n)) return null;
  if (n.includes('..')) return null;
  return n;
}

export interface AudioFileInfo { name: string; bytes: number; ms: number }

/** Danh sach tep mau co san (sap xep theo ten). Thu muc khong ton tai -> mang rong. */
export function listTestAudio(fs: typeof import('node:fs'), dirs: string[] = testAudioDirCandidates()): AudioFileInfo[] {
  const out: AudioFileInfo[] = [];
  for (const dir of dirs) {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) {
      if (!/\.wav$/i.test(n)) continue;
      const safe = sanitizeName(n);
      if (!safe) continue;
      try {
        const st = fs.statSync(`${dir}/${safe}`);
        if (!st.isFile()) continue;
        const w = parseWav(fs.readFileSync(`${dir}/${safe}`));
        out.push({ name: safe, bytes: st.size, ms: w.ms });
      } catch { /* tep hong / sai dinh dang: khong liet ke */ }
    }
    if (out.length) break;                // thu muc dau tien co tep: dung (khong tron hai thu muc)
  }
  return out;
}

/** Doc MOT tep mau theo ten. Khong tim thay / sai dinh dang -> nem loi co thong diep ro rang. */
export function loadTestAudio(name: string, fs: typeof import('node:fs'), dirs: string[] = testAudioDirCandidates()): { name: string; wav: Wav } {
  const safe = sanitizeName(name);
  if (!safe) throw new Error(`ten tep khong hop le: "${name}" (chi ten.wav trong test-audio/)`);
  for (const dir of dirs) {
    const p = `${dir}/${safe}`;
    if (!fs.existsSync(p)) continue;
    return { name: safe, wav: parseWav(fs.readFileSync(p)) };
  }
  throw new Error(`khong co tep "${safe}" trong test-audio/ (xem scripts/gen-test-audio.mjs)`);
}

/** So khung 20 ms cua mot do dai PCM (lam tron LEN: duoi le van duoc gui thanh mot khung cuoi ngan hon). */
export function frameCount(bytes: number, frameBytes = FRAME_BYTES): number {
  return Math.ceil(bytes / frameBytes);
}

/** Tham so cua `POST /call/test/play` (da kiem tra/keo ve khoang hop le). */
export interface PlayParams {
  file: string;
  /** So lan phat (1..600 — 10 s/tep, 600 = 100 phut, du cho moi phep do). */
  loop: number;
  /** true/false = GHI DE env cho lan phat nay; undefined = theo env (CCR_CALL_AGC / CCR_CALL_EQ). */
  agc?: boolean;
  eq?: boolean;
  /** Gain them truoc AGC (dB), -40..+20. */
  gainDb: number;
}

/** Doc tham so tu query: `file=`, `loop=`, `agc=0|1`, `eq=0|1`, `gain=<dB>`. Gia tri sai -> mac dinh, khong nem loi. */
export function readPlayParams(get: (k: string) => string | null): PlayParams {
  const num = (k: string): number | null => {
    const v = get(k);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bit = (k: string): boolean | undefined => {
    const v = (get(k) ?? '').trim().toLowerCase();
    if (v === '1' || v === 'on' || v === 'true' || v === 'yes') return true;
    if (v === '0' || v === 'off' || v === 'false' || v === 'no') return false;
    return undefined;
  };
  const loopRaw = num('loop');
  const gainRaw = num('gain');
  return {
    file: (get('file') || 'speech-like.wav').trim(),
    loop: loopRaw === null ? 1 : Math.max(1, Math.min(600, Math.round(loopRaw))),
    agc: bit('agc'),
    eq: bit('eq'),
    gainDb: gainRaw === null ? 0 : Math.max(-40, Math.min(20, gainRaw)),
  };
}

export interface PlayResult {
  /** So khung 20 ms da giao cho `send()`. */
  frames: number;
  /** Thoi gian tu khung dau den khung cuoi (ms). */
  ms: number;
  /** So nhip bi tre qua `maxCatchUp` khung (event loop bi chan) — chan doan "giat do server". */
  lateTicks: number;
}

export interface PlayOptions {
  /** PCM s16le mono (ca tep hoac mot phan). */
  pcm: Buffer;
  /** So lan phat (>= 1). */
  loop?: number;
  /** Phat MOT khung 20 ms qua duong that (callBridge truyen `sendToSpeaker`). */
  send: (frame: Buffer) => void;
  frameMs?: number;
  /** Toi da bao nhieu khung duoc gui bu trong MOT nhip khi bi tre (mac dinh 2 = khong bun no). */
  maxCatchUp?: number;
  frameBytes?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
  /** Huy giua chung (vd. thiet bi ngat): duoc goi khong an. */
  signal?: { aborted: boolean };
}

/**
 * Phat PCM theo nhip 20 ms/khung, dung moc TUYET DOI: khung thu k duoc gui tai `t0 + k*frameMs`.
 * Khong dung `setInterval` (no troi dan va don nhieu khung vao mot lan khi bi tre) va khong dung
 * `await sleep(frameMs)` (sai so cong don theo tung khung).
 */
export function playPaced(o: PlayOptions): Promise<PlayResult> {
  const frameMs = o.frameMs ?? FRAME_MS;
  const frameBytes = o.frameBytes ?? FRAME_BYTES;
  const maxCatchUp = Math.max(1, o.maxCatchUp ?? 2);
  const now = o.now ?? Date.now;
  const setT = o.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = o.clearTimeout ?? ((t: unknown) => clearTimeout(t as NodeJS.Timeout));
  const loop = Math.max(1, Math.floor(o.loop ?? 1));
  const frames = frameCount(o.pcm.length, frameBytes);
  const total = frames * loop;
  const t0 = now();
  let sent = 0, lateTicks = 0, lastAt = t0;

  return new Promise<PlayResult>((done) => {
    let timer: unknown = null;
    const finish = (): void => { if (timer !== null) { clearT(timer); timer = null; } done({ frames: sent, ms: now() - t0, lateTicks }); };
    const tick = (): void => {
      timer = null;
      if (o.signal?.aborted) return finish();
      const elapsed = now() - t0;
      let due = Math.floor(elapsed / frameMs) + 1;                 // so khung LE RA da gui (moc tuyet doi)
      if (due > sent + maxCatchUp) { due = sent + maxCatchUp; lateTicks++; }
      while (sent < total && sent < due) {
        const off = (sent % frames) * frameBytes;
        o.send(o.pcm.subarray(off, Math.min(o.pcm.length, off + frameBytes)));
        sent++;
        lastAt = t0 + sent * frameMs;
      }
      if (sent >= total) return finish();
      // Moc tuyet doi (khong drift), nhung KHONG BAO GIO hen gio trong qua khu: bi tre (event loop bi chan) thi
      // nhip sau cach nhip nay dung MOT khung, khong ban lien tiep nhieu lan (bun no that su).
      const nextAt = Math.max(lastAt, now() + frameMs);
      timer = setT(tick, nextAt - now());
      (timer as { unref?: () => void }).unref?.();
    };
    tick();                                                        // khung dau gui ngay (khong cho 20 ms)
  });
}
