// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) INTERCOM — GIAI DOAN 0 (thu nghiem): cau noi TIENG giua mot man va mot dau goi (trang thu trong trinh
// duyet qua ingress, hoac phep do vong lap cua chinh server).
//   - Man -> server: MicFrame (firmware bat khi nhan ControlField.Call = 1; tieng da khu vong).
//   - Server -> man: AudioFrame gui RIENG man do; trong luc goi tieng Chrome KHONG gui toi man nay (audioCapture.callHold).
// API:
//   GET  /call/devices                 man goi duoc (co mic cuoc goi + loa) — ingress / 127.0.0.1
//   WS   /call/ws?dev=<id>             trang thu: gui PCM s16le mono 16 kHz, nhan PCM mic cua man — ingress / 127.0.0.1
//   POST /call/test/loop?dev=&aec=0|1  do vong lap: bip ra loa man -> mic thu lai (do tre khu hoi, muc vong) — 127.0.0.1
//   WS   /call/video?dev=<id>          HINH camera man (dung chung ket noi /live voi Frigate — src/mkvLive.ts): tin text dau
//                                      {codec, avcc(base64)}, roi khung nhi phan [co: 1 = khung khoa][ts u32le ms] + AVCC
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

import { newAgcState, processPcm, AGC_ENABLED, type AgcState } from './audioAgc.js';
import { callHold } from './audioCapture.js';
import { subscribeLiveFrames } from './camProxy.js';
import { isDoor, subscribeDoorFrames } from './door.js';
import { isCallParty, isWebSource, subscribeWebFrames, videoAllowed, videoSourceOf } from './calls.js';
import { broadcaster, connectedScreens } from './deviceManager.js';
import { ControlField } from './protocol.js';

export const SAMPLE_RATE = 16000;
export const FRAME_BYTES = 640;   // 20 ms

interface Leg {
  dev: string;
  peers: Set<WebSocket>;
  listeners: Set<(pcm: Buffer, at: number) => void>;
  startedAt: number;
  micFrames: number;
  lost: number;
  lastSeq: number;
  /** (14/10/2026) Thiet bi dau kia (vd man <-> chuong cong): tieng mic cua leg nay phat ra loa cua no. */
  link?: string;
  /** (14/10/2026) Tat mic: khong chuyen tieng cua leg nay sang dau kia. */
  muted?: boolean;
}
const calls = new Map<string, Leg>();
/** (31/10/2026) Gain AGC/limiter rieng cho tung man (xem src/audioAgc.ts) — chi cho nhanh xuong LOA MAN. */
const agc = new Map<string, AgcState>();

export function isInCall(dev: string): boolean { return calls.has(dev); }

export function startCall(dev: string): Leg | null {
  if (calls.has(dev)) return null;
  const leg: Leg = { dev, peers: new Set(), listeners: new Set(), startedAt: Date.now(), micFrames: 0, lost: 0, lastSeq: -1 };
  calls.set(dev, leg);
  callHold.add(dev);
  broadcaster.sendDeviceControl(dev, ControlField.Call, 1);
  console.log(`[call] ${dev}: bat dau cuoc goi`);
  return leg;
}

export function endCall(dev: string): void {
  const leg = calls.get(dev);
  if (!leg) return;
  calls.delete(dev);
  agc.delete(dev);
  callHold.delete(dev);
  broadcaster.sendDeviceControl(dev, ControlField.Call, 0);
  for (const p of leg.peers) { try { p.close(1000, 'het cuoc goi'); } catch { /* */ } }
  const s = Math.round((Date.now() - leg.startedAt) / 1000);
  console.log(`[call] ${dev}: ket thuc sau ${s} s — mic ${leg.micFrames} goi (le ra ~${s * 50}), mat ${leg.lost}`);
}

/** Goi MicFrame tu thiet bi: [type][ver][seq u16le] + PCM. */
export function onMicFrame(dev: string, buf: Buffer): void {
  const leg = calls.get(dev);
  if (!leg || buf.length <= 4) return;
  const seq = buf.readUInt16LE(2);
  if (leg.lastSeq >= 0) leg.lost += (seq - leg.lastSeq - 1 + 65536) % 65536;
  leg.lastSeq = seq;
  leg.micFrames++;
  const pcm = buf.subarray(4);
  const at = Date.now();
  for (const p of leg.peers) if (p.readyState === WebSocket.OPEN && p.bufferedAmount < 64 * 1024) p.send(pcm);
  if (leg.link && !leg.muted && calls.has(leg.link)) sendToSpeaker(leg.link, pcm);
  for (const f of leg.listeners) f(pcm, at);
}

/** (14/10/2026) Noi tieng hai chieu giua hai thiet bi DANG trong cuoc goi (man <-> chuong cong). */
export function linkCalls(a: string, b: string): boolean {
  const la = calls.get(a), lb = calls.get(b);
  if (!la || !lb) return false;
  la.link = b; lb.link = a;
  console.log(`[call] noi tieng ${a} <-> ${b}`);
  return true;
}

/** (14/10/2026) Nghe tieng mic cua man trong cuoc goi (tong dai cuoc goi video gui sang trinh duyet). Tra ham huy. */
export function onMicListener(dev: string, fn: (pcm: Buffer) => void): () => void {
  const l = calls.get(dev);
  if (!l) return () => { };
  const f = (pcm: Buffer) => fn(pcm);
  l.listeners.add(f);
  return () => { l.listeners.delete(f); };
}

export function setMuted(dev: string, on: boolean): boolean { const l = calls.get(dev); if (!l) return false; l.muted = on; return true; }

/** Tieng cua dau goi xuong loa man (chia dung khung 20 ms). */
export function sendToDevice(dev: string, pcm: Buffer): void {
  for (let o = 0; o + 1 < pcm.length; o += FRAME_BYTES) broadcaster.sendAudioFrame(dev, pcm.subarray(o, Math.min(pcm.length, o + FRAME_BYTES)));
}

/**
 * (31/10/2026) Tieng MIC -> LOA MAN co AGC + limiter (src/audioAgc.ts). Day la duong DUY NHAT xuong loa man cho
 * tieng nguoi noi (trang goi -> man, chuong cong -> man); tieng may phat ra (bip do vong lap) van di thang qua
 * `sendToDevice` de phep do khong bi AGC lam sai lech.
 *   - Muc nham -18 dBFS, attack 5 ms / release 200 ms, gain [-6 dB, +24 dB], limiter mem -1 dBFS.
 *   - Khong im lang: khung < -60 dBFS di nguyen (khong khuech dai nhieu nen phong).
 *   - Khong them do tre (xu ly tung khung 20 ms) va KHONG doi kich thuoc goi (vao 640 byte, ra 640 byte).
 *   - Tat bang env CCR_CALL_AGC=0 (A/B: so sanh truc tiep tren cung mot cuoc goi).
 */
export function sendToSpeaker(dev: string, pcm: Buffer): void {
  if (!AGC_ENABLED) { sendToDevice(dev, pcm); return; }
  let st = agc.get(dev);
  if (!st) { st = newAgcState(); agc.set(dev, st); }
  sendToDevice(dev, processPcm(pcm, st));
}

// ── Do vong lap ──────────────────────────────────────────────────────────────────────────────────────────────
/** RMS (0..1) cua mot khung PCM s16le. */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / n);
}
export const db = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120);
/** Bien do (0..1) thanh phan tan so `hz` trong khung (Goertzel) — tach tieng bip khoi tieng on nen. */
export function toneLevel(pcm: Buffer, hz: number): number {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  const k = 2 * Math.cos(2 * Math.PI * hz / SAMPLE_RATE);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s0 = pcm.readInt16LE(i * 2) / 32768 + k * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) * 2 / n;
}

function tone(ms: number, hz: number, amp: number, offsetSamples: number): Buffer {
  const n = Math.round(SAMPLE_RATE * ms / 1000), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * (i + offsetSamples) / SAMPLE_RATE) * amp * 32767), i * 2);
  return b;
}

export interface BeepResult { latMs: number | null; peakDb: number }
/** Phan tich (muc 1 kHz moi khung): nen = trung vi truoc tieng bip dau; moi bip: khung dau tien vuot nen x4 (> -60 dB) trong 1 s. */
export function analyze(frames: { at: number; r: number }[], beepAt: number[]): { floorDb: number; beeps: BeepResult[] } {
  const pre = frames.filter((f) => f.at < beepAt[0]).map((f) => f.r).sort((a, b) => a - b);
  const floor = pre.length ? pre[Math.floor(pre.length / 2)] : 0;
  const thr = Math.max(floor * 4, 10 ** (-60 / 20));
  const beeps = beepAt.map((t) => {
    const win = frames.filter((f) => f.at >= t && f.at < t + 1000);
    const hit = win.find((f) => f.r > thr);
    const peak = win.reduce((m, f) => Math.max(m, f.r), 0);
    return { latMs: hit ? hit.at - t : null, peakDb: db(peak) };
  });
  return { floorDb: db(floor), beeps };
}

async function loopTest(dev: string, aec: boolean): Promise<unknown> {
  broadcaster.sendDeviceControl(dev, ControlField.Aec, aec ? 1 : 0);
  const leg = startCall(dev);
  if (!leg) throw new Error('man dang trong cuoc goi');
  const frames: { at: number; r: number }[] = [];
  const raw: Buffer[] = [];
  leg.listeners.add((pcm, at) => { frames.push({ at, r: toneLevel(pcm, 1000) }); raw.push(Buffer.from(pcm)); });
  const beepAt: number[] = [];
  // 1,5 s im lang (do nen) roi 5 tieng bip 1 kHz 200 ms, cach 1,2 s; giu nhip 20 ms bang khung im lang.
  const plan = [1500, 2700, 3900, 5100, 6300];
  const t0 = Date.now();
  let sent = 0;
  await new Promise<void>((done) => {
    const iv = setInterval(() => {
      const el = Date.now() - t0;
      while (sent * 20 <= el) {
        const at = sent * 20;
        const b = plan.findIndex((p) => at >= p && at < p + 200);
        if (b >= 0 && at === plan[b]) beepAt.push(Date.now());
        sendToDevice(dev, b >= 0 ? tone(20, 1000, 0.35, (at - plan[b]) * SAMPLE_RATE / 1000) : Buffer.alloc(FRAME_BYTES));
        sent++;
      }
      if (el > 7800) { clearInterval(iv); done(); }
    }, 10);
  });
  const stats = { micFrames: leg.micFrames, lost: leg.lost, ms: Date.now() - leg.startedAt };
  endCall(dev);
  // Ban thu tho (chan doan): /tmp/call-loop-aec<0|1>.raw (s16le mono 16 kHz) trong container.
  import('node:fs').then((fs) => fs.promises.writeFile(`/tmp/call-loop-aec${aec ? 1 : 0}.raw`, Buffer.concat(raw))).catch(() => { });
  if (!aec) broadcaster.sendDeviceControl(dev, ControlField.Aec, 1);   // tra ve mac dinh (bat khu vong)
  return { dev, aec, ...stats, ...analyze(frames, beepAt) };
}

// ── HTTP + WS ────────────────────────────────────────────────────────────────────────────────────────────────
const isLocal = (req: http.IncomingMessage) => /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
const isIngress = (req: http.IncomingMessage) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
export function callableScreens(): { id: string; w: number; h: number; busy: boolean }[] {
  return connectedScreens().filter((s) => s.mic && s.spk).map((s) => ({ id: s.id, w: s.w, h: s.h, busy: calls.has(s.id) }));
}

/** true = da xu ly request. */
export function handleCallApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/call/')) return false;
  if (!isLocal(req) && !isIngress(req)) { json(res, 403, { error: 'Chỉ dùng trong Home Assistant.' }); return true; }
  if (p === '/call/devices' && req.method === 'GET') { json(res, 200, callableScreens()); return true; }
  if (p === '/call/test/loop' && req.method === 'POST' && isLocal(req)) {
    const dev = url.searchParams.get('dev') || '';
    if (!callableScreens().some((s) => s.id === dev)) { json(res, 404, { error: 'man khong goi duoc' }); return true; }
    loopTest(dev, url.searchParams.get('aec') !== '0').then((r) => json(res, 200, r)).catch((e) => json(res, 409, { error: (e as Error).message }));
    return true;
  }
  json(res, 404, { error: 'khong co' });
  return true;
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
/** Nang cap WS /call/ws va /call/video (cong HEALTH_PORT). true = da nhan. */
export function handleCallUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname.endsWith('/call/video')) return videoUpgrade(req, socket, head, url);
  if (!url.pathname.endsWith('/call/ws')) return false;
  if (!isLocal(req) && !isIngress(req)) { socket.destroy(); return true; }
  const dev = url.searchParams.get('dev') || '';
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!callableScreens().some((s) => s.id === dev)) { ws.close(4004, 'man khong goi duoc'); return; }
    const leg = startCall(dev);
    if (!leg) { ws.close(4009, 'man dang ban'); return; }
    leg.peers.add(ws);
    ws.on('message', (data, isBinary) => { if (isBinary) sendToDevice(dev, data as Buffer); });
    ws.on('close', () => { leg.peers.delete(ws); if (calls.get(dev) === leg) endCall(dev); });
    ws.on('error', () => { /* close xu ly */ });
  });
  return true;
}

/** Hinh camera man qua WS. Mang cham (dem > 1 MB): bo khung thuong toi khung khoa ke tiep (khong de tre don lai). */
function videoUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean {
  if (!isLocal(req) && !isIngress(req)) { socket.destroy(); return true; }
  const dev = url.searchParams.get('dev') || '';
  // (17/11/2026) GD9 — SUA LOI "P4 KHONG NHAN DUOC HINH khi goi dien thoai": trang P4 lay `peer` tu /calls/state;
  // trong khoang app da POST /app/answer nhung trang call-web.html?call= CHUA kip `join`, `state.to` van la ID MAY,
  // nen P4 mo `/call/video?dev=<id may>` -> khong phai phien web / khong phai man co camera -> server dong 4004 va
  // P4 chi hien "Đang kết nối hình…" mai mai (du tieng van chay).
  // Nay: (a) id may duoc anh xa sang phien web dang giu cuoc goi cua may do (videoSourceOf), va (b) neu dien thoai
  // CHUA join thi giu socket lai ~8 s, tu gan nguon ngay khi phien web xuat hien (khong bat trang phai doan lai).
  if (!isDoor(dev) && !isWebSource(dev) && !connectedScreens().some((s) => s.id === dev && s.cam) && !isCallParty(dev)) {
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(4004, 'nguon khong co camera'));
    return true;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // (14/10/2026) ?call=<id>: hinh trong cuoc goi video — chi gui khi cuoc goi dang chay va nguon khong tat camera.
    const callId = url.searchParams.get('call');
    let unsub = (): void => { };
    let src = '';
    let sent = 0, dropped = 0, skip = false;
    const t0 = Date.now();
    /** Gan nguon hinh that su; false = nguon chua san sang (dien thoai chua `join`). */
    const attach = (): boolean => {
      const s = videoSourceOf(dev);
      const door = isDoor(s), web = isWebSource(s);
      if (!door && !web && !connectedScreens().some((x) => x.id === s && x.cam)) return false;
      src = s;
      if (s !== dev) console.log(`[call] ${dev}: xem hinh qua phien web ${s}`);
      unsub = (door ? subscribeDoorFrames : web ? subscribeWebFrames : subscribeLiveFrames)(s, (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (callId && e.kind === 'frame' && !videoAllowed(callId, s)) { skip = true; return; }
        if (e.kind === 'config') { ws.send(JSON.stringify({ codec: e.codec, avcc: e.avcc.toString('base64') })); return; }
        if (ws.bufferedAmount > 1024 * 1024) skip = true;
        if (skip && !e.key) { dropped++; return; }
        skip = false;
        const h = Buffer.alloc(5);
        h.writeUInt8(e.key ? 1 : 0, 0); h.writeUInt32LE(e.ts >>> 0, 1);
        ws.send(Buffer.concat([h, e.data])); sent++;
      });
      console.log(`[call] ${dev}: xem hinh camera (nguon ${s})`);
      return true;
    };

    let wait: NodeJS.Timeout | null = null;
    if (!attach()) {
      // Dien thoai da nghe nhung trang goi chua kip `join` (thuong < 2 s) -> cho toi 8 s.
      let waited = 0;
      wait = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) { clearInterval(wait!); wait = null; return; }
        if (attach()) { clearInterval(wait!); wait = null; return; }
        waited += 400;
        if (waited >= 8_000) {
          clearInterval(wait!); wait = null;
          console.log(`[call] ${dev}: khong tim thay nguon hinh sau 8 s — dong`);
          ws.close(4004, 'chua co nguon hinh');
        }
      }, 400);
    }
    ws.on('close', () => {
      if (wait) { clearInterval(wait); wait = null; }
      unsub();
      console.log(`[call] ${dev}: ngung xem hinh sau ${Math.round((Date.now() - t0) / 1000)} s — gui ${sent} khung, bo ${dropped}`);
    });
    ws.on('error', () => { /* close xu ly */ });
  });
  return true;
}
