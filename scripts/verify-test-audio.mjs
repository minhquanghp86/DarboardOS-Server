// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).
//
// Kiem chung CUC BO rang 3 tep mau trong `test-audio/` doc duoc qua DUNG ham ma endpoint dung
// (`loadTestAudio()` / `listTestAudio()` cua src/testAudio.ts), va rang chung cho ra so khung 20 ms dung:
//   speech-like.wav 10 s, 16 kHz mono s16le -> 320000 byte PCM -> frameCount = 500 khung (= 10 s / 20 ms).
//
// Day la bang chung cho cau hoi "vi sao `GET /call/test/files` tra files:[] tren add-on dang chay":
// ham doc tep la dung, chi thieu thu muc trong image (dockerfile: `COPY test-audio ./test-audio`).
//
// Chay (sau khi build, vi script nap `dist/testAudio.js` — dung chinh ma da build):
//   npm run build && node scripts/verify-test-audio.mjs
//   node scripts/verify-test-audio.mjs --dir /duong/dan/test-audio     # kiem tra thu muc khac
//   CCR_TEST_AUDIO_DIR=/app/test-audio node scripts/verify-test-audio.mjs   # thu duong container
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let mod;
try {
  mod = await import(new URL('../dist/testAudio.js', import.meta.url).href);
} catch (e) {
  console.error('Khong nap duoc dist/testAudio.js — chay `npm run build` truoc.');
  console.error(String(e?.message ?? e));
  process.exit(2);
}
const { loadTestAudio, listTestAudio, frameCount, parseWav, sanitizeName, testAudioDirCandidates, FRAME_BYTES } = mod;

const argDir = (() => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 ? process.argv[i + 1] : null;
})();
if (argDir) fs.mkdirSync(argDir, { recursive: true });

const dirs = testAudioDirCandidates();
const FILES = ['speech-like.wav', 'tone-1k.wav', 'noise.wav'];

let fail = 0;
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) fail++;
};

console.log(`repo            : ${root}`);
console.log(`thu muc da tim  :\n  ${dirs.join('\n  ')}`);

// 1) Danh sach: dung 3 tep, dung 10 s moi tep.
console.log('\n[1] listTestAudio() — dung ham ma GET /call/test/files dung');
const list = listTestAudio(fs);
console.log(`  ${'tep'.padEnd(16)} ${'byte'.padStart(7)} ${'ms'.padStart(6)}`);
for (const f of list) console.log(`  ${f.name.padEnd(16)} ${String(f.bytes).padStart(7)} ${String(f.ms).padStart(6)}`);
check(list.map((f) => f.name).join(',') === [...FILES].sort().join(','), 'dung 3 tep mau', list.map((f) => f.name).join(','));
check(list.every((f) => f.ms === 10000), 'moi tep dai 10000 ms');
check(list.every((f) => f.bytes === 320044), 'moi tep 320044 byte (44 header + 320000 PCM)');

// 2) loadTestAudio() theo TEN DAY DU va theo TEN THIEU `.wav` (file=speech-like).
console.log('\n[2] loadTestAudio() — duong that cua POST /call/test/play (sanitizeName tu them .wav)');
console.log(`  ${'ten goi'.padEnd(16)} ${'ten giai ra'.padEnd(16)} ${'Hz'.padStart(6)} ${'kenh'.padStart(5)} `
  + `${'bit'.padStart(4)} ${'mau'.padStart(7)} ${'byte PCM'.padStart(9)} ${'ms'.padStart(6)} ${'frameCount'.padStart(10)}`);
const rows = [];
for (const name of ['speech-like.wav', 'speech-like', 'tone-1k.wav', 'tone-1k', 'noise.wav', 'noise']) {
  const { name: resolved, wav } = loadTestAudio(name, fs);           // khong truyen dirs -> testAudioDirCandidates()
  const frames = frameCount(wav.data.length);
  rows.push({ asked: name, resolved, wav, frames });
  console.log(`  ${name.padEnd(16)} ${resolved.padEnd(16)} ${String(wav.sampleRate).padStart(6)} ${String(wav.channels).padStart(5)} `
    + `${String(wav.bitsPerSample).padStart(4)} ${String(wav.samples).padStart(7)} ${String(wav.data.length).padStart(9)} `
    + `${String(wav.ms).padStart(6)} ${String(frames).padStart(10)}`);
}
const speech = rows.find((r) => r.asked === 'speech-like.wav');
const speechNoExt = rows.find((r) => r.asked === 'speech-like');
check(speech.wav.sampleRate === 16000 && speech.wav.channels === 1 && speech.wav.bitsPerSample === 16,
  'speech-like.wav: 16 kHz / mono / 16-bit PCM');
check(speech.wav.samples === 160000 && speech.wav.ms === 10000, 'speech-like.wav: 160000 mau = 10000 ms = 10 s');
check(speech.wav.data.length === 320000, 'speech-like.wav: 320000 byte PCM');
check(speech.frames === 500, 'speech-like.wav: frameCount = 500 khung 20 ms', `320000 / ${FRAME_BYTES} = ${speech.frames}`);
check(speechNoExt.resolved === 'speech-like.wav' && speechNoExt.frames === 500,
  'file=speech-like (thieu .wav) = file=speech-like.wav', speechNoExt.resolved);
check(rows.every((r) => r.frames === 500), 'ca 3 tep: 500 khung');
check(rows.every((r) => r.wav.data.length % FRAME_BYTES === 0), 'chia het 640 byte -> khong co khung cuoi ngan');

// 3) Ten la van bi chan (khong tu them .wav de lot ra ngoai).
console.log('\n[3] sanitizeName() — ten la bi tu choi');
for (const bad of ['../etc/passwd', 'a/b.wav', 'tone.mp3', '', 'x'.repeat(80) + '.wav']) {
  check(sanitizeName(bad) === null, `tu choi ${JSON.stringify(bad.length > 20 ? `${bad.slice(0, 20)}...` : bad)}`);
}
check(sanitizeName('speech-like') === 'speech-like.wav', 'them .wav: speech-like -> speech-like.wav');
let missingMsg = '';
try { loadTestAudio('khong-co.wav', fs); } catch (e) { missingMsg = String(e?.message ?? e); }
check(/da tim: /.test(missingMsg), 'tep khong ton tai: thong diep co "da tim: <thu muc>"', missingMsg.slice(0, 90));

// 4) Thu muc khong ton tai: dung dieu kien trong container 2.9.315 (chua COPY test-audio) -> files [].
console.log('\n[4] Mo phong image 2.9.315 (khong co test-audio/): listTestAudio([]) phai rong');
check(listTestAudio(fs, []).length === 0, 'khong co thu muc -> files: [] (dung trieu chung tren add-on)');

// 5) parseWav doc thang byte dau/cuoi (khong qua loadTestAudio) — doi chieu doc lap.
console.log('\n[5] parseWav() doc thang file — doi chieu doc lap');
for (const name of FILES) {
  const buf = fs.readFileSync(path.join(argDir ?? dirs[0], name));
  const w = parseWav(buf);
  check(w.samples === 160000 && w.ms === 10000 && frameCount(w.data.length) === 500, `${name}: 500 khung`);
}

console.log(`\n${fail === 0 ? 'OK' : 'THAT BAI'}: ${fail} check hong.`);
console.log('Ket luan: speech-like.wav (10 s, 16 kHz mono s16le) -> 500 khung 20 ms; ca 3 tep deu doc duoc.');
process.exit(fail === 0 ? 0 : 1);
