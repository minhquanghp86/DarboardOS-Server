#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (05/12/2026) DO THAT NHIP GUI CUA SERVER (khong can man P4): mot client WebSocket GIA dong vai "man hinh" nhan
// AudioFrame, ghi lai THOI DIEM DEN cua tung goi va tinh dung cac chi so ma firmware in ra o `[audio-diag]`:
//   - so goi nhan duoc, tong byte;
//   - khoang cach giua hai goi lien tiep: trung vi / p95 / MAX (ms);
//   - so lan khoang cach > 80 ms (= "lo hong" ma loa se hut hoi).
//
// Nguon phat: tep mau co dinh (test-audio/*.wav), bom vao DUNG duong that `sendToSpeaker()` — hoac theo nhip deu 20 ms
// (giong `POST /call/test/play`), hoac theo kieu BURST (nhieu khung mot lan roi im, giong trang goi/WS that khi mang
// chum). So hai che do cua server: `CCR_CALL_PACE=1` (mac dinh, bo dem nhip moi) va `CCR_CALL_PACE=0` (hanh vi CU:
// gui ngay khong dem). Chay sau khi da `npm run build`:
//
//   node scripts/measure-pacing.mjs                 # pace=1, nguon burst 3 khung / 60 ms
//   CCR_CALL_PACE=0 node scripts/measure-pacing.mjs # pace=0 (A/B)
//   node scripts/measure-pacing.mjs --file=tone-1k.wav --burst=1 --every=20 --seconds=5
//
// LUU Y: day la do tren LOOPBACK (khong co nhieu Wi-Fi, khong co video chen kenh), nen no do dung phan SERVER quyet
// dinh: nhip gui ra socket co deu 20 ms hay khong, va burst co bi trai deu khong. Phan jitter mang that phai do tren
// P4 (xem log `[audio-diag]` cua firmware).

import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const argOf = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const FILE = argOf('file', 'speech-like.wav');
const BURST = Math.max(1, Number(argOf('burst', '3')));          // so khung moi dot
const EVERY_MS = Math.max(5, Number(argOf('every', '60')));      // cach nhau giua cac dot
const SECONDS = Math.max(1, Number(argOf('seconds', '6')));

const FRAME_BYTES = 640;
const FRAME_MS = 20;

/** PCM cua tep mau (bo 44 byte header WAV; tep do scripts/gen-test-audio.mjs sinh ra). */
function loadPcm(name) {
  const p = path.resolve(process.cwd(), 'test-audio', name);
  const b = fs.readFileSync(p);
  return b.subarray(44);
}

const pcm = loadPcm(FILE);
const totalFrames = Math.floor(pcm.length / FRAME_BYTES);

const { broadcaster } = await import('../dist/deviceManager.js');
const { sendToSpeaker } = await import('../dist/callBridge.js');

const DEV = 'probe';
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
await new Promise((ok) => wss.once('listening', ok));
const port = wss.address().port;

const arrivals = [];
let bytes = 0;
wss.on('connection', (ws) => {
  broadcaster.addClient(DEV, ws);
  ws.on('message', (d) => {
    const b = Buffer.isBuffer(d) ? d : Buffer.from(d);
    arrivals.push(performance.now());
    bytes += b.length;
  });
});

await new Promise((ok) => setTimeout(ok, 50));                    // cho addClient xong
arrivals.length = 0;

// Bom theo kieu "dien thoai gui": moi dot BURST khung (BURST x 640 byte) cach nhau EVERY_MS.
const t0 = performance.now();
let sent = 0;
let idx = 0;
const burstMs = BURST * FRAME_MS;
await new Promise((done) => {
  const timer = setInterval(() => {
    const chunk = Buffer.alloc(BURST * FRAME_BYTES);
    for (let k = 0; k < BURST; k++) {
      pcm.copy(chunk, k * FRAME_BYTES, ((idx + k) % totalFrames) * FRAME_BYTES, ((idx + k) % totalFrames) * FRAME_BYTES + FRAME_BYTES);
    }
    idx += BURST;
    sendToSpeaker(DEV, chunk);
    sent += BURST;
    if (performance.now() - t0 > SECONDS * 1000) { clearInterval(timer); done(); }
  }, Math.max(EVERY_MS, burstMs));
});

await new Promise((ok) => setTimeout(ok, 400));                   // cho cac khung con trong bo dem nhip ra not

const gaps = [];
for (let i = 1; i < arrivals.length; i++) gaps.push(arrivals[i] - arrivals[i - 1]);
const sorted = [...gaps].sort((a, b) => a - b);
const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const mean = gaps.reduce((a, x) => a + x, 0) / (gaps.length || 1);
const over80 = gaps.filter((g) => g > 80).length;
const exact20 = gaps.filter((g) => g >= 15 && g <= 25).length;
const bursty = gaps.filter((g) => g <= 3).length;                 // hai goi den gan nhu cung luc = bun no

console.log(`\n── do nhip gui: file=${FILE} burst=${BURST} khung / ${Math.max(EVERY_MS, burstMs)} ms, ${SECONDS} s`);
console.log(`   CCR_CALL_PACE=${process.env.CCR_CALL_PACE ?? '(mac dinh = 1)'}`);
console.log(`   gui ${sent} khung (${sent * FRAME_MS} ms tieng) — nhan ${arrivals.length} goi, ${bytes} byte`);
console.log(`   khoang cach goi: trung vi ${q(0.5).toFixed(1)} ms | trung binh ${mean.toFixed(1)} ms | p95 ${q(0.95).toFixed(1)} ms | MAX ${(sorted.at(-1) ?? 0).toFixed(1)} ms`);
console.log(`   so khoang cach > 80 ms: ${over80}  (${((over80 / (gaps.length || 1)) * 100).toFixed(1)} %)`);
console.log(`   goi cach nhau 15-25 ms (nhip chuan 20 ms): ${exact20}/${gaps.length}`);
console.log(`   cap goi den gan nhu CUNG LUC (<= 3 ms, = bun no): ${bursty}\n`);

wss.close();
process.exit(0);
