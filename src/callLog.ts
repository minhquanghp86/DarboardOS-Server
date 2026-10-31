// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/12/2026) NHAT KY CUOC GOI (ung dung "Cuộc gọi" — tab "Nhật ký" cua public/call-web.html).
//
// Vi sao can: trang goi chi biet cuoc goi DANG dien ra (WS /calls/web + /calls/state). Sau khi cup may khong con dau
// vet nao, nen nguoi dung khong biet "ai goi ai luc may gio, bao lau, nho hay da nghe". Module nay giu 200 muc gan
// nhat trong /data/rwv-call-log.json (ben qua nang cap add-on, nhu rwv-phones.json / rwv-push.json).
//
// MOT CUA GOI = HAI MUC (moi ben mot muc): `dir` ('in' | 'out') va `byMe` (ai cup) chi co nghia khi biet muc do la
// cua AI. Vi vay `start()` ghi 2 muc — mot muc `self` = ben goi (`dir: 'out'`, peer = ben nhan) va mot muc `self` =
// ben nhan (`dir: 'in'`, peer = ben goi). API GET /calls/log?self=<id> chi tra muc cua dung thiet bi hoi, moi nhat
// truoc (src/calls.ts, handleCallsApi).
//
// Schema mot muc (dung ten truong yeu cau):
//   id         — id cuoc goi (khoa de cap nhat trang thai sau khi nghe / ket thuc)
//   self       — thiet bi dang so huu muc nay (id man hinh / dien thoai / phien web)
//   dir        — 'in' (may nay bi goi) | 'out' (may nay goi di)
//   peerId     — thiet bi ben kia
//   peerName   — ten hien thi ben kia luc bat dau cuoc goi
//   peerKind   — 'panel' | 'phone' | 'web'
//   startedAt  — luc NGHE may (0 = chua ai nghe)
//   endedAt    — luc ket thuc
//   durationMs — endedAt - startedAt khi da nghe, 0 khi khong
//   state      — 'answered' | 'missed' | 'declined' | 'cancelled' | 'failed'
//   byMe       — ben nay la ben cup may / tu choi
//   ts         — luc tao muc (sap xep, don file)
//
// MUC DANG DO CHUONG (chua co `endedAt`) KHONG tra ra API: trang goi da tu hien cuoc goi dang chay, con nhat ky chi
// liet ke cuoc goi da xong (tranh mot dong "đang gọi" vo nghia khi server khoi dong lai giua cuoc).
import fs from 'node:fs';
import path from 'node:path';

export type CallDir = 'in' | 'out';
export type CallPeerKind = 'panel' | 'phone' | 'web';
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'cancelled' | 'failed';

export interface CallLogItem {
  id: string;
  self: string;
  dir: CallDir;
  peerId: string;
  peerName: string;
  peerKind: CallPeerKind;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  state: CallOutcome;
  byMe: boolean;
  ts: number;
}

/** Mot dau cuoc goi (man hinh / dien thoai / phien web) — src/calls.ts truyen vao. */
export interface CallSide { id: string; kind: CallPeerKind; name: string }

/** So muc toi da giu trong file (moi cuoc goi = 2 muc => ~100 cuoc goi gan nhat). */
export const MAX_ITEMS = 200;
/** `limit` mac dinh / toi da cua GET /calls/log. */
export const DEFAULT_LIMIT = 50;

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const isDir = (v: unknown): v is CallDir => v === 'in' || v === 'out';
const isKind = (v: unknown): v is CallPeerKind => v === 'panel' || v === 'phone' || v === 'web';
const isOutcome = (v: unknown): v is CallOutcome =>
  v === 'answered' || v === 'missed' || v === 'declined' || v === 'cancelled' || v === 'failed';

/**
 * LY DO KET THUC -> TRANG THAI NHAT KY (ham thuan, co test rieng).
 *
 *   'Từ chối'                                  -> declined
 *   'Không trả lời' (het RING_S)               -> missed
 *   'Đã kết thúc'                              -> answered neu da nghe, cancelled neu chua kip nghe
 *   'Mất kết nối' (WS rot qua an han)          -> failed
 *   'Máy bận.' / 'Không liên lạc được.'        -> failed
 */
export function outcomeOf(reason: string, answered: boolean): CallOutcome {
  const r = (reason || '').toLowerCase();
  if (r.includes('mất kết nối') || r.includes('mat ket noi')) return 'failed';
  if (answered) return 'answered';
  if (r.includes('từ chối') || r.includes('tu choi')) return 'declined';
  if (r.includes('không trả lời') || r.includes('khong tra loi') || r.includes('nhỡ') || r.includes('nho')) return 'missed';
  if (r.includes('đã kết thúc') || r.includes('da ket thuc')) return 'cancelled';
  if (r.includes('máy bận') || r.includes('may ban') || r.includes('liên lạc') || r.includes('lien lac')) return 'failed';
  return answered ? 'answered' : 'failed';
}

const copy = (i: CallLogItem): CallLogItem => ({ ...i });

/**
 * So nhat ky cuoc goi (THUAN luu tru, khong mang): nap luc khoi tao, ghi file sau moi thay doi.
 * `file === null` = chi giu trong bo nho (test).
 */
export class CallLog {
  private items: CallLogItem[] = [];

  constructor(private file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const arr: unknown[] = Array.isArray(j) ? j : Array.isArray((j as any)?.items) ? (j as any).items : [];
      for (const raw of arr) {
        const it = raw as Partial<CallLogItem>;
        // Ban ghi mo coi / dang do chuong luc server dung -> bo (khong bao gio ket thuc duoc nua).
        if (typeof it?.id !== 'string' || !it.id) continue;
        if (typeof it.self !== 'string' || !it.self) continue;
        if (!isDir(it.dir) || !isKind(it.peerKind) || !isOutcome(it.state)) continue;
        if (!num(it.endedAt)) continue;
        this.items.push({
          id: it.id.slice(0, 64),
          self: it.self.slice(0, 64),
          dir: it.dir,
          peerId: clean(it.peerId, 64),
          peerName: clean(it.peerName, 60) || clean(it.peerId, 60),
          peerKind: it.peerKind,
          startedAt: num(it.startedAt),
          endedAt: num(it.endedAt),
          durationMs: num(it.durationMs),
          state: it.state,
          byMe: !!it.byMe,
          ts: num(it.ts) || num(it.endedAt),
        });
      }
    } catch { /* chua co file / file hong: bat dau rong */ }
    this.items = this.items.slice(0, MAX_ITEMS);
  }

  /** `start()` — tao MUC CHO CA HAI BEN (dir theo ben goi), trang thai tam (chua tra ra API). */
  open(callId: string, from: CallSide, to: CallSide, at = Date.now()): void {
    const id = clean(callId, 64);
    if (!id) return;
    const mk = (self: CallSide, peer: CallSide, dir: CallDir): CallLogItem => ({
      id,
      self: clean(self.id, 64),
      dir,
      peerId: clean(peer.id, 64),
      peerName: clean(peer.name, 60) || clean(peer.id, 60),
      peerKind: peer.kind,
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      state: 'cancelled',   // tam: chua ai nghe, chua ket thuc -> KHONG tra ra API (loc theo endedAt)
      byMe: false,
      ts: at,
    });
    this.items.unshift(mk(from, to, 'out'), mk(to, from, 'in'));
    this.trim();
    this.save();
  }

  /** `accept()` — da nghe may: ghi `startedAt` + `answered` cho ca hai muc cua cuoc goi. */
  answered(callId: string, at = Date.now()): void {
    let hit = false;
    for (const it of this.items) {
      if (it.id !== callId) continue;
      it.startedAt = at;
      it.state = 'answered';
      hit = true;
    }
    if (hit) this.save();
  }

  /**
   * `finish()` — ket thuc cuoc goi: `endedAt`, `durationMs`, `state` (theo [outcomeOf]) va `byMe` (ben cup may la
   * ben so huu muc). Goi sau khi da `answered` thi giu `startedAt` de tinh thoi luong.
   */
  finish(callId: string, reason: string, by = '', at = Date.now()): void {
    let hit = false;
    for (const it of this.items) {
      if (it.id !== callId) continue;
      it.endedAt = at;
      it.durationMs = it.startedAt > 0 ? Math.max(0, at - it.startedAt) : 0;
      it.state = outcomeOf(reason, it.startedAt > 0);
      it.byMe = !!by && by === it.self;
      hit = true;
    }
    if (hit) this.save();
  }

  /** Muc cua `self` (hoac tat ca khi `self` rong), moi nhat truoc. Chi muc DA KET THUC. */
  list(self = '', limit = DEFAULT_LIMIT): CallLogItem[] {
    const id = clean(self, 64);
    const max = Math.max(1, Math.min(MAX_ITEMS, Math.round(Number(limit) || DEFAULT_LIMIT)));
    const out: CallLogItem[] = [];
    for (const it of this.items) {
      if (!it.endedAt) continue;
      if (id && it.self !== id) continue;
      out.push(copy(it));
      if (out.length >= max) break;
    }
    return out;
  }

  /** So muc dang giu (ke ca muc dang do chuong) — test gioi han 200. */
  size(): number { return this.items.length; }

  /** Bo muc cua mot cuoc goi (test don dep). */
  drop(callId: string): void {
    const before = this.items.length;
    this.items = this.items.filter((it) => it.id !== callId);
    if (this.items.length !== before) this.save();
  }

  private trim(): void {
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items));
    } catch { /* bo qua: nhat ky chi de tien, khong duoc lam chet server */ }
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
/** So nhat ky dung chung (src/calls.ts). */
export let callLog = new CallLog(process.env.CALL_LOG_FILE || path.join(DATA_DIR, 'rwv-call-log.json'));

/** Thay so nhat ky (test / khi doi duong dan du lieu). */
export function setCallLog(l: CallLog): void { callLog = l; }
