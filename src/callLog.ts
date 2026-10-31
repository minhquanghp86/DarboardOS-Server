// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/12/2026) NHAT KY CUOC GOI (ung dung "Cuộc gọi" — tab "Nhật ký" cua public/call-web.html).
//
// Vi sao can: trang goi chi biet cuoc goi DANG dien ra (WS /calls/web + /calls/state). Sau khi cup may khong con dau
// vet nao, nen nguoi dung khong biet "ai goi ai luc may gio, bao lau, nho hay da nghe". Module nay giu 200 cuoc goi gan
// nhat trong /data/rwv-call-log.json (ben qua nang cap add-on, nhu rwv-phones.json / rwv-push.json).
//
// (03/12/2026) SUA LOI "NHAT KY CHI HIEN CHIEU GOI DI": MOT CUA GOI = MOT BAN GHI (khong phai 2 muc nhu truoc).
//
//   Ban cu ghi 2 muc ngay luc `open()` — moi muc dong cung `self`/`dir`/`peerId` cua thoi diem BAT DAU goi. Sai o hai
//   cho:
//     1. `self` bi DONG BANG: cuoc goi man -> DIEN THOAI duoc ghi duoi id may (`phone-abc123`), nhung khi may bam
//        "Nghe", app mo `call-web.html?call=...&phone=...` -> trang do lai hoi `GET /calls/log?self=<id phien web>`
//        (public/call-web.html) => muc "gọi đến" NAM NGOAI tam nhin cua chinh may do (chi con muc "gọi đi" o phia
//        ben kia). Cung vay khi phien web doi id (noi lai WS / trinh duyet doi id): moi muc cu thanh mo coi.
//     2. Hai muc co the LECH nhau: `state`/`byMe`/`durationMs` phai cap nhat tren ca hai, va mot cuoc goi ton 2 cho
//        trong gioi han 200.
//
//   Nay: luu MOT ban ghi/cuoc voi hai dau `from` / `to`, roi `GET /calls/log?self=<id>` PROJECT thanh muc cua dung
//   thiet bi do (`dir` tinh theo `self`, `peer` = ben kia). Khong the lech, khong the nhan doi.
//
//   `from.also` / `to.also`: cac id KHAC cua CUNG mot thiet bi (vd id may dien thoai <-> id phien web cua trang
//   call-web.html cua no). `src/calls.ts` dang ky qua `alias()` khi `join()` / `resumeSession()` / `webHello()` doi id;
//   nho vay hoi bang id nao cua thiet bi do cung thay cung mot muc. `list()`/`clear()` con nhan them `also` = cac id
//   biet duoc NGAY LUC HOI (phien web dang khai `phone`) — de cuoc goi ma may tu choi tu app (khong `join`) van hien.
//
// Schema mot BAN GHI (file /data/rwv-call-log.json, mang JSON):
//   id                 — id cuoc goi
//   from               — {id, kind: 'panel'|'phone'|'web', name, also?: string[]}  ben GOI
//   to                 — {…}                                                       ben NHAN
//   startedAt          — luc NGHE may (0 = chua ai nghe)
//   endedAt            — luc ket thuc (0 = dang do chuong -> KHONG tra ra API)
//   state              — 'answered' | 'missed' | 'declined' | 'cancelled' | 'failed'
//   byId               — thiet bi bam cup / tu choi ('' = het gio / mat ket noi / loi)
//   ts                 — luc tao ban ghi (sap xep, don file)
//
// Mot MUC tra ra API (giu nguyen hop dong cu voi call-ui.js):
//   {id, self, dir: 'in'|'out', peerId, peerName, peerKind, startedAt, endedAt, durationMs, state, byMe, ts}
//   — `dir` tinh theo `self`; `durationMs` = endedAt - startedAt CHI khi `state === 'answered'`, con lai 0.
//
// MUC DANG DO CHUONG (chua co `endedAt`) KHONG tra ra API: trang goi da tu hien cuoc goi dang chay, con nhat ky chi
// liet ke cuoc goi da xong (tranh mot dong "đang gọi" vo nghia khi server khoi dong lai giua cuoc).
import fs from 'node:fs';
import path from 'node:path';

export type CallDir = 'in' | 'out';
export type CallPeerKind = 'panel' | 'phone' | 'web';
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'cancelled' | 'failed';

/** Mot dau cuoc goi (man hinh / dien thoai / phien web) — src/calls.ts truyen vao. */
export interface CallSide {
  id: string;
  kind: CallPeerKind;
  name: string;
  /** (03/12/2026) Id KHAC cua CUNG thiet bi (id may <-> id phien web cua no) — xem `CallLog.alias()`. */
  also?: string[];
}

/** MOT cuoc goi = MOT ban ghi (xem "MOT CUA GOI = MOT BAN GHI" o dau file). */
export interface CallRecord {
  id: string;
  from: CallSide;
  to: CallSide;
  startedAt: number;
  endedAt: number;
  state: CallOutcome;
  byId: string;
  ts: number;
}

/** Mot muc NHAT KY da PROJECT theo `self` — hop dong API/UI khong doi so voi ban cu. */
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

/** So BAN GHI (cuoc goi) toi da giu trong file. */
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

/** Chuan hoa mot dau cuoc goi tu du lieu bat ky (client / file cu). */
const side = (s: Partial<CallSide> | undefined, fallbackId = ''): CallSide => {
  const id = clean(s?.id, 64) || clean(fallbackId, 64);
  const also = (Array.isArray(s?.also) ? s!.also : [])
    .map((x) => clean(x, 64)).filter((x) => !!x && x !== id);
  const out: CallSide = { id, kind: isKind(s?.kind) ? s!.kind : 'web', name: clean(s?.name, 60) || id };
  if (also.length) out.also = [...new Set(also)].slice(0, 6);
  return out;
};

/** MOI id cua mot thiet bi (id chinh + id thay the da biet). */
const idsOf = (s: CallSide): string[] => [s.id, ...(s.also || [])];
const hasAny = (s: CallSide, ids: Set<string>): boolean => idsOf(s).some((x) => ids.has(x));

/** Cac id khac `self` trong danh sach goi y (bo rong / trung / qua dai). */
const otherIds = (also: string[] | undefined, self: string): string[] =>
  (Array.isArray(also) ? also : [])
    .map((x) => clean(x, 64))
    .filter((x) => !!x && x !== self)
    .slice(0, 8);

/** Project mot ban ghi thanh muc cua `self` (dir theo self, peer = ben kia). */
const project = (r: CallRecord, dir: CallDir, self: string, mine: CallSide): CallLogItem => {
  const peer = dir === 'out' ? r.to : r.from;
  return {
    id: r.id,
    self,
    dir,
    peerId: peer.id,
    peerName: peer.name,
    peerKind: peer.kind,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    // (03/12/2026) thoi luong CHI co nghia khi da nghe; missed/declined = 0.
    durationMs: r.state === 'answered' && r.endedAt > r.startedAt ? r.endedAt - r.startedAt : 0,
    state: r.state,
    byMe: !!r.byId && idsOf(mine).includes(r.byId),
    ts: r.ts,
  };
};

/**
 * So nhat ky cuoc goi (THUAN luu tru, khong mang): nap luc khoi tao, ghi file sau moi thay doi.
 * `file === null` = chi giu trong bo nho (test).
 */
export class CallLog {
  private recs: CallRecord[] = [];

  constructor(private file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const arr: unknown[] = Array.isArray(j) ? j : Array.isArray((j as any)?.items) ? (j as any).items : [];
      this.recs = this.parse(arr).slice(0, MAX_ITEMS);
    } catch { /* chua co file / file hong: bat dau rong */ }
  }

  /**
   * `start()` — tao MOT ban ghi cho cuoc goi (ca hai dau), trang thai tam (chua `endedAt` -> khong tra ra API).
   * Goi lai voi cung id (khong nen xay ra) = thay ban ghi cu, khong bao gio nhan doi.
   */
  open(callId: string, from: CallSide, to: CallSide, at = Date.now()): void {
    const id = clean(callId, 64);
    if (!id) return;
    const f = side(from), t = side(to);
    if (!f.id || !t.id) return;
    this.recs = this.recs.filter((r) => r.id !== id);
    this.recs.unshift({ id, from: f, to: t, startedAt: 0, endedAt: 0, state: 'cancelled', byId: '', ts: num(at) || Date.now() });
    this.trim();
    this.save();
  }

  /**
   * (03/12/2026) Mot thiet bi co the co NHIEU id (id may dien thoai <-> id phien web `call-web.html?call=` cua no,
   * hoac phien web noi lai WS voi id moi). Dang ky de `list()` tim thay ban ghi bang BAT KY id nao cua thiet bi do.
   * Tra false khi ban ghi khong ton tai / khong ben nao mang id `a` hay `b`.
   */
  alias(callId: string, a: string, b: string): boolean {
    const rec = this.recs.find((r) => r.id === clean(callId, 64));
    const ida = clean(a, 64), idb = clean(b, 64);
    if (!rec || !ida || !idb || ida === idb) return false;
    let hit = false;
    for (const s of [rec.from, rec.to]) {
      if (idsOf(s).includes(ida) && !idsOf(s).includes(idb)) { s.also = [...(s.also || []), idb].slice(0, 6); hit = true; }
      else if (idsOf(s).includes(idb) && !idsOf(s).includes(ida)) { s.also = [...(s.also || []), ida].slice(0, 6); hit = true; }
    }
    if (hit) this.save();
    return hit;
  }

  /** `accept()` — da nghe may: ghi `startedAt` (thoi luong tinh tu day) + `answered`. */
  answered(callId: string, at = Date.now()): void {
    const rec = this.recs.find((r) => r.id === clean(callId, 64));
    if (!rec) return;
    rec.startedAt = num(at) || Date.now();
    rec.state = 'answered';
    this.save();
  }

  /**
   * `finish()` — ket thuc cuoc goi: `endedAt`, `state` (theo [outcomeOf]) va `byId` (ben cup may).
   * `by` co the la id PHIEN WEB cua dien thoai -> doi ve id CHINH cua dau cuoi do, de `byMe` khop voi ca hai ben.
   */
  finish(callId: string, reason: string, by = '', at = Date.now()): void {
    const rec = this.recs.find((r) => r.id === clean(callId, 64));
    if (!rec) return;
    rec.endedAt = num(at) || Date.now();
    rec.state = outcomeOf(reason, rec.startedAt > 0);
    const b = clean(by, 64);
    rec.byId = !b ? '' : idsOf(rec.from).includes(b) ? rec.from.id : idsOf(rec.to).includes(b) ? rec.to.id : b;
    this.save();
  }

  /**
   * Muc cua `self` (hoac tat ca khi `self` rong), moi nhat truoc. Chi muc DA KET THUC.
   * `dir` tinh theo `self` (`out` = may nay goi di, `in` = may nay bi goi), `peer` = ben kia.
   * `also` = cac id KHAC cua cung thiet bi dang biet LUC HOI (vd id may cua phien web dang mo trang
   * `call-web.html?phone=`) — de cuoc goi ma may TU CHOI tu app (khong `join`) van hien trong nhat ky cua trang.
   */
  list(self = '', limit = DEFAULT_LIMIT, also: string[] = []): CallLogItem[] {
    const me = clean(self, 64);
    const ids = new Set(me ? [me, ...otherIds(also, me)] : []);
    const max = Math.max(1, Math.min(MAX_ITEMS, Math.round(Number(limit) || DEFAULT_LIMIT)));
    const out: CallLogItem[] = [];
    for (const r of this.recs) {
      if (!r.endedAt) continue;
      // `self` rong = xem nhu ben GOI (hop dong cu: tra moi cuoc goi mot lan, khong nhan doi).
      const dir: CallDir | null = !me || hasAny(r.from, ids) ? 'out' : hasAny(r.to, ids) ? 'in' : null;
      if (!dir) continue;
      out.push(project(r, dir, me || r.from.id, dir === 'out' ? r.from : r.to));
      if (out.length >= max) break;
    }
    return out;
  }

  /**
   * (02/12/2026) XOA NHAT KY — `POST /calls/log/clear?self=<id>` (src/calls.ts, handleCallsApi):
   *   - `self` = id thiet bi -> xoa cac CUOC GOI LIEN QUAN TOI no (no la `from` hoac `to`, ke ca id thay the), de
   *     nguoi dung xoa tren may nao thi ca hai phia cung sach;
   *   - `self` rong -> xoa TOAN BO.
   * Tra ve SO CUOC GOI da xoa (`removed`), 0 = khong co gi de xoa (van `ok`).
   */
  clear(self = '', also: string[] = []): number {
    const me = clean(self, 64);
    const ids = new Set(me ? [me, ...otherIds(also, me)] : []);
    const before = this.recs.length;
    this.recs = me ? this.recs.filter((r) => !hasAny(r.from, ids) && !hasAny(r.to, ids)) : [];
    const removed = before - this.recs.length;
    if (removed) this.save();
    return removed;
  }

  /** So ban ghi dang giu (ke ca cuoc goi dang do chuong) — test gioi han 200. */
  size(): number { return this.recs.length; }

  /** Bo ban ghi cua mot cuoc goi (test don dep). */
  drop(callId: string): void {
    const before = this.recs.length;
    this.recs = this.recs.filter((r) => r.id !== clean(callId, 64));
    if (this.recs.length !== before) this.save();
  }

  private trim(): void {
    if (this.recs.length > MAX_ITEMS) this.recs.length = MAX_ITEMS;
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.recs));
    } catch { /* bo qua: nhat ky chi de tien, khong duoc lam chet server */ }
  }

  /**
   * Doc du lieu tu file: ho tro CA HAI dinh dang —
   *   - ban ghi moi (`{id, from:{…}, to:{…}, …}`);
   *   - muc cu (2 muc/cuoc: `{id, self, dir, peerId, …}`) -> GOP lai thanh MOT ban ghi (giu lich su khi nang cap
   *     add-on, khong xoa nhat ky cua nguoi dung).
   * Ban ghi thieu `endedAt` (dang do chuong luc server dung) -> bo (khong bao gio ket thuc duoc nua).
   */
  private parse(arr: unknown[]): CallRecord[] {
    const out: CallRecord[] = [];
    const pairs = new Map<string, { o?: any; i?: any }>();
    for (const raw of arr) {
      const it = raw as any;
      if (!it || typeof it.id !== 'string' || !it.id) continue;
      const id = it.id.slice(0, 64);
      // ── Dinh dang MOI: mot ban ghi / mot cuoc goi ──
      if (it.from && typeof it.from === 'object') {
        const from = side(it.from), to = side(it.to);
        if (!from.id || !to.id) continue;
        if (!isOutcome(it.state) || !num(it.endedAt)) continue;
        out.push({
          id, from, to,
          startedAt: num(it.startedAt), endedAt: num(it.endedAt), state: it.state,
          byId: clean(it.byId, 64), ts: num(it.ts) || num(it.endedAt),
        });
        continue;
      }
      // ── Dinh dang CU: moi ben mot muc (self/dir/peerId) ──
      if (typeof it.self === 'string' && it.self && isDir(it.dir)) {
        const g = pairs.get(id) || {};
        g[it.dir === 'out' ? 'o' : 'i'] = it;
        pairs.set(id, g);
      }
    }
    for (const [id, g] of pairs) {
      const o = g.o, i = g.i, src = o || i;
      if (!src || !isOutcome(src.state) || !num(src.endedAt)) continue;
      const fromId = clean(o ? o.self : i.peerId, 64);
      const toId = clean(i ? i.self : o.peerId, 64);
      if (!fromId || !toId) continue;
      out.push({
        id,
        from: side({ id: fromId, kind: i?.peerKind, name: i?.peerName }, fromId),
        to: side({ id: toId, kind: o?.peerKind, name: o?.peerName }, toId),
        startedAt: num(o?.startedAt) || num(i?.startedAt),
        endedAt: num(src.endedAt),
        state: src.state,
        byId: o?.byMe ? fromId : i?.byMe ? toId : '',
        ts: num(src.ts) || num(src.endedAt),
      });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
/** So nhat ky dung chung (src/calls.ts). */
export let callLog = new CallLog(process.env.CALL_LOG_FILE || path.join(DATA_DIR, 'rwv-call-log.json'));

/** Thay so nhat ky (test / khi doi duong dan du lieu). */
export function setCallLog(l: CallLog): void { callLog = l; }
