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
//
// (10/11/2026) GD2 — DIEN THOAI (app Android, src/phoneStore.ts + src/phones.ts): moi dien thoai da dang ky la mot
// "thiet bi goi duoc thuong tru", hien trong danh ba (contacts) voi nhan "Điện thoại". Dien thoai khong co phien WS
// nen KHONG the "nhan" qua socket: server chi mo cuoc goi o trang thai `ringing` (hen gio RING_S nhu man hinh), app
// poll GET /app/incoming?phone=<id> moi 2 s roi POST /app/answer | /app/decline. Het 30 s khong ai nhan -> missed
// (finish(..., true): Thong bao + Telegram nhu cu). Luong man <-> trinh duyet khong doi.
//
// (GD3 — thang 11/2026) TIENG 2 CHIEU CHO DIEN THOAI: sau khi bam "Nghe", app mo WebView toi
// `call-web.html?call=<id>` (kem `&phone=<id>` neu app truyen). Trang do mo WS /calls/web (nhu tab "Gọi" cua trinh
// duyet) roi gui `{type:'join', call, phone}`; `join()` ben duoi GAN phien web lam DAU CUOI TIENG cua dien thoai:
//   c.to (dien thoai) -> {kind:'web', id:<phien>}, giu `c.phone` = id may de biet may nao dang trong cuoc goi.
// Tieng di y nhu luong man <-> trinh duyet: mic man -> 0x01 xuong WS; PCM trong WS -> loa man (sendToDevice).
// Trang thai cuoc goi: GET /calls/state?call= (da co) — trang goi hoi 2,5 s/lan de biet cuoc goi ket thuc.
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { telegramNotify, tgText } from './telegram.js';

import { endCall, isInCall, linkCalls, onMicListener, sendToDevice, setMuted, startCall } from './callBridge.js';
import { answerDoorbell, closeDoorbell, connectedScreens, openRingPage, postNotify } from './deviceManager.js';
import { LOCAL_ORIGIN } from './launcherApps.js';
import type { FrameSink } from './mkvLive.js';
import { ringtoneExists } from './ringtone.js';
import { isLocalBrowser } from './requestOrigin.js';
import { phoneLabel, phones } from './phoneStore.js';
// (17/11/2026) GD9 — bo tien to ingress cua HA (`/api/hassio_ingress/<TOKEN>/calls/*`).
import { routeOf } from './routePath.js';

const RING_S = 30;
export interface Party { kind: 'panel' | 'web' | 'phone'; id: string }
interface WebSession { id: string; name: string; ws: WebSocket; call: string | null; vcfg: { codec: string; avcc: Buffer } | null; vsinks: Set<FrameSink>;
  /** (17/11/2026) GD9: da nhan khung hinh H.264 dau tien tu trang nay (chi de ghi log MOT lan). */
  vfirst?: boolean }
interface Call {
  id: string; from: Party; to: Party; state: 'ringing' | 'active';
  ringT: NodeJS.Timeout; startedAt: number; ringId: string | null;
  muted: Set<string>; camOff: Set<string>; unlisten: (() => void)[];
  /** (GD3) Dien thoai dang trong cuoc goi bang trang call-web.html?call= (c.to da doi thanh phien web cua may). */
  phone?: string;
}
const calls = new Map<string, Call>();
const ended = new Map<string, { reason: string; at: number }>();   // trang thai cuoc goi vua het (trang hoi state)
const webs = new Map<string, WebSession>();
let nameOf: (id: string) => string | undefined = () => undefined;
export function setCallHooks(h: { name: (id: string) => string | undefined }): void { nameOf = h.name; }

const partyName = (p: Party) => (p.kind === 'web' ? webs.get(p.id)?.name || 'Trình duyệt'
  : p.kind === 'phone' ? phoneLabel(phones.get(p.id)) : nameOf(p.id) || p.id);
// (GD3) Dien thoai da "join" bang trang call-web: c.to la phien web, id may nam o `c.phone` -> van phai coi la BAN.
const busy = (id: string) => [...calls.values()].some((c) => c.from.id === id || c.to.id === id || c.phone === id) || isInCall(id);
const callOf = (id: string) => calls.get(id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function panels(): { id: string; name: string }[] {
  return connectedScreens().filter((s) => s.mic && s.spk && s.cam).map((s) => ({ id: s.id, name: nameOf(s.id) || `Màn hình ${s.w}×${s.h}` }));
}
export function contacts(self: string): { id: string; kind: Party['kind']; name: string; busy: boolean }[] {
  const out: { id: string; kind: Party['kind']; name: string; busy: boolean }[] =
    panels().filter((p) => p.id !== self).map((p) => ({ id: p.id, kind: 'panel', name: p.name, busy: busy(p.id) }));
  for (const w of webs.values()) if (w.id !== self) out.push({ id: w.id, kind: 'web', name: w.name, busy: !!w.call });
  // (10/11/2026) Dien thoai da dang ky: nhan "Điện thoại" (call-ui.js hien ten + phu de theo kind).
  for (const p of phones.list()) if (p.id !== self) out.push({ id: p.id, kind: 'phone', name: phoneLabel(p), busy: busy(p.id) });
  return out;
}
function partyOf(id: string): Party | null {
  if (webs.has(id)) return { kind: 'web', id };
  if (panels().some((p) => p.id === id)) return { kind: 'panel', id };
  if (phones.get(id)) return { kind: 'phone', id };
  return null;
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
  } else if (to.kind === 'web') {
    webs.get(to.id)!.call = id;
    sendWeb(to.id, { type: 'incoming', call: id, from: from.id, name: partyName(from) });
  }
  // (10/11/2026) to.kind === 'phone': khong co trang/WS de mo — app Android tu thay cuoc goi khi poll
  // GET /app/incoming?phone=<id> (2 s/lan). Het RING_S ma khong ai nhan -> finish(..., true) = cuoc goi nho.
  console.log(`[calls] ${id}: ${from.id} goi ${to.id}`);
  return { ok: true, call: id };
}

/**
 * (14/10/2026) Tieng man <-> phien web trong cuoc goi: mic man -> khung 0x01 xuong WS cua trang goi.
 * Chieu nguoc lai (PCM trong WS -> loa man) nam o `webMessage` (nhi phan 0x01) — doi xung san co.
 * (GD3) Dung chung cho ca cuoc goi man <-> trinh duyet va man <-> DIEN THOAI (trang call-web.html?call=).
 */
function bridgePanelWeb(c: Call, panelId: string, webId: string): void {
  c.unlisten.push(onMicListener(panelId, (pcm) => {
    const w = webs.get(webId);
    if (!c.muted.has(panelId) && w && w.ws.readyState === WebSocket.OPEN && w.ws.bufferedAmount < 256 * 1024) w.ws.send(Buffer.concat([Buffer.from([1]), pcm]));
  }));
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
  else if (legs.length === 1) {
    // man <-> trinh duyet: mic man -> phien web; tieng web -> loa man (xem webMessage).
    // (10/11/2026) man <-> dien thoai (GD2, chua co tieng): chi can mo leg tieng cua man; dien thoai khong co WS
    // nen KHONG gan onMicListener (khong co noi nhan PCM).
    // (GD3) neu trang call-web cua dien thoai da "join" TRUOC do thi `other` da la phien web -> noi tieng luon.
    const panel = legs[0], other = c.from.kind === 'panel' ? c.to : c.from;
    if (other.kind === 'web') bridgePanelWeb(c, panel.id, other.id);
  }
  for (const p of [c.from, c.to]) if (p.kind === 'web') sendWeb(p.id, { type: 'active', call: callId, peer: p.id === c.from.id ? c.to.id : c.from.id });
  console.log(`[calls] ${callId}: ${by} nghe`);
  return { ok: true };
}

export interface JoinResult { ok: boolean; call?: string; peer?: string; peerName?: string; since?: number; error?: string }

/**
 * (GD3) TRANG GOI CUA DIEN THOAI (call-web.html?call=<id>) vao cuoc goi dang co — GAN phien web lam dau cuoi tieng
 * cua may: `c.to` (dien thoai) -> {kind:'web', id:<phien>}, `c.phone` = id may (de `busy()` va /app/hangup biet).
 * Chua ai nghe (con `ringing`, app chi mo trang ma chua kip POST /app/answer) -> nghe luon.
 * `phoneId` rong = khong kiem tra may (trang cu goi `call-web.html?call=` khong kem `&phone=`).
 */
export function join(callId: string, webId: string, phoneId = ''): JoinResult {
  const w = webs.get(webId);
  if (!w) return { ok: false, error: 'Phiên web không còn.' };
  let c = callOf(callId);
  if (!c) return { ok: false, error: 'Cuộc gọi đã kết thúc.' };
  // Trang nay da la dau cuoi cua cuoc goi (loi dung lai sau khi mat mang): tra lai thong tin, KHONG noi tieng lan 2.
  if (c.to.kind === 'web' && c.to.id === webId) {
    w.call = callId;
    return { ok: true, call: callId, peer: c.from.id, peerName: partyName(c.from), since: c.startedAt };
  }
  const phone = c.to.kind === 'phone' ? c.to.id : c.phone || '';
  if (!phone) return { ok: false, error: 'Cuộc gọi không dành cho điện thoại.' };
  if (phoneId && phoneId !== phone) return { ok: false, error: 'Cuộc gọi không dành cho máy này.' };
  if (c.state === 'ringing') {
    const a = accept(callId, phone);
    if (!a.ok) return { ok: false, error: a.error };
    c = callOf(callId);
    if (!c) return { ok: false, error: 'Cuộc gọi đã kết thúc.' };
  }
  c.phone = phone;
  c.to = { kind: 'web', id: webId };
  w.call = callId;
  // Tieng: man <-> phien web (ca hai chieu, xem bridgePanelWeb + webMessage). Cac dau khac (dien thoai <-> dien
  // thoai) khong co duong tieng — giu nguyen nhu truoc.
  if (c.from.kind === 'panel') bridgePanelWeb(c, c.from.id, webId);
  console.log(`[calls] ${callId}: ${webId} vao cuoc goi cua dien thoai ${phone}`);
  return { ok: true, call: callId, peer: c.from.id, peerName: partyName(c.from), since: c.startedAt };
}

/** (GD3) DIEN THOAI ket thuc cuoc goi (POST /app/hangup) — ke ca sau khi trang call-web da `join` (c.to la phien web). */
export function hangupFromPhone(callId: string, phoneId: string): boolean {
  const c = callOf(callId);
  if (!c || !phoneId) return false;
  const mine = (c.to.kind === 'phone' && c.to.id === phoneId) || c.phone === phoneId;
  return mine && finish(callId, 'Đã kết thúc');
}

export interface IncomingCall { id: string; from: string; fromName: string }

/**
 * (10/11/2026) GD2 — cuoc goi dang DO CHUONG toi dien thoai `phoneId` (app Android poll 2 s/lan). Dong thoi cap nhat
 * lastSeen de GET /app/list biet may con song. Chua dang ky -> null (app se tu dang ky lai).
 */
export function incomingFor(phoneId: string): IncomingCall | null {
  if (!phoneId || !phones.get(phoneId)) return null;
  phones.touch(phoneId);
  for (const c of calls.values()) {
    if (c.state === 'ringing' && c.to.kind === 'phone' && c.to.id === phoneId) {
      return { id: c.id, from: c.from.id, fromName: partyName(c.from) };
    }
  }
  return null;
}

/** Dien thoai tu choi (POST /app/decline): chi khi cuoc goi dung la dang do chuong toi may do. */
export function declineFromPhone(callId: string, phoneId: string): boolean {
  const c = callOf(callId);
  if (!c || c.to.kind !== 'phone' || c.to.id !== phoneId) return false;
  return finish(callId, 'Từ chối');
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
  // (GD3) Dien thoai da join: `to` la phien web cua trang goi (de lay hinh camera qua /call/video?dev=...), nhung
  // TEN hien thi van la ten may ("Pixel 8 · Điện thoại") chu khong phai ten phien web.
  const toName = c.phone ? phoneLabel(phones.get(c.phone)) : partyName(c.to);
  return { state: c.state, from: c.from.id, to: c.to.id, fromName: partyName(c.from), toName,
    since: c.startedAt, muted: [...c.muted], camOff: [...c.camOff], phone: c.phone || '' };
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

/**
 * Hinh duoc xem trong cuoc goi `callId`: chi khi cuoc goi dang chay, nguon thuoc cuoc goi va khong tat camera.
 *
 * (17/11/2026) GD9 — `src` co the la ID MAY (`c.phone`): man P4 xin hinh bang `dev=<to>` lay tu /calls/state luc
 * dien thoai CHUA `join` (xem videoSourceOf), nen phai coi id may la "thuoc cuoc goi".
 */
export function videoAllowed(callId: string, src: string): boolean {
  const c = callOf(callId);
  if (!c) return false;
  const own = c.from.id === src || c.to.id === src || c.phone === src;
  return own && !c.camOff.has(src);
}
export function isWebSource(id: string): boolean { return webs.has(id); }

/**
 * (17/11/2026) GD9 — NGUON HINH THAT SU cua mot id trong /call/video.
 *
 * Vi sao can: hinh camera cua DIEN THOAI chi ton tai trong PHIEN WEB cua trang `call-web.html?call=` (khung 0x02 do
 * WebCodecs cua trang ban len, xem webMessage). Nhung man P4 lay `peer` tu /calls/state: trong ~0,5–2 s dau (app da
 * POST /app/answer nhung trang chua kip `join`) `state.to` la ID MAY, va sau khi join moi la `web-…`. Trang P4 mo
 * `/call/video?dev=<ID MAY>` -> truoc day `isWebSource()` false, `connectedScreens()` khong co may -> server dong
 * socket 4004 "man khong co camera" => **P4 khong bao gio hien hinh camera cua dien thoai** (chi thay "Đang kết nối
 * hình…"), du tieng van chay. Nay: id may duoc anh xa sang phien web dang giu cuoc goi cua may do.
 */
export function videoSourceOf(dev: string): string {
  const id = (dev || '').trim();
  if (!id || webs.has(id)) return id;
  for (const c of calls.values()) {
    if (c.phone === id && c.to.kind === 'web' && webs.has(c.to.id)) return c.to.id;
  }
  return id;
}

/**
 * (17/11/2026) GD9 — `id` co the la mot dau cuoi cua cuoc goi dang chay khong (man / trinh duyet / dien thoai).
 * Dung de phan biet "nguon hinh nay chua san sang" (dien thoai chua join — cho them vai giay) voi
 * "id rac" (dong socket ngay, nhu truoc).
 */
export function isCallParty(id: string): boolean {
  const v = (id || '').trim();
  if (!v) return false;
  if (webs.has(v)) return true;
  for (const c of calls.values()) if (c.from.id === v || c.to.id === v || c.phone === v) return true;
  return false;
}

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
    // (GD3) Dien thoai: trang call-web.html?call=<id> xin VAO cuoc goi dang co (sound 2 chieu voi man).
    else if (m?.type === 'join') {
      const r = join(String(m.call || ''), w.id, String(m.phone || ''));
      if (r.ok && r.call) w.call = r.call;
      sendWeb(w.id, { type: 'joined', ...r });
    }
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
    // (GD3) hai dau deu la trang web (vd tab "Gọi" tren Dashboard <-> call-web.html?call= cua dien thoai):
    // chuyen thang PCM 0x01, cung dinh dang voi khung tieng man -> trinh duyet.
    else if (peer.kind === 'web' && !c.muted.has(w.id)) {
      const pw = webs.get(peer.id);
      if (pw && pw.ws.readyState === WebSocket.OPEN && pw.ws.bufferedAmount < 256 * 1024) pw.ws.send(Buffer.concat([Buffer.from([1]), data.subarray(1)]));
    }
  } else if (data[0] === 2 && data.length > 6 && !c.camOff.has(w.id)) {
    const key = data[1] === 1, ts = data.readUInt32LE(2), frame = data.subarray(6);
    // (17/11/2026) GD9 — HINH tu trang web -> nguoi xem (/call/video). Ghi log khung DAU TIEN mot lan: day la bang
    // chung "dien thoai da gui hinh" trong nhat ky add-on khi man P4 khong hien duoc hinh.
    if (!w.vfirst) {
      w.vfirst = true;
      console.log(`[calls] ${w.id}: khung hinh H.264 dau tien (${frame.length} byte, key=${key ? 1 : 0}) -> ${w.vsinks.size} nguoi xem`);
    }
    for (const s of w.vsinks) s({ kind: 'frame', key, ts, data: frame });
  }
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 * 1024 });
const isLocal = (req: http.IncomingMessage) => /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
/**
 * (12/11/2026) Nguoi goi hop le: man hinh (127.0.0.1), trang Dashboard qua ingress, hoac trang mo TRUC TIEP trong LAN
 * cung origin. Truoc day WS /calls/web bi `socket.destroy()` khi mo thang http://<ip>:18080/call-web.html trong app
 * Android -> trang "Cuộc gọi" khong nhan duoc `hello` nen danh ba trong ("Chưa có màn hình hoặc trình duyệt nào khác
 * để gọi"). Xem src/requestOrigin.ts.
 */
const isPage = (req: http.IncomingMessage) => isLocal(req) || isLocalBrowser(req);

export function handleCallsUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || '/', 'http://x');
  if (!url.pathname.endsWith('/calls/web')) return false;
  if (!isPage(req)) { socket.destroy(); return true; }
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
  // (17/11/2026) GD9 — bo tien to ingress (`/api/hassio_ingress/<TOKEN>/calls/state`): trang Goi mo qua ingress
  // (tab "Gọi" cua Dashboard / call-web.html) goi API bang duong dan tuyet doi kem tien to.
  const p = routeOf(url.pathname);
  if (!p.startsWith('/calls/')) return false;
  if (!isPage(req)) { json(res, 403, { error: 'Chỉ dùng từ màn hình.' }); return true; }
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
