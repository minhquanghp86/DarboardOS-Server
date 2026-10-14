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
import { answerDoorbell, broadcaster, closeDoorbell, connectedScreens, postNotify, ringDoorPanels } from './deviceManager.js';
import { haFetch } from './haSettings.js';
import { LOCAL_ORIGIN } from './launcherApps.js';
import type { FrameSink } from './mkvLive.js';
import { ControlField, DeviceEventKind, DoorState, MsgType, parseDeviceEventPacket } from './protocol.js';

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const SNAP_DIR = path.join(DATA_DIR, 'rwv-door');
// (14/10/2026) Cai dat chuong (tab "Gọi" trong Darboard -> Chuong cong): man do chuong (rong = theo firmware / moi man),
// thoi gian do chuong, thoi gian mo cong. Luu /data/rwv-door.json.
const CFG_FILE = path.join(DATA_DIR, 'rwv-door.json');
export interface DoorConfig { ringPanels: string[]; ringS: number; gateS: number }
let cfg: DoorConfig = { ringPanels: [], ringS: 45, gateS: 3 };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) }; } catch { /* chua co */ }
export function doorConfig(): DoorConfig { return cfg; }
export function setDoorConfig(b: any): DoorConfig {
  const panels = Array.isArray(b?.ringPanels) ? b.ringPanels.filter((x: unknown) => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, 20) : cfg.ringPanels;
  const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  cfg = { ringPanels: panels, ringS: num(b?.ringS, 10, 120, cfg.ringS), gateS: num(b?.gateS, 1, 30, cfg.gateS) };
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg)); } catch { /* */ }
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
  ring: { id: string; panels: string[]; timer: NodeJS.Timeout } | null;
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

/** Khach bam nut. */
function press(d: Door): void {
  const now = Date.now();
  if (now - d.lastPress < 5000) return;          // chong bam lien tiep
  d.lastPress = now;
  if (d.talk) return;                              // dang noi chuyen: bo qua
  if (d.ring) { clearTimeout(d.ring.timer); closeDoorbell(d.ring.id); }
  const only = cfg.ringPanels.length ? cfg.ringPanels : d.panels.length ? d.panels : undefined;
  const r = ringDoorPanels(d.id, d.name, cfg.ringS, only, d.canTalk);
  d.ring = { id: r.id, panels: r.devices, timer: setTimeout(() => missed(d, r.id), cfg.ringS * 1000) };
  led(d, DoorState.Ringing);
  haFetch('/events/darboard_doorbell', { method: 'POST', body: JSON.stringify({ door: d.id, name: d.name, panels: r.devices }) })
    .then((x) => { if (!x.ok) console.warn(`[door] su kien HA: ${x.status}`); }).catch(() => { });
}

async function missed(d: Door, ringId: string): Promise<void> {
  if (!d.ring || d.ring.id !== ringId) return;
  d.ring = null;
  led(d, DoorState.Missed, 60_000);
  const img = await snapshot(d).catch(() => null);
  postNotify({ title: 'Cuộc gọi nhỡ ở cổng', message: `${d.name}: không ai nghe lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
    priority: 'high', device: 'all', ...(img ? { image: `${LOCAL_ORIGIN}/door/snap/${img}` } : {}) });
  console.log(`[door] ${d.id}: cuoc goi nho${img ? ' (co anh)' : ''}`);
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
        const old = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.jpg')).sort();
        for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.rmSync(path.join(SNAP_DIR, f), { force: true });
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
  d.ring = null;
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
  const n = Math.max(1, Math.min(30, Math.round(secs)));
  broadcaster.sendDeviceControl(d.id, ControlField.Gate, n);
  // Het xung: ve "dang noi" neu con noi chuyen, khong thi ve ranh (truoc day ve ranh roi moi sang dang noi -> LED nhay).
  led(d, DoorState.Opening);
  d.ledT = setTimeout(() => { d.ledT = null; broadcaster.sendDeviceControl(d.id, ControlField.DoorState, d.talk ? DoorState.Talking : DoorState.Idle); }, n * 1000 + 500);
  console.log(`[door] ${d.id}: mo cong ${n} s`);
  return true;
}

// ── Hinh MJPEG: mot ket noi toi chuong, chia cho nhieu nguoi xem ─────────────────────────────────────────────
interface MjHub { sinks: Set<FrameSink>; req: http.ClientRequest | null; buf: Buffer; t0: number; stopT: NodeJS.Timeout | null }
const mjHubs = new Map<string, MjHub>();

export function subscribeDoorFrames(id: string, sink: FrameSink): () => void {
  let h = mjHubs.get(id);
  if (!h) { h = { sinks: new Set(), req: null, buf: Buffer.alloc(0), t0: Date.now(), stopT: null }; mjHubs.set(id, h); }
  h.sinks.add(sink);
  sink({ kind: 'config', codec: 'jpeg', avcc: Buffer.alloc(0) });
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
    if (req.method === 'GET') { json(res, 200, { cfg, doors: doorList(), panels: connectedScreens().filter((s) => s.spk || s.cam).map((s) => ({ id: s.id, name: nameOf(s.id) || s.id })) }); return true; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => { try { json(res, 200, { ok: true, cfg: setDoorConfig(JSON.parse(body || '{}')) }); } catch { json(res, 400, { ok: false, error: 'JSON sai' }); } });
    return true;
  }
  if (!isLocal(req)) { json(res, 403, { error: 'Chỉ dùng từ màn hình.' }); return true; }
  const q = (k: string) => url.searchParams.get(k) || '';
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
  if (p === '/door/gate') { json(res, 200, { ok: openGate(q('door')) }); return true; }
  if (p === '/door/shot') {
    const d = doors.get(q('door'));
    if (!d) { json(res, 404, { ok: false, error: 'Không có chuông.' }); return true; }
    snapshot(d).then((img) => {
      postNotify({ title: 'Ảnh ở cổng', message: `${d.name} — ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
        device: q('dev') || 'all', image: `${LOCAL_ORIGIN}/door/snap/${img}` });
      json(res, 200, { ok: true });
    }).catch((e) => json(res, 502, { ok: false, error: 'Không chụp được: ' + (e as Error).message }));
    return true;
  }
  if (p === '/door/mute') { json(res, 200, { ok: setMuted(q('dev'), q('on') === '1') }); return true; }
  json(res, 404, { error: 'khong co' });
  return true;
}
