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
let leftover: Buffer = Buffer.alloc(0);
const subscribers = new Set<string>();

function feedChunk(chunk: Buffer): void {
  if (subscribers.size === 0) return; // khong ai can nghe -> bo qua (khong ton CPU dong goi)

  let buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
  let off = 0;
  while (buf.length - off >= FRAME_BYTES) {
    const frame = buf.subarray(off, off + FRAME_BYTES);
    for (const id of subscribers) broadcaster.sendAudioFrame(id, frame);
    off += FRAME_BYTES;
  }
  leftover = off < buf.length ? Buffer.from(buf.subarray(off)) : Buffer.alloc(0);
}

function startCapture(): void {
  // Dang co tien trinh song, HOAC dang doi tien trinh cu thoat han (SIGTERM
  // vua gui) — nhanh nay se duoc goi lai tu handler 'exit' khi that su san
  // sang, khong spawn chong len tien trinh cu.
  if (ffmpegProc || stopping) return;

  console.log(`[audio] Bat dau bat am thanh tu ${PULSE_MONITOR_SOURCE} (${AUDIO_SAMPLE_RATE}Hz/${AUDIO_BITS}bit/${AUDIO_CHANNELS}ch)`);

  const proc = spawn('ffmpeg', [
    // (23/09/2026 v3) SUA LOI THAT DA GAP: khong dat -fragment_size, ffmpeg
    // de PulseAudio tu chon kich thuoc doan mac dinh cho monitor source —
    // do that tren may that: PulseAudio don du lieu thanh cac dot lon cach
    // nhau DUNG ~2.0 GIAY (kiem chung qua log ESPHome that: Starting o
    // t=1.2s/3.1s/5.1s/7.1s/9.1s/11.1s — deu nhau tuyet doi). Giua hai dot,
    // ring buffer phia loa (88200 byte, ~2.75s o 16kHz) can kiet -> tu dong
    // "Stopped", chi "Starting" lai khi dot moi toi -> ket qua nghe duoc la
    // am thanh bi cat vun 0.6-0.8s moi ~2s, gan nhu khong nghe ra. 1024 byte
    // (~32ms o 16kHz/16bit/mono) ep PulseAudio giao doan nho, gan lien tuc.
    '-fragment_size', '1024',
    '-f', 'pulse',
    '-i', PULSE_MONITOR_SOURCE,
    '-ac', String(AUDIO_CHANNELS),
    '-ar', String(AUDIO_SAMPLE_RATE),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    // (23/09/2026 v4) BO -flush_packets 1: khong co tac dung voi dau ra
    // s16le tho (khong co khai niem "packet"/muxer that su) — chi lam
    // ffmpeg spam canh bao "non monotonically increasing dts" moi vong doi
    // tien trinh, khong giup gi cho do tre thuc te (do la -fragment_size o
    // dau vao moi giai quyet).
    '-loglevel', 'error',
    'pipe:1',
  ]);
  ffmpegProc = proc;

  proc.stdout.on('data', feedChunk);
  proc.stderr.on('data', (d: Buffer) => console.warn(`[audio] ffmpeg: ${d.toString().trim()}`));

  proc.on('exit', (code, signal) => {
    const wasDeliberate = stopping; // ta tu kill() de dung/khoi dong lai, khong phai loi that
    console.warn(`[audio] ffmpeg thoat (code=${code}, signal=${signal}, chu dong=${wasDeliberate})`);
    ffmpegProc = null;
    stopping = false;
    leftover = Buffer.alloc(0);

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
  if (ffmpegProc && !stopping) {
    console.log('[audio] Dung bat am thanh (khong con thiet bi nao can nghe)');
    stopping = true;
    ffmpegProc.kill('SIGTERM');
    // KHONG null hoa ffmpegProc o day — xem chu thich o dau file.
  }
  leftover = Buffer.alloc(0);
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
