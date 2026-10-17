// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) CHUONG CONG (INTERCOM GD1): thiet bi ESP32-S3 CAM khong man hinh, ket noi WS rieng (?door=1&mic=1&audio=1
// &mj=<cong MJPEG>&sn=<cong anh chup>&name=<ten>). Server:
//   - nut bam (DeviceEvent Doorbell) -> do chuong cac man (door.html), chong bam lien tiep, su kien HA darboard_doorbell;
//     het gio khong ai nghe -> cuoc goi nho (thong bao kem anh khach).
//   - hinh MJPEG (esp32_camera_web_server) chia cho nhieu nguoi xem (WS /call/video).
//   - Nghe: noi tieng hai chieu man <-> chuong (callBridge). Mo cong: ControlField.Gate (MOSFET tren chuong).
//   - vong LED theo trang thai (ControlField.DoorState).
// API (chi trang trong Chromium cua add-on, 127.0.0.1): POST /door/answer|decline|hangup|gate, GET /door/snap/<tep>.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { WebSocket } from 'ws';

import { endCall, linkCalls, onMicFrame, setMuted, startCall } from './callBridge.js';
import { isInternalPeer } from './camProxy.js';
import { answerDoorbell, broadcaster, closeDoorbell, connectedScreens, postNotify, ringDoorPanels } from './deviceManager.js';
import { haFetch } from './haSettings.js';
import { LOCAL_ORIGIN } from './launcherApps.js';
import type { FrameSink } from './mkvLive.js';
import { ControlField, DeviceEventKind, DoorState, MsgType, parseDeviceEventPacket } from './protocol.js';
import { telegramNotify, tgText } from './telegram.js';

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const SNAP_DIR = path.join(DATA_DIR, 'rwv-door');
// (14/10/2026) Cai dat chuong (tab "Gọi" trong Darboard -> Chuong cong): man do chuong (rong = theo firmware / moi man),
// thoi gian do chuong, thoi gian mo cong. Luu /data/rwv-door.json.
const CFG_FILE = path.join(DATA_DIR, 'rwv-door.json');
/** `known`: các chuông ĐÃ TỪNG kết nối (để trang Darboard vẫn hiện thẻ khi chuông đang offline). */
export interface KnownDoor { id: string; name: string; ip: string; at: number }
export interface DoorConfig { ringPanels: string[]; ringS: number; gateS: number; known: KnownDoor[] }
let cfg: DoorConfig = { ringPanels: [], ringS: 45, gateS: 3, known: [] };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) }; } catch { /* chua co */ }
export function doorConfig(): DoorConfig { return cfg; }
function saveCfg(): void { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg)); } catch { /* */ } }
/** (17/10/2026) Nhớ chuông đã từng kết nối (id + tên + IP) — hiện thẻ ở trang Darboard cả khi offline. */
function rememberDoor(id: string, name: string, ip: string): void {
  const k = cfg.known.filter((x) => x.id !== id);
  k.push({ id, name, ip, at: Date.now() });
  cfg.known = k.slice(-20);
  saveCfg();
}

// ── (14/10/2026) NHAT KY CHUONG CONG: anh MOI lan bam chuong (+ anh tu chup), ket qua Nho / Da nghe / Tu choi; GIU 30 NGAY
// (qua 30 ngay tu xoa — anh moi thay cho anh cu nhat). Xem lai: ung dung "Chuong cong" (door-log.html) tren moi man, cham
// thong bao "Cuoc goi nho", tab "Chuong cong" trong Darboard. /data/rwv-door/log.json + <tep>.jpg.
export type LogKind = 'ring' | 'missed' | 'answered' | 'declined' | 'shot';
export interface LogItem { f: string; ts: number; door: string; name: string; kind: LogKind; by?: string }
const LOG_FILE = path.join(SNAP_DIR, 'log.json');
const KEEP_MS = 30 * 24 * 3600_000;
let log: LogItem[] = [];
try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { /* chua co */ }
function saveLog(): void {
  try { fs.mkdirSync(SNAP_DIR, { recursive: true }); fs.writeFileSync(LOG_FILE, JSON.stringify(log)); } catch { /* */ }
}
/** Xoa anh qua 30 ngay (ca tep jpg khong con trong nhat ky — vd anh cu truoc khi co nhat ky). */
function pruneLog(): void {
  const cut = Date.now() - KEEP_MS;
  const keep = log.filter((x) => x.ts >= cut);
  const names = new Set(keep.map((x) => x.f));
  let n = 0;
  try {
    for (const f of fs.readdirSync(SNAP_DIR)) {
      if (!f.endsWith('.jpg') || names.has(f)) continue;
      const st = fs.statSync(path.join(SNAP_DIR, f));
      if (st.mtimeMs < cut || log.some((x) => x.f === f)) { fs.rmSync(path.join(SNAP_DIR, f), { force: true }); n++; }
    }
  } catch { /* */ }
  if (keep.length !== log.length || n) { log = keep; saveLog(); console.log(`[door] nhat ky: xoa ${n} anh qua 30 ngay`); }
}
setInterval(pruneLog, 3600_000);
setTimeout(pruneLog, 30_000);
function addLog(d: Door, f: string, kind: LogKind, by?: string): LogItem {
  const it: LogItem = { f, ts: Date.now(), door: d.id, name: d.name, kind, ...(by ? { by } : {}) };
  log.push(it); saveLog(); pruneLog();
  return it;
}
function setLogKind(f: string | null | undefined, kind: LogKind, by?: string): void {
  const it = f ? log.find((x) => x.f === f) : undefined;
  if (!it) return;
  it.kind = kind; if (by) it.by = by; saveLog();
}
/** (14/10/2026) Xoa anh trong nhat ky (chon nhieu tren ung dung / Darboard). Tra so anh da xoa. */
export function deleteLog(files: unknown): number {
  if (!Array.isArray(files)) return 0;
  const del = new Set(files.filter((f): f is string => typeof f === 'string' && /^[\w.-]+\.jpg$/.test(f)).slice(0, 500));
  const before = log.length;
  log = log.filter((x) => !del.has(x.f));
  for (const f of del) { try { fs.rmSync(path.join(SNAP_DIR, f), { force: true }); } catch { /* */ } }
  saveLog();
  console.log(`[door] nhat ky: xoa ${before - log.length} anh (nguoi dung)`);
  return before - log.length;
}

/** Cham thong bao "Cuoc goi nho" -> mo ung dung Chuong cong dung anh nay (trang hoi /door/log?dev=). */
const openReq = new Map<string, string>();
export function requestOpenLog(dev: string, f: string): void { if (/^[\w.-]+\.jpg$/.test(f)) openReq.set(dev, f); }
/**
 * (16/10/2026) Cai dat chuong: CHON BAT KY man nao (khong chi man co loa / camera) — man khong co loa van mo trang chuong binh thuong
 * (chi xem hinh + mo cong, khong noi chuyen). Man da chon nhung dang offline van hien (danh dau) de bo chon duoc.
 */
function doorPanelChoices(): { id: string; name: string; online: boolean }[] {
  const on = connectedScreens().filter((s) => !isDoor(s.id)).map((s) => ({ id: s.id, name: nameOf(s.id) || s.id, online: true }));
  const off = cfg.ringPanels.filter((id) => !on.some((x) => x.id === id)).map((id) => ({ id, name: nameOf(id) || id, online: false }));
  return [...on, ...off];
}
export function setDoorConfig(b: any): DoorConfig {
  const panels = Array.isArray(b?.ringPanels) ? b.ringPanels.filter((x: unknown) => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, 20) : cfg.ringPanels;
  const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  cfg = { ringPanels: panels, ringS: num(b?.ringS, 5, 300, cfg.ringS), gateS: num(b?.gateS, 1, 120, cfg.gateS), known: cfg.known };
  saveCfg();
  console.log(`[door] cai dat: do chuong ${cfg.ringPanels.length ? cfg.ringPanels.join(', ') : '(theo chuong / moi man)'}, ${cfg.ringS} s, mo cong ${cfg.gateS} s`);
  return cfg;
}

interface Door {
  id: string; name: string; ws: WebSocket; ip: string; mjPort: number; snapPort: number;
  /** Man do chuong (rong = moi man co dieu khien) — tham so `panels` cua thiet bi (id cach nhau dau phay). */
  panels: string[];
  /** Co mic + loa (module I2S) -> noi chuyen duoc; khong -> man chi xem hinh / mo cong. */
  canTalk: boolean;
  lastPress: number;
  ring: { id: string; panels: string[]; timer: NodeJS.Timeout; snap: string | null; result?: LogKind; by?: string; snapFailed?: boolean } | null;
  talk: { panel: string; since: number; ringId: string; maxT: NodeJS.Timeout } | null;
  ledT: NodeJS.Timeout | null;
}
const doors = new Map<string, Door>();
let nameOf: (id: string) => string | undefined = () => undefined;
export function setDoorHooks(h: { name: (id: string) => string | undefined }): void { nameOf = h.name; }

export function isDoor(id: string): boolean { return doors.has(id); }
export function doorList(): { id: string; name: string; busy: boolean }[] {
  return [...doors.values()].map((d) => ({ id: d.id, name: d.name, busy: !!d.talk }));
}

/**
 * (17/10/2026) Trang Darboard → "Màn hình": chuông cổng là MỘT THIẾT BỊ của hệ thống (như 3 màn) — trả về thông tin
 * đầy đủ để vẽ thẻ: id (dùng cho automation), IP, cổng MJPEG/ảnh, có mic/loa, các màn được đổ chuông, trạng thái,
 * và thống kê nhật ký 30 ngày (nhỡ / đã nghe / từ chối) + lần bấm gần nhất.
 */
export interface DoorInfo {
  id: string; name: string; online: boolean; ip: string;
  mjPort: number; snapPort: number; canTalk: boolean;
  panels: string[]; ringing: boolean; busy: boolean;
  lastPress: number | null;
  counts: { ring: number; missed: number; answered: number; declined: number };
  last: { f: string; ts: number; kind: LogKind } | null;
}
export function doorInfo(): DoorInfo[] {
  const recent = log.filter((x) => x.ts >= Date.now() - KEEP_MS);
  const count = (k: LogKind) => recent.filter((x) => x.kind === k).length;
  const last = recent.length ? recent[recent.length - 1] : null;
  const counts = { ring: count('ring'), missed: count('missed'), answered: count('answered'), declined: count('declined') };
  const lastObj = last ? { f: last.f, ts: last.ts, kind: last.kind } : null;
  const out: DoorInfo[] = [...doors.values()].map((d) => ({
    id: d.id, name: d.name, online: true, ip: d.ip,
    mjPort: d.mjPort, snapPort: d.snapPort, canTalk: d.canTalk,
    panels: d.panels, ringing: !!d.ring, busy: !!d.talk,
    lastPress: d.lastPress || null, counts, last: lastObj,
  }));
  // (17/10/2026) Chuông đã từng kết nối nhưng đang offline: vẫn trả về để Darboard giữ thẻ (online=false).
  for (const k of cfg.known) {
    if (doors.has(k.id)) continue;
    out.push({ id: k.id, name: k.name, online: false, ip: k.ip, mjPort: 0, snapPort: 0, canTalk: false, panels: [], ringing: false, busy: false,
      lastPress: k.at, counts, last: lastObj });
  }
  return out;
}

function led(d: Door, s: DoorState, backToIdleMs = 0): void {
  if (d.ledT) { clearTimeout(d.ledT); d.ledT = null; }
  broadcaster.sendDeviceControl(d.id, ControlField.DoorState, s);
  if (backToIdleMs) d.ledT = setTimeout(() => { d.ledT = null; broadcaster.sendDeviceControl(d.id, ControlField.DoorState, DoorState.Idle); }, backToIdleMs);
}

/** Ket noi WS cua chuong cong (index.ts goi khi ?door=1). */
export function attachDoor(ws: WebSocket, id: string, remote: string | undefined, params: URLSearchParams): void {
  const ip = (remote || '').replace(/^::ffff:/, '');
  const port = (k: string) => Math.max(0, Math.min(65535, parseInt(params.get(k) || '0', 10) || 0));
  const name = (params.get('name') || 'Cổng').slice(0, 40);
  const old = doors.get(id);
  if (old) { try { old.ws.close(); } catch { /* */ } }
  const panels = (params.get('panels') || '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]{1,40}$/.test(s));
  const d: Door = { id, name, ws, ip, mjPort: port('mj'), snapPort: port('sn'), panels, talk: null, canTalk: params.get('mic') === '1' && params.get('audio') === '1', lastPress: 0, ring: null, ledT: null };
  doors.set(id, d);
  rememberDoor(id, name, ip);
  broadcaster.addClient(id, ws);
  console.log(`[door] ${id} (${name}) ket noi tu ${ip} — MJPEG :${d.mjPort}, anh :${d.snapPort}${d.canTalk ? '' : ' (chua co mic / loa)'}`);
  led(d, DoorState.Idle);
  ws.on('message', (msg, isBinary) => {
    if (!isBinary) return;
    const buf: Buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer);
    const t = buf.readUInt8(0);
    if (t === MsgType.MicFrame) onMicFrame(id, buf);
    else if (t === MsgType.DeviceEvent) {
      const e = parseDeviceEventPacket(buf);
      if (e && e.kind === DeviceEventKind.Doorbell) press(d);
    }
  });
  ws.on('close', () => {
    broadcaster.removeClient(id, ws);
    if (doors.get(id) !== d) return;
    console.log(`[door] ${id} mat ket noi`);
    hangup(id, 'chuong mat ket noi');
    doors.delete(id);
  });
}

/** Khach bam nut (hoac POST /door/ring — thu / automation HA). only: chi do chuong cac man nay. */
function press(d: Door, only?: string[]): void {
  const now = Date.now();
  if (now - d.lastPress < 5000) return;          // chong bam lien tiep
  d.lastPress = now;
  if (d.talk) return;                              // dang noi chuyen: bo qua
  if (d.ring) { clearTimeout(d.ring.timer); closeDoorbell(d.ring.id); }
  const sel = only?.length ? only : cfg.ringPanels.length ? cfg.ringPanels : d.panels.length ? d.panels : undefined;
  let r = ringDoorPanels(d.id, d.name, cfg.ringS, sel, d.canTalk);
  // Cac man da chon deu offline -> do chuong tat ca man dang ket noi (con hon la khong ai thay chuong).
  if (!r.devices.length && sel) { console.log(`[door] ${d.id}: man da chon deu offline — do chuong moi man`); r = ringDoorPanels(d.id, d.name, cfg.ringS, undefined, d.canTalk); }
  d.ring = { id: r.id, panels: r.devices, timer: setTimeout(() => missed(d, r.id), cfg.ringS * 1000), snap: null };
  // Anh khach NGAY khi bam (nhat ky moi lan bam chuong); ket qua cap nhat sau.
  const ring = d.ring;
  // Nghe / tu choi TRUOC khi anh xong -> ghi dung ket qua (ring.result).
  // (16/10/2026) Telegram "co nguoi bam chuong": gui khi co anh (khong chup duoc thi gui chu).
  const tsPress = Date.now();
  snapshot(d).then((f) => {
    ring.snap = f; addLog(d, f, ring.result || 'ring', ring.by);
    telegramNotify('ring', tgText('ring', { door: d.name, ts: tsPress }), path.join(SNAP_DIR, f));
  }).catch(() => { ring.snapFailed = true; telegramNotify('ring', tgText('ring', { door: d.name, ts: tsPress })); });
  led(d, DoorState.Ringing);
  haFetch('/events/darboard_doorbell', { method: 'POST', body: JSON.stringify({ door: d.id, name: d.name, panels: r.devices }) })
    .then((x) => { if (!x.ok) console.warn(`[door] su kien HA: ${x.status}`); }).catch(() => { });
}

async function missed(d: Door, ringId: string): Promise<void> {
  if (!d.ring || d.ring.id !== ringId) return;
  const ring = d.ring;
  d.ring = null;
  led(d, DoorState.Missed, 60_000);
  let img = ring.snap;
  if (!img) { img = await snapshot(d).catch(() => null); if (img) addLog(d, img, 'missed'); }
  else setLogKind(img, 'missed');
  // Cham thong bao -> ung dung "Chuong cong" mo dung anh nay (xem lai bat cu luc nao trong 30 ngay).
  postNotify({ title: 'Cuộc gọi nhỡ ở cổng', message: `${d.name}: không ai nghe lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
    priority: 'high', device: 'all', app: 'doorlog', missed: true, ...(img ? { arg: img, image: `${LOCAL_ORIGIN}/door/snap/${img}` } : {}) });
  console.log(`[door] ${d.id}: cuoc goi nho${img ? ' (co anh)' : ''}`);
  telegramNotify('missed', tgText('missed', { door: d.name, ringS: cfg.ringS }), img ? path.join(SNAP_DIR, img) : null);
}

/** Anh khach (cong anh chup) -> /data/rwv-door/<ten>.jpg; giu 30 anh moi nhat. */
function snapshot(d: Door): Promise<string> {
  return new Promise((ok, fail) => {
    if (!d.snapPort) return fail(new Error('khong co cong anh'));
    const rq = http.get({ host: d.ip, port: d.snapPort, path: '/', timeout: 5000 }, (r) => {
      const parts: Buffer[] = [];
      r.on('data', (c: Buffer) => parts.push(c));
      r.on('end', () => {
        const b = Buffer.concat(parts);
        if (r.statusCode !== 200 || b.length < 100 || b[0] !== 0xff || b[1] !== 0xd8) return fail(new Error('anh hong'));
        fs.mkdirSync(SNAP_DIR, { recursive: true });
        const name = `${d.id}-${Date.now()}.jpg`;
        fs.writeFileSync(path.join(SNAP_DIR, name), b);
        ok(name);
      });
    });
    rq.on('timeout', () => rq.destroy(new Error('het gio')));
    rq.on('error', fail);
  });
}

function doorOfRing(ringId: string): Door | undefined { return [...doors.values()].find((d) => d.ring?.id === ringId); }

/** Man `panel` bam Nghe: dong chuong tren man khac, noi tieng hai chieu. */
export function answer(ringId: string, panel: string): { ok: boolean; error?: string } {
  const d = doorOfRing(ringId);
  if (!d || !d.ring) return { ok: false, error: 'Cuộc gọi đã kết thúc.' };
  clearTimeout(d.ring.timer);
  d.ring.result = 'answered'; d.ring.by = panel;
  setLogKind(d.ring.snap, 'answered', panel);
  d.ring = null;
  answerDoorbell(ringId, panel);
  if (!startCall(d.id) || !startCall(panel)) { endCall(d.id); endCall(panel); return { ok: false, error: 'Màn hoặc chuông đang bận.' }; }
  linkCalls(d.id, panel);
  d.talk = { panel, since: Date.now(), ringId, maxT: setTimeout(() => hangup(d.id, 'qua 10 phut'), 10 * 60_000) };
  led(d, DoorState.Talking);
  console.log(`[door] ${d.id}: ${panel} nghe`);
  return { ok: true };
}

/** Tu choi (dang do chuong): dong tren moi man. */
export function decline(ringId: string): boolean {
  const d = doorOfRing(ringId);
  if (!d || !d.ring) return false;
  clearTimeout(d.ring.timer);
  d.ring.result = 'declined';
  setLogKind(d.ring.snap, 'declined');
  const ring = d.ring;
  d.ring = null;
  // Telegram: tu choi NGAY sau khi bam thi anh co the chua xong — doi toi 6 s.
  const ts = Date.now();
  (async () => {
    for (let i = 0; i < 30 && !ring.snap && !ring.snapFailed; i++) await new Promise((r) => setTimeout(r, 200));
    telegramNotify('declined', tgText('declined', { door: d.name, ts }), ring.snap ? path.join(SNAP_DIR, ring.snap) : null);
  })().catch(() => { });
  closeDoorbell(ringId);
  led(d, DoorState.Idle);
  console.log(`[door] ${d.id}: tu choi`);
  return true;
}

/** Ket thuc cuoc noi chuyen. */
export function hangup(doorId: string, why = 'ket thuc'): boolean {
  const d = doors.get(doorId);
  if (!d) return false;
  if (d.ring) { clearTimeout(d.ring.timer); closeDoorbell(d.ring.id); d.ring = null; }
  if (!d.talk) { led(d, DoorState.Idle); return false; }
  const s = Math.round((Date.now() - d.talk.since) / 1000);
  clearTimeout(d.talk.maxT);
  endCall(d.talk.panel);
  endCall(d.id);
  closeDoorbell(d.talk.ringId);   // dong trang chuong tren man da nghe, quay ve ung dung truoc
  console.log(`[door] ${d.id}: ${why} sau ${s} s`);
  d.talk = null;
  led(d, DoorState.Idle);
  return true;
}

export function openGate(doorId: string, secs = cfg.gateS): boolean {
  const d = doors.get(doorId);
  if (!d) return false;
  const n = Math.max(1, Math.min(120, Math.round(secs)));   // (16/10/2026) toi 120 s (firmware nhan 1 byte)
  broadcaster.sendDeviceControl(d.id, ControlField.Gate, n);
  // Het xung: ve "dang noi" neu con noi chuyen, khong thi ve ranh (truoc day ve ranh roi moi sang dang noi -> LED nhay).
  led(d, DoorState.Opening);
  d.ledT = setTimeout(() => { d.ledT = null; broadcaster.sendDeviceControl(d.id, ControlField.DoorState, d.talk ? DoorState.Talking : DoorState.Idle); }, n * 1000 + 500);
  console.log(`[door] ${d.id}: mo cong ${n} s`);
  return true;
}

// ── Hinh MJPEG: mot ket noi toi chuong, chia cho nhieu nguoi xem ─────────────────────────────────────────────
interface MjHub { sinks: Set<FrameSink>; req: http.ClientRequest | null; buf: Buffer; t0: number; stopT: NodeJS.Timeout | null; last: Buffer | null }
const mjHubs = new Map<string, MjHub>();

export function subscribeDoorFrames(id: string, sink: FrameSink): () => void {
  let h = mjHubs.get(id);
  if (!h) { h = { sinks: new Set(), req: null, buf: Buffer.alloc(0), t0: Date.now(), stopT: null, last: null }; mjHubs.set(id, h); }
  h.sinks.add(sink);
  sink({ kind: 'config', codec: 'jpeg', avcc: Buffer.alloc(0) });
  // (16/10/2026) Nguoi xem vao giua: gui ngay khung CUOI (da co) de thay hinh tuc thi, khong cho khung ke tiep.
  if (h.last) sink({ kind: 'frame', key: true, ts: Date.now() - h.t0, data: h.last });
  if (h.stopT) { clearTimeout(h.stopT); h.stopT = null; }
  if (!h.req) openMj(id, h);
  const hub = h;
  return () => {
    hub.sinks.delete(sink);
    if (!hub.sinks.size && !hub.stopT) hub.stopT = setTimeout(() => { hub.stopT = null; if (!hub.sinks.size) { hub.req?.destroy(); hub.req = null; } }, 3000);
  };
}

/** Tach anh JPEG trong luong multipart theo dau SOI (FFD8) / EOI (FFD9) — du lieu nen JPEG khong chua FFD9. */
export function splitJpegs(buf: Buffer, out: (jpg: Buffer) => void): Buffer {
  let start = buf.indexOf(Buffer.from([0xff, 0xd8]));
  while (start >= 0) {
    const end = buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) return buf.subarray(start);
    out(Buffer.from(buf.subarray(start, end + 2)));
    buf = buf.subarray(end + 2);
    start = buf.indexOf(Buffer.from([0xff, 0xd8]));
  }
  return Buffer.alloc(0);
}

function openMj(id: string, h: MjHub): void {
  const d = doors.get(id);
  if (!d || !d.mjPort) { setTimeout(() => { if (h.sinks.size && !h.req) openMj(id, h); }, 3000); return; }
  const rq = http.get({ host: d.ip, port: d.mjPort, path: '/' }, (r) => {
    r.on('data', (c: Buffer) => {
      h.buf = splitJpegs(h.buf.length ? Buffer.concat([h.buf, c]) : c, (jpg) => {
        h.last = jpg;
        for (const s of h.sinks) s({ kind: 'frame', key: true, ts: Date.now() - h.t0, data: jpg });
      });
      if (h.buf.length > 2 * 1024 * 1024) h.buf = Buffer.alloc(0);
    });
    r.on('end', () => reopen());
  });
  const reopen = () => { if (h.req !== rq) return; h.req = null; h.buf = Buffer.alloc(0); if (h.sinks.size) setTimeout(() => { if (h.sinks.size && !h.req) openMj(id, h); }, 2000); };
  rq.setTimeout(15_000, () => rq.destroy(new Error('het gio')));
  rq.on('error', () => reopen());
  h.req = rq;
}

/**
 * (16/10/2026) HINH MJPEG qua HTTP cho **Frigate / Home Assistant** (WS `/call/video` chỉ dành cho trang web).
 * Dùng CHUNG `MjHub` với trang web ⇒ vẫn chỉ **MỘT** kết nối tới camera của chuông (camera ESPHome chỉ phục vụ 1 luồng).
 * Frigate: `ffmpeg.inputs.path: http://172.30.32.1:18080/door/video/<id chuông>` (roles: detect, record).
 * Chỉ nhận từ mạng nội bộ (Frigate, go2rtc, HA core, Chromium của add-on) — không mở ra LAN.
 */
export function handleDoorMjpeg(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const m = /^\/door\/video\/([A-Za-z0-9_-]{1,40})$/.exec(url.pathname);
  if (!m) return false;
  if (!isInternalPeer(req.socket.remoteAddress)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Chi Frigate / Home Assistant noi bo.'); return true;
  }
  const id = m[1];
  if (!doors.has(id)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Chuong chua ket noi.'); return true;
  }
  res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store', connection: 'close' });
  let closed = false;
  let un: () => void = () => { };
  un = subscribeDoorFrames(id, (f) => {
    if (closed || f.kind !== 'frame') return;
    try {
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.data.length}\r\n\r\n`);
      res.write(f.data);
      res.write('\r\n');
    } catch { closed = true; un(); res.destroy(); }
  });
  const stop = () => { if (closed) return; closed = true; un(); };
  req.on('close', stop); res.on('close', stop);
  console.log(`[door] ${id}: Frigate/HA xem MJPEG qua HTTP`);
  return true;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────────────
const isLocal = (req: http.IncomingMessage) => /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** true = da xu ly. */
export function handleDoorApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/door/')) return false;
  // Cai dat chuong: tu trang Darboard (ingress, HA da buoc dang nhap).
  if (p === '/door/config' && (isLocal(req) || (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2')) {
    if (req.method === 'GET') { json(res, 200, { cfg, doors: doorList(), panels: doorPanelChoices() }); return true; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => { try { json(res, 200, { ok: true, cfg: setDoorConfig(JSON.parse(body || '{}')) }); } catch { json(res, 400, { ok: false, error: 'JSON sai' }); } });
    return true;
  }
  const ingress = (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';
  const q = (k: string) => url.searchParams.get(k) || '';
  // Nhat ky (man + Darboard): danh sach moi nhat truoc; ?dev= -> kem anh can mo (cham thong bao) roi xoa yeu cau.
  if (p === '/door/log' && req.method === 'GET' && (isLocal(req) || ingress)) {
    const dev = q('dev'), open = dev ? openReq.get(dev) : undefined;
    if (dev) openReq.delete(dev);
    json(res, 200, { items: [...log].reverse(), keepDays: 30, open: open || null });
    return true;
  }
  if (p === '/door/delete' && req.method === 'POST' && (isLocal(req) || ingress)) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { json(res, 200, { ok: true, deleted: deleteLog(JSON.parse(body || '{}').files) }); } catch { json(res, 400, { ok: false, error: 'JSON sai' }); } });
    return true;
  }
  // (14/10/2026) POST /door/ring cho ca Home Assistant (mang noi bo 172.30.32.0/23 — automation rest_command).
  if (p === '/door/ring' && req.method === 'POST' && isInternalPeer(req.socket.remoteAddress) && !isLocal(req)) {
    const d = doors.get(q('door')) ?? [...doors.values()][0];
    if (!d) { json(res, 404, { ok: false, error: 'Không có chuông.' }); return true; }
    d.lastPress = 0; press(d, q('panels') ? q('panels').split(',') : undefined);
    json(res, 200, { ok: true, ring: d.ring?.id, panels: d.ring?.panels }); return true;
  }
  if (!isLocal(req) && !(ingress && /^\/door\/snap\//.test(p))) { json(res, 403, { error: 'Chỉ dùng từ màn hình.' }); return true; }
  const m = /^\/door\/snap\/([\w.-]+\.jpg)$/.exec(p);
  if (m && req.method === 'GET') {
    fs.readFile(path.join(SNAP_DIR, m[1]), (e, b) => {
      if (e) { json(res, 404, { error: 'khong co anh' }); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); res.end(b);
    });
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
  if (p === '/door/answer') { const r = answer(q('ring'), q('dev')); json(res, r.ok ? 200 : 409, r); return true; }
  if (p === '/door/decline') { json(res, 200, { ok: decline(q('ring')) }); return true; }
  if (p === '/door/hangup') { json(res, 200, { ok: hangup(q('door')) }); return true; }
  if (p === '/door/ring') {
    const d = doors.get(q('door')) ?? [...doors.values()][0];
    if (!d) { json(res, 404, { ok: false, error: 'Không có chuông.' }); return true; }
    d.lastPress = 0; press(d, q('panels') ? q('panels').split(',') : undefined);
    json(res, 200, { ok: true, ring: d.ring?.id, panels: d.ring?.panels }); return true;
  }
  if (p === '/door/gate') { json(res, 200, { ok: openGate(q('door')) }); return true; }
  if (p === '/door/shot') {
    const d = doors.get(q('door'));
    if (!d) { json(res, 404, { ok: false, error: 'Không có chuông.' }); return true; }
    snapshot(d).then((img) => {
      addLog(d, img, 'shot', q('dev') || undefined);
      postNotify({ title: 'Ảnh ở cổng', app: 'doorlog', arg: img, message: `${d.name} — ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
        device: q('dev') || 'all', image: `${LOCAL_ORIGIN}/door/snap/${img}` });
      json(res, 200, { ok: true });
    }).catch((e) => json(res, 502, { ok: false, error: 'Không chụp được: ' + (e as Error).message }));
    return true;
  }
  if (p === '/door/mute') { json(res, 200, { ok: setMuted(q('dev'), q('on') === '1') }); return true; }
  json(res, 404, { error: 'khong co' });
  return true;
}
