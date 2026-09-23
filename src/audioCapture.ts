// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).

// (23/09/2026) Bat am thanh Chrome dua ra qua sink PulseAudio ao (xem
// docker-entrypoint.sh), phat lai qua WebSocket cho thiet bi da bao co loa
// (cfg.audioEnabled — xem config.ts, ensureDeviceAsync). Kien truc: MOT
// tien trinh Chrome dung chung cho ca ba thiet bi -> MOT sink audio duy
// nhat -> khong the tach am thanh theo tung tab/thiet bi (da xac minh khong
// co API nao lam duoc dieu nay tu ben ngoai trang — xem
// AUDIO-FEATURE-PLAN-2026-09-23.md muc 7.2 o repo Client). Vi vay module
// nay CHI gui cho cac thiet bi TU KHAI BAO audioEnabled=true (hien tai:
// chi P4) — khong co logic "chon thiet bi dang hoat dong" vi pham vi hien
// tai chi co dung mot dich.
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { broadcaster } from './deviceManager.js';

const PULSE_MONITOR_SOURCE = process.env.PULSE_AUDIO_MONITOR || 'chrome_out.monitor';
const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;
const AUDIO_BITS = 16;
// (23/09/2026) Kich thuoc khung gui ~40ms/goi (16000 * 2 byte/mau * 0.04s =
// 1280 byte) — du nho de khong tao do tre lon, du lon de khong lam ngap so
// luong goi WS/giay (25 goi/s, tuong duong nhip video luc tai vua phai).
const FRAME_BYTES = Math.round(AUDIO_SAMPLE_RATE * (AUDIO_BITS / 8) * AUDIO_CHANNELS * 0.04);

let ffmpegProc: ChildProcessWithoutNullStreams | null = null;
// (23/09/2026 v2) SUA LOI THAT DA GAP: dat ffmpegProc = null NGAY sau khi
// goi .kill() (khong doi su kien 'exit' that su) tao ke ho — neu thiet bi
// disconnect/reconnect rat nhanh (do that: 309ms), startCapture() moi thay
// ffmpegProc == null nen spawn tien trinh THU HAI trong khi tien trinh CU
// co the con dang giu nguon PulseAudio (chua kip don xong sau SIGTERM) ->
// tien trinh moi bi tu choi, thoat ngay voi code 255. Sua: KHONG null hoa
// ffmpegProc trong stopCapture(); chi handler 'exit' (xac nhan tien trinh
// THAT SU da ket thuc) moi duoc phep null hoa va (neu can) khoi dong lai.
let stopping = false;
let restartTimer: NodeJS.Timeout | null = null;
const subscribers = new Set<string>();

// (23/09/2026 v8) SUA LOI THAT DA GAP: truoc day feedChunk() gui NGAY moi
// khi ffmpeg co du lieu — nhung PulseAudio/ffmpeg khong giao du lieu deu,
// ma theo tung DOT LON cach nhau ~2s (do that, xem CHANGELOG V2.9.11/13).
// Gui thang nghia la firmware nhan CA DOT (hang chuc goi) don don trong
// vai chuc ms roi IM LANG ~2s — hang doi phia thiet bi (dau da tach rieng,
// sau 30) van bi TRAN ngay tai moi dot ("hang doi day, rot goi" do that).
//
// Sua tan goc: bo dem jitter (jitterBuf) + nhip gui CO DINH moi
// FRAME_MS bang setInterval — accumulateFromFfmpeg() CHI gom du lieu vao
// bo dem, KHONG gui gi ca; drainTick() (chay dung nhip, doc lap voi luc
// ffmpeg giao du lieu) moi thuc su cat 1 khung va gui di. Nho vay thiet bi
// luon nhan dung nhip ~25 goi/giay bat ke ffmpeg giao don hay deu, giong
// het vai tro "jitter buffer" chuan trong moi he thong streaming audio.
const FRAME_MS = 40;
const MAX_JITTER_BYTES = FRAME_BYTES * 25; // ~1s du phong — qua do la ffmpeg dang vuot xa toc do phat thuc, bo bot du lieu CU nhat de khoi tre dan
let jitterBuf: Buffer = Buffer.alloc(0);
let jitterTimer: NodeJS.Timeout | null = null;

function accumulateFromFfmpeg(chunk: Buffer): void {
  if (subscribers.size === 0) return; // khong ai can nghe -> bo qua (khong ton CPU/RAM dem)
  jitterBuf = jitterBuf.length ? Buffer.concat([jitterBuf, chunk]) : chunk;
  if (jitterBuf.length > MAX_JITTER_BYTES) {
    // ffmpeg dang giao nhanh hon toc do phat that su cua thiet bi (vd sau
    // mot khoang gian doan mang) — cat bot phan CU nhat, giu do tre thap
    // thay vi de bo dem phinh to va am thanh ngay cang tre so voi hinh.
    jitterBuf = jitterBuf.subarray(jitterBuf.length - MAX_JITTER_BYTES);
  }
}

function drainTick(): void {
  if (jitterBuf.length < FRAME_BYTES || subscribers.size === 0) return;
  const frame = jitterBuf.subarray(0, FRAME_BYTES);
  jitterBuf = jitterBuf.subarray(FRAME_BYTES);
  for (const id of subscribers) broadcaster.sendAudioFrame(id, frame);
}

function startCapture(): void {
  // Dang co tien trinh song, HOAC dang doi tien trinh cu thoat han (SIGTERM
  // vua gui) — nhanh nay se duoc goi lai tu handler 'exit' khi that su san
  // sang, khong spawn chong len tien trinh cu.
  if (ffmpegProc || stopping) return;

  console.log(`[audio] Bat dau bat am thanh tu ${PULSE_MONITOR_SOURCE} (${AUDIO_SAMPLE_RATE}Hz/${AUDIO_BITS}bit/${AUDIO_CHANNELS}ch)`);

  const proc = spawn('ffmpeg', [
    // (23/09/2026 v7) SUA LOI THAT DA GAP: -fragment_size 1024 (them o v3,
    // voi gia thuyet SAI la no gay chu ky Starting/Stopped ~2.0s — da bac bo,
    // xem CHANGELOG V2.9.12) hoa ra con gay mot loi khac nghiem trong hon:
    // kiem chung tren may that, ffmpeg spam canh bao "Application provided
    // invalid, non monotonically increasing dts to muxer" HANG CHUC LAN MOI
    // GIAY lien tuc khi co -fragment_size — nghi ngo day chinh la ly do
    // KHONG CON goi AudioFrame nao toi duoc thiet bi (server-side pipeline tu
    // no da hong, khong lien quan gi toi hang doi/task rieng da tach o
    // firmware). Bo han -fragment_size, quay ve mac dinh cua PulseAudio cho
    // pulse input — don gian hon va khong con dau hieu loi nay.
    '-f', 'pulse',
    '-i', PULSE_MONITOR_SOURCE,
    '-ac', String(AUDIO_CHANNELS),
    '-ar', String(AUDIO_SAMPLE_RATE),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-loglevel', 'error',
    'pipe:1',
  ]);
  ffmpegProc = proc;
  jitterBuf = Buffer.alloc(0);
  if (!jitterTimer) jitterTimer = setInterval(drainTick, FRAME_MS);

  proc.stdout.on('data', accumulateFromFfmpeg);
  proc.stderr.on('data', (d: Buffer) => console.warn(`[audio] ffmpeg: ${d.toString().trim()}`));

  proc.on('exit', (code, signal) => {
    const wasDeliberate = stopping; // ta tu kill() de dung/khoi dong lai, khong phai loi that
    console.warn(`[audio] ffmpeg thoat (code=${code}, signal=${signal}, chu dong=${wasDeliberate})`);
    ffmpegProc = null;
    stopping = false;
    jitterBuf = Buffer.alloc(0);

    if (subscribers.size === 0) return; // khong ai can nghe nua -> khong khoi dong lai

    if (restartTimer) return; // da co lich khoi dong lai roi
    // Thoat CHU DONG (ta vua kill de restart nhanh, vd do subscriber doi
    // lien tuc) -> thu lai gan nhu ngay. Thoat NGOAI Y MUON (loi that,
    // PulseAudio gian doan...) -> doi lau hon, tranh vong lap loi lien tuc.
    const delayMs = wasDeliberate ? 200 : 3000;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (subscribers.size > 0) startCapture();
    }, delayMs);
  });

  proc.on('error', (err) => {
    console.error(`[audio] Khong chay duoc ffmpeg: ${err.message}`);
    ffmpegProc = null;
    stopping = false;
  });
}

function stopCapture(): void {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (jitterTimer) { clearInterval(jitterTimer); jitterTimer = null; }
  if (ffmpegProc && !stopping) {
    console.log('[audio] Dung bat am thanh (khong con thiet bi nao can nghe)');
    stopping = true;
    ffmpegProc.kill('SIGTERM');
    // KHONG null hoa ffmpegProc o day — xem chu thich o dau file.
  }
  jitterBuf = Buffer.alloc(0);
}

export function subscribeDeviceAudio(id: string): void {
  if (subscribers.has(id)) return;
  subscribers.add(id);
  console.log(`[audio] ${id} dang ky nhan audio (${subscribers.size} thiet bi)`);
  startCapture();
}

export function unsubscribeDeviceAudio(id: string): void {
  if (!subscribers.delete(id)) return;
  console.log(`[audio] ${id} huy dang ky nhan audio (${subscribers.size} thiet bi con lai)`);
  if (subscribers.size === 0) stopCapture();
}
