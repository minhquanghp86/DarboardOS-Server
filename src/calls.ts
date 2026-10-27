// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) CUOC GOI VIDEO (INTERCOM GD2/GD3) giua cac man co camera + mic (P4) va trinh duyet (tab "Gọi" trong
// Dashboard). Server lam tong dai: do chuong ben nhan (trang call.html DE LEN man khoa — deviceManager.openRingPage), nhan /
// tu choi / ket thuc, may ban, goi nho (Thong bao), tat mic / tat camera (NGUNG gui hinh that su).
//   Tieng: man <-> man noi truc tiep (callBridge.linkCalls); man <-> trinh duyet qua WS phien web (PCM 16 kHz, khung 0x01).
//   Hinh: camera man = luong /live chia (camProxy); camera trinh duyet = H.264 do trinh duyet nen (WebCodecs) gui len WS
//   phien web (khung 0x02) -> server chuyen cho nguoi xem (WS /call/video?dev=web-...).
// API man (127.0.0.1): GET /calls/contacts?self=, POST /calls/start?from=&to=, GET /calls/state?call=,
//   POST /calls/accept|decline|hangup?call=&dev=, POST /calls/mute|cam?call=&dev=&on=.
// Phien web (ingress): WS /calls/web?name= — JSON dieu khien + nhi phan (0x01 tieng, 0x02 hinh).
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { telegramNotify, tgText } from './telegram.js';

import { endCall, isInCall, linkCalls, onMicListener, sendToDevice, setMuted, startCall } from './callBridge.js';
import { answerDoorbell, closeDoorbell, connectedScreens, openRingPage, postNotify } from './deviceManager.js';
import { LOCAL_ORIGIN } from './launcherApps.js';
import type { FrameSink } from './mkvLive.js';
import { ringtoneExists } from './ringtone.js';

const RING_S = 30;
export interface Party { kind: 'panel' | 'web'; id: string }
interface WebSession { id: string; name: string; ws: WebSocket; call: string | null; vcfg: { codec: string; avcc: Buffer } | null; vsinks: Set<FrameSink> }
interface Call {
  id: string; from: Party; to: Party; state: 'ringing' | 'active';
  ringT: NodeJS.Timeout; startedAt: number; ringId: string | null;
  muted: Set<string>; camOff: Set<string>; unlisten: (() => void)[];
}
const calls = new Map<string, Call>();
const ended = new Map<string, { reason: string; at: number }>();   // trang thai cuoc goi vua het (trang hoi state)
const webs = new Map<string, WebSession>();
let nameOf: (id: string) => string | undefined = () => undefined;
export function setCallHooks(h: { name: (id: string) => string | undefined }): void { nameOf = h.name; }

const partyName = (p: Party) => (p.kind === 'web' ? webs.get(p.id)?.name || 'Trình duyệt' : nameOf(p.id) || p.id);
const busy = (id: string) => [...calls.values()].some((c) => c.from.id === id || c.to.id === id) || isInCall(id);
const callOf = (id: string) => calls.get(id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function panels(): { id: string; name: string }[] {
  return connectedScreens().filter((s) => s.mic && s.spk && s.cam).map((s) => ({ id: s.id, name: nameOf(s.id) || `Màn hình ${s.w}×${s.h}` }));
}
export function contacts(self: string): { id: string; kind: Party['kind']; name: string; busy: boolean }[] {
  const out: { id: string; kind: Party['kind']; name: string; busy: boolean }[] =
    panels().filter((p) => p.id !== self).map((p) => ({ id: p.id, kind: 'panel', name: p.name, busy: busy(p.id) }));
  for (const w of webs.values()) if (w.id !== self) out.push({ id: w.id, kind: 'web', name: w.name, busy: !!w.call });
  return out;
}
function partyOf(id: string): Party | null {
  if (webs.has(id)) return { kind: 'web', id };
  return panels().some((p) => p.id === id) ? { kind: 'panel', id } : null;
}
function sendWeb(id: string, msg: unknown): void {
  const w = webs.get(id);
  if (w && w.ws.readyState === WebSocket.OPEN) w.ws.send(JSON.stringify(msg));
}

/** Bat dau goi. */
export function start(fromId: string, toId: string): { ok: boolean; call?: string; error?: string } {
  const from = partyOf(fromId), to = partyOf(toId);
  if (!from || !to || fromId === toId) return { ok: false, error: 'Không gọi được tới máy này.' };
  if (busy(fromId)) return { ok: false, error: 'Bạn đang trong một cuộc gọi khác.' };
  if (busy(toId)) return { ok: false, error: `${partyName(to)} đang bận.` };
  const id = newId();
  const c: Call = { id, from, to, state: 'ringing', ringT: setTimeout(() => finish(id, 'Không trả lời', true), RING_S * 1000),
    startedAt: 0, ringId: null, muted: new Set(), camOff: new Set(), unlisten: [] };
  calls.set(id, c);
  if (from.kind === 'web') webs.get(from.id)!.call = id;
  if (to.kind === 'panel') {
    const url = `${LOCAL_ORIGIN}/call.html?mode=in&call=${id}&dev=${encodeURIComponent(to.id)}&peer=${encodeURIComponent(from.id)}` +
      `&name=${encodeURIComponent(partyName(from))}`;
    c.ringId = 'c' + id;
    if (!openRingPage(to.id, c.ringId, url, RING_S + 2, 'cuoc goi den', !ringtoneExists('call'))) { finish(id, 'Không liên lạc được.'); return { ok: false, error: 'Không liên lạc được.' }; }
  } else {
    webs.get(to.id)!.call = id;
    sendWeb(to.id, { type: 'incoming', call: id, from: from.id, name: partyName(from) });
  }
  console.log(`[calls] ${id}: ${from.id} goi ${to.id}`);
  return { ok: true, call: id };
}

/** Ben nhan nghe: noi tieng. */
export function accept(callId: string, by: string): { ok: boolean; error?: string } {
  const c = callOf(callId);
  if (!c || c.state !== 'ringing' || c.to.id !== by) return { ok: false, error: 'Cuộc gọi đã kết thúc.' };
  clearTimeout(c.ringT);
  // (14/10/2026) SUA LOI: trang cuoc goi tren man nhan mo voi hen gio tu dong (het do chuong) — da nghe thi bo hen gio,
  // truoc day dung ~32 s sau trang tu dong du cuoc goi van chay.
  if (c.ringId) answerDoorbell(c.ringId, c.to.id);
  c.state = 'active'; c.startedAt = Date.now();
  const legs = [c.from, c.to].filter((p) => p.kind === 'panel');
  for (const p of legs) if (!startCall(p.id)) { finish(callId, 'Máy bận.'); return { ok: false, error: 'Máy bận.' }; }
  if (legs.length === 2) linkCalls(c.from.id, c.to.id);
  else {
    // man <-> trinh duyet: mic man -> phien web; tieng web -> loa man (xem webMessage).
    const panel = legs[0], web = c.from.kind === 'web' ? c.from : c.to;
    c.unlisten.push(onMicListener(panel.id, (pcm) => {
      const w = webs.get(web.id);
      if (!c.muted.has(panel.id) && w && w.ws.readyState === WebSocket.OPEN && w.ws.bufferedAmount < 256 * 1024) w.ws.send(Buffer.concat([Buffer.from([1]), pcm]));
    }));
  }
  for (const p of [c.from, c.to]) if (p.kind === 'web') sendWeb(p.id, { type: 'active', call: callId, peer: p.id === c.from.id ? c.to.id : c.from.id });
  console.log(`[calls] ${callId}: ${by} nghe`);
  return { ok: true };
}

/** Ket thuc / tu choi / het gio. missed: bao "goi nho" cho ben nhan. */
export function finish(callId: string, reason: string, missed = false): boolean {
  const c = callOf(callId);
  if (!c) return false;
  calls.delete(callId);
  clearTimeout(c.ringT);
  for (const u of c.unlisten) u();
  for (const p of [c.from, c.to]) {
    if (p.kind === 'panel') endCall(p.id);
    else { const w = webs.get(p.id); if (w && w.call === callId) w.call = null; sendWeb(p.id, { type: 'ended', call: callId, reason }); }
  }
  if (c.ringId) closeDoorbell(c.ringId);   // dong trang cuoc goi tren man nhan, quay ve ung dung truoc
  ended.set(callId, { reason, at: Date.now() });
  for (const [k, v] of ended) if (Date.now() - v.at > 120_000) ended.delete(k);
  if (missed && c.to.kind === 'panel') {
    postNotify({ title: 'Cuộc gọi nhỡ', message: `${partyName(c.from)} đã gọi lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
      priority: 'high', device: c.to.id, app: 'call', missed: true });
  }
  // (16/10/2026) Telegram: cuoc goi video nho (khong ai nghe) — ca goi toi man lan toi trinh duyet.
  if (missed) telegramNotify('call', tgText('call', { from: partyName(c.from), to: partyName(c.to) }));
  const s = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
  console.log(`[calls] ${callId}: ket thuc (${reason})${s ? ` sau ${s} s` : ''}`);
  return true;
}

export function state(callId: string): unknown {
  const c = callOf(callId);
  if (!c) { const e = ended.get(callId); return { state: 'ended', reason: e?.reason || 'Đã kết thúc' }; }
  return { state: c.state, from: c.from.id, to: c.to.id, fromName: partyName(c.from), toName: partyName(c.to),
    since: c.startedAt, muted: [...c.muted], camOff: [...c.camOff] };
}

export function setFlag(callId: string, dev: string, kind: 'mute' | 'cam', on: boolean): boolean {
  const c = callOf(callId);
  if (!c || (c.from.id !== dev && c.to.id !== dev)) return false;
  const set = kind === 'mute' ? c.muted : c.camOff;
  if (on) set.add(dev); else set.delete(dev);
  if (kind === 'mute' && partyOf(dev)?.kind === 'panel') setMuted(dev, on);
  for (const p of [c.from, c.to]) if (p.kind === 'web') sendWeb(p.id, { type: 'flags', muted: [...c.muted], camOff: [...c.camOff] });
  return true;
}

/** Hinh duoc xem trong cuoc goi `callId`: chi khi cuoc goi dang chay, nguon thuoc cuoc goi va khong tat camera. */
export function videoAllowed(callId: string, src: string): boolean {
  const c = callOf(callId);
  return !!c && (c.from.id === src || c.to.id === src) && !c.camOff.has(src);
}
export function isWebSource(id: string): boolean { return webs.has(id); }

/** Nguoi xem hinh camera trinh duyet. Chua co khung khoa -> nho trinh duyet gui khung khoa. */
export function subscribeWebFrames(id: string, sink: FrameSink): () => void {
  const w = webs.get(id);
  if (!w) return () => { };
  w.vsinks.add(sink);
  if (w.vcfg) sink({ kind: 'config', codec: w.vcfg.codec, avcc: w.vcfg.avcc });
  sendWeb(id, { type: 'keyframe' });
  return () => { w.vsinks.delete(sink); };
}

// ── Phien web (tab "Gọi" trong Dashboard) ─────────────────────────────────────────────────────────────────────
function webMessage(w: WebSession, data: Buffer, isBinary: boolean): void {
  if (!isBinary) {
    let m: any;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m?.type === 'start') { const r = start(w.id, String(m.to || '')); sendWeb(w.id, { type: 'started', ...r }); }
    else if (m?.type === 'accept' && w.call) accept(w.call, w.id);
    else if ((m?.type === 'hangup' || m?.type === 'decline') && w.call) finish(w.call, m.type === 'decline' ? 'Từ chối' : 'Đã kết thúc');
    else if (m?.type === 'mute' && w.call) setFlag(w.call, w.id, 'mute', !!m.on);
    else if (m?.type === 'cam' && w.call) setFlag(w.call, w.id, 'cam', !!m.on);
    else if (m?.type === 'contacts') sendWeb(w.id, { type: 'contacts', list: contacts(w.id) });
    else if (m?.type === 'vconfig' && typeof m.codec === 'string' && typeof m.avcc === 'string') {
      w.vcfg = { codec: m.codec.slice(0, 40), avcc: Buffer.from(m.avcc, 'base64') };
      for (const s of w.vsinks) s({ kind: 'config', codec: w.vcfg.codec, avcc: w.vcfg.avcc });
    }
    return;
  }
  const c = w.call ? callOf(w.call) : undefined;
  if (!c || c.state !== 'active' || data.length < 2) return;
  if (data[0] === 1) {
    const peer = c.from.id === w.id ? c.to : c.from;
    if (peer.kind === 'panel' && !c.muted.has(w.id)) sendToDevice(peer.id, data.subarray(1));
  } else if (data[0] === 2 && data.length > 6 && !c.camOff.has(w.id)) {
    const key = data[1] === 1, ts = data.readUInt32LE(2), frame = data.subarray(6);
    for (const s of w.vsinks) s({ kind: 'frame', key, ts, data: frame });
  }
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 * 1024 });
const isLocal = (req: http.IncomingMessage) => /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
const isIngress = (req: http.IncomingMessage) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';

export function handleCallsUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || '/', 'http://x');
  if (!url.pathname.endsWith('/calls/web')) return false;
  if (!isLocal(req) && !isIngress(req)) { socket.destroy(); return true; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const w: WebSession = { id: 'web-' + newId(), name: (url.searchParams.get('name') || 'Trình duyệt').slice(0, 40), ws, call: null, vcfg: null, vsinks: new Set() };
    webs.set(w.id, w);
    console.log(`[calls] phien web ${w.id} (${w.name})`);
    sendWeb(w.id, { type: 'hello', id: w.id, list: contacts(w.id) });
    ws.on('message', (d, bin) => webMessage(w, Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer), bin));
    ws.on('close', () => { if (w.call) finish(w.call, 'Mất kết nối'); webs.delete(w.id); });
    ws.on('error', () => { /* close xu ly */ });
  });
  return true;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
export function handleCallsApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/calls/')) return false;
  if (!isLocal(req)) { json(res, 403, { error: 'Chỉ dùng từ màn hình.' }); return true; }
  const q = (k: string) => url.searchParams.get(k) || '';
  if (p === '/calls/contacts' && req.method === 'GET') { json(res, 200, contacts(q('self'))); return true; }
  if (p === '/calls/state' && req.method === 'GET') { json(res, 200, state(q('call'))); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
  if (p === '/calls/start') { const r = start(q('from'), q('to')); json(res, r.ok ? 200 : 409, r); return true; }
  if (p === '/calls/accept') { const r = accept(q('call'), q('dev')); json(res, r.ok ? 200 : 409, r); return true; }
  if (p === '/calls/decline') { json(res, 200, { ok: finish(q('call'), 'Từ chối') }); return true; }
  if (p === '/calls/hangup') { json(res, 200, { ok: finish(q('call'), 'Đã kết thúc') }); return true; }
  if (p === '/calls/mute' || p === '/calls/cam') { json(res, 200, { ok: setFlag(q('call'), q('dev'), p === '/calls/mute' ? 'mute' : 'cam', q('on') === '1') }); return true; }
  json(res, 404, { error: 'khong co' });
  return true;
}
