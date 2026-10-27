// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (25/09/2026) Nhan dien cu chi MEP MAN HINH o server (Dashboard OS-Client: docs/server-noi-bo/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 3.3).
// Server thay chuoi cham tho cua panel TRUOC trinh duyet -> cu chi chay tren moi trang (ke ca trang chan cham, video,
// iframe khac nguon). Quy tac:
//   - Cham xuong trong dai mep tren + keo xuong > 18 px  -> dieu khien thanh trang thai (Shell) theo ngon tay.
//   - Cham xuong trong dai mep duoi + vuot len > 50 px    -> ve Home cua OS.
//     ... vuot qua nguong "Gan day" roi GIU YEN ~0,35 s   -> mo "Gan day" (nhu dien thoai), tha tay khong ve Home nua.
//   - Cham xuong o mep TRAI/PHAI + keo vao trong > 20 px  -> "Quay lai" (kieu Android; tha qua nguong moi thuc hien).
//   - Cham NHANH o mep (khong keo) hoac keo NGANG         -> chuyen nguyen cho trang (nut HA, nut dong ho van bam duoc).
// (08/10/2026, log [cu chi] THAT) GOC LOI that su: goi "nhac tay" cua firmware luon mang toa do (0,0) — truoc day dung toa
// do do de tinh quang duong keo: S3 xoay 180 -> (479,479) -> vuot mep phai / tu duoi len luon "keo chua du"; P4 khong
// xoay -> mep trai hong, mep phai an. Nay luon dung VI TRI DI CHUYEN CUOI (lx/ly) khi nhac tay.
// (08/10/2026) Nguoi dung bao: P4 vuot mep TRAI, S3 (xoay 180°) vuot mep PHAI va tu DUOI len KHONG tac dung — ca ba deu
// la canh toa do tho NHO cua chip GT911. Dai mep cu (P4 18 px, S3 chi 12 px ~ 1,8 mm) hep hon dien thoai (~4-5 mm):
// vuot tu vien vao, chip bao diem DAU TIEN khi ngon tay da chay vao trong. Sua: (1) noi dai mep theo co dien thoai;
// (2) DAI MO RONG: cham xuong trong do chi tinh la cu chi khi ngon tay "LAO VAO TU NGOAI VIEN" — trong FLICK_WINDOW_MS da
// chay vao trong >= FLICK_MIN_PX (keo thanh truot / cham thuong sat mep luon dung lai mot chut truoc khi keo -> van
// chuyen cho trang, toi da tre FLICK_WINDOW_MS); (3) ghi log moi lan cham sat mep (InputRouter) de chinh theo so lieu.
import { TouchKind } from './protocol.js';

export interface RawTouch { kind: TouchKind; x: number; y: number; }
export type GestureAction =
  | { type: 'pass'; events: RawTouch[] }
  | { type: 'shade'; phase: 'start' | 'move' | 'end'; y: number }
  | { type: 'home' }
  | { type: 'recents' }
  /** Chi bao cho thanh chi bao o mep duoi (Shell): d = quang duong vuot len (px). */
  | { type: 'homeDrag'; phase: 'start' | 'move' | 'end'; d: number }
  /** d = quang duong keo vao trong (px); commit chi co o 'end': true = thuc hien Quay lai. */
  | { type: 'back'; phase: 'start' | 'move' | 'end'; side: 'left' | 'right'; d: number; y: number; commit?: boolean };

type State = 'idle' | 'pendTop' | 'pendBottom' | 'pendSide' | 'pendExt' | 'shade' | 'home' | 'back' | 'pass';
/** (08/10/2026) Ban ghi mot lan cham sat mep (InputRouter ghi log luc nhac tay). */
export interface EdgeReport {
  edge: 'left' | 'right' | 'bottom' | 'top'; band: 'core' | 'ext'; x: number; y: number;
  /** Lan di chuyen dau tien: sau bao nhieu ms, di bao nhieu px vao trong. */
  first?: { dt: number; d: number };
  result: 'back' | 'back-huy' | 'home' | 'home-huy' | 'recents' | 'shade' | 'cham' | 'trang';
}

export const SHADE_START_PX = 18;
export const HOME_SWIPE_PX = 50;
const HORIZONTAL_GIVEUP_PX = 24;
export const BACK_START_PX = 20;
/** Giu yen (xe dich < HOLD_JITTER_PX) bao lau sau khi da vuot qua nguong Gan day thi mo Gan day. */
export const RECENTS_HOLD_MS = 350;
const HOLD_JITTER_PX = 10;
/** Nguong vuot len de "giu" mo Gan day: >= 90 px hoac 15% chieu cao (600 -> 90 px, 272 -> 90 px). */
export const recentsSwipePx = (pageH: number) => Math.max(90, Math.round(pageH * 0.15));
/** Nguong THA de Quay lai: >= 60 px hoac 8% chieu ngang (man 1024 -> 82 px). Ngan hon -> huy, khong lam gi. */
export const backCommitPx = (pageW: number) => Math.max(60, Math.round(pageW * 0.08));
/** (08/10/2026) Dai mep (px trang). Cot loi: cham la bat dau cho cu chi. Mo rong: chi khi ngon tay lao vao tu ngoai vien. */
export function edgeBands(pageW: number, pageH: number) {
  return {
    // (20/10/2026) Nguoi dung yeu cau rong hon: vo nhua can mep nen phai vuot sat moi an. Tang ~1,6 lan ca 4 phia.
    top: Math.max(30, Math.round(pageH * 0.06)),                  // 480 -> 30, 600 -> 36
    bottom: Math.max(38, Math.round(pageH * 0.08)),               // 480 -> 38, 600 -> 48
    side: Math.max(34, Math.round(pageW * 0.045)),                // 480 -> 34, 800 -> 36, 1024 -> 46
    bottomExt: Math.max(64, Math.round(pageH * 0.14)),            // 480 -> 67, 600 -> 84
    sideExt: Math.max(80, Math.round(pageW * 0.11)),              // 480 -> 80, 800 -> 88, 1024 -> 113
  };
}
/** Dai mo rong: trong bay nhieu ms sau khi cham phai chay vao trong it nhat bay nhieu px (~0,17 px/ms tro len). */
export const FLICK_WINDOW_MS = 60;
export const FLICK_MIN_PX = 10;

export class EdgeGestures {
  private state: State = 'idle';
  private down: RawTouch | null = null;
  private sx = 0;
  private sy = 0;
  private side: 'left' | 'right' = 'left';
  private pageW = 0;
  private pageH = 0;
  // Vuot tu mep duoi: quang duong hien tai, moc bat dau dung yen, da mo Gan day chua.
  private homeD = 0;
  private holdY = 0;
  private holdSince = 0;
  private holdFired = false;
  private downAt = 0;
  /** Vi tri cham / di chuyen gan nhat (trang) — goi "nhac tay" cua firmware mang (0,0), khong dung duoc. */
  private lx = 0;
  private ly = 0;
  /** Dai mo rong: cham xuong nam trong dai canh (extSide) va/hoac dai duoi (extBottom) — goc man hinh co the ca hai. */
  private extSide = false;
  private extBottom = false;
  private report: EdgeReport | null = null;
  /** (08/10/2026) Bo cu chi dang do (vd man hinh vua khoa giua chung). */
  reset(): void { this.state = 'idle'; this.report = null; }
  /** Lay (va xoa) ban ghi lan cham sat mep vua xong — goi sau khi nhac tay. */
  takeReport(): EdgeReport | null { const r = this.report; if (r && this.state !== 'idle') return null; this.report = null; return r; }

  /**
   * px/py: toa do TRANG (sau xoay); raw: toa do thiet bi (de chuyen tiep cho trang nhu cu); pageH/pageW: kich thuoc
   * trang (pageW = 0: tat cu chi Quay lai o mep trai/phai).
   */
  feed(raw: RawTouch, px: number, py: number, pageH: number, pageW = 0, now = Date.now()): GestureAction[] {
    this.pageH = pageH;
    const B = edgeBands(pageW, pageH);
    switch (raw.kind) {
      case TouchKind.Down: {
        this.down = raw; this.sx = px; this.sy = py; this.lx = px; this.ly = py; this.downAt = now; this.report = null;
        const rep = (edge: EdgeReport['edge'], band: EdgeReport['band']) => { this.report = { edge, band, x: Math.round(px), y: Math.round(py), result: 'cham' }; };
        if (py <= B.top) { this.state = 'pendTop'; rep('top', 'core'); return []; }
        if (py >= pageH - B.bottom) { this.state = 'pendBottom'; rep('bottom', 'core'); return []; }
        if (pageW > 0 && (px <= B.side || px >= pageW - B.side)) {
          this.state = 'pendSide'; this.side = px <= B.side ? 'left' : 'right'; this.pageW = pageW; rep(this.side, 'core'); return [];
        }
        this.extSide = pageW > 0 && (px <= B.sideExt || px >= pageW - B.sideExt);
        this.extBottom = py >= pageH - B.bottomExt;
        if (this.extSide || this.extBottom) {
          if (this.extSide) { this.side = px <= B.sideExt ? 'left' : 'right'; this.pageW = pageW; }
          this.state = 'pendExt'; rep(this.extSide ? this.side : 'bottom', 'ext'); return [];
        }
        this.state = 'pass';
        return [{ type: 'pass', events: [raw] }];
      }

      case TouchKind.Move:
        this.lx = px; this.ly = py;
        if (this.state === 'pendExt') {
          const dt = now - this.downAt, dx = px - this.sx, dy = py - this.sy;
          const dSide = this.extSide ? this.inward(px) : -Infinity, dUp = this.extBottom ? -dy : -Infinity;
          const toSide = dt <= FLICK_WINDOW_MS && dSide >= FLICK_MIN_PX && Math.abs(dy) <= dSide;
          const toUp = dt <= FLICK_WINDOW_MS && dUp >= FLICK_MIN_PX && Math.abs(dx) <= dUp;
          if (this.report && !this.report.first) this.report.first = { dt, d: Math.round(Math.max(dSide, dUp)) };
          if (toSide || toUp) {                                     // lao vao tu ngoai vien -> xu ly nhu dai cot loi
            this.state = toSide && (!toUp || dSide >= dUp) ? 'pendSide' : 'pendBottom';
            if (this.report) this.report.edge = this.state === 'pendSide' ? this.side : 'bottom';
            return this.feed(raw, px, py, pageH, pageW, now);
          }
          if (dt <= FLICK_WINDOW_MS && Math.max(Math.abs(dx), Math.abs(dy)) < FLICK_MIN_PX) return [];  // con trong cua so: cho
          return this.giveUp(raw);
        }
        if (this.report && !this.report.first && (this.state === 'pendSide' || this.state === 'pendBottom' || this.state === 'pendTop')) {
          this.report.first = { dt: now - this.downAt, d: Math.round(this.state === 'pendSide' ? this.inward(px) : this.state === 'pendBottom' ? this.sy - py : py - this.sy) };
        }
        if (this.state === 'pendTop') {
          if (py - this.sy > SHADE_START_PX) {
            this.state = 'shade'; if (this.report) this.report.result = 'shade';
            return [{ type: 'shade', phase: 'start', y: this.sy }, { type: 'shade', phase: 'move', y: py }];
          }
          if (Math.abs(px - this.sx) > HORIZONTAL_GIVEUP_PX) return this.giveUp(raw);
          return [];
        }
        if (this.state === 'pendBottom') {
          if (this.sy - py > 20) {
            this.state = 'home'; this.holdFired = false; if (this.report) this.report.result = 'home';
            this.homeD = this.sy - py; this.holdY = py; this.holdSince = now;
            return [{ type: 'homeDrag', phase: 'start', d: this.homeD }];
          }
          if (Math.abs(px - this.sx) > HORIZONTAL_GIVEUP_PX) return this.giveUp(raw);
          return [];
        }
        if (this.state === 'pendSide') {
          const d = this.inward(px);
          if (d > BACK_START_PX && Math.abs(py - this.sy) < d) {
            this.state = 'back'; if (this.report) this.report.result = 'back-huy';
            return [{ type: 'back', phase: 'start', side: this.side, d, y: py }];
          }
          if (Math.abs(py - this.sy) > HORIZONTAL_GIVEUP_PX) return this.giveUp(raw);  // keo doc sat mep: cuon trang
          return [];
        }
        if (this.state === 'back') return [{ type: 'back', phase: 'move', side: this.side, d: Math.max(0, this.inward(px)), y: py }];
        if (this.state === 'shade') return [{ type: 'shade', phase: 'move', y: py }];
        if (this.state === 'home') {
          if (this.holdFired) return [];
          this.homeD = Math.max(0, this.sy - py);
          if (Math.abs(py - this.holdY) > HOLD_JITTER_PX) { this.holdY = py; this.holdSince = now; }
          return [{ type: 'homeDrag', phase: 'move', d: this.homeD }, ...this.poll(now)];
        }
        return [{ type: 'pass', events: [raw] }];

      case TouchKind.Up: {
        px = this.lx; py = this.ly;   // (0,0) cua goi nhac tay -> vi tri di chuyen cuoi
        const s = this.state;
        this.state = 'idle';
        if (s === 'pendTop' || s === 'pendBottom' || s === 'pendSide' || s === 'pendExt') {
          return [{ type: 'pass', events: [this.down!, raw] }];  // cham nhanh
        }
        if (s === 'back') {
          const d = Math.max(0, this.inward(px)), commit = d >= backCommitPx(this.pageW);
          if (this.report) this.report.result = commit ? 'back' : 'back-huy';
          return [{ type: 'back', phase: 'end', side: this.side, d, y: py, commit }];
        }
        if (s === 'shade') return [{ type: 'shade', phase: 'end', y: py }];
        if (s === 'home') {
          if (this.holdFired) return [];                       // da mo Gan day luc giu — tha tay khong lam gi them
          const d = this.sy - py;
          if (this.report) this.report.result = d > HOME_SWIPE_PX ? 'home' : 'home-huy';
          return [{ type: 'homeDrag', phase: 'end', d: Math.max(0, d) }, ...(d > HOME_SWIPE_PX ? [{ type: 'home' } as const] : [])];
        }
        return [{ type: 'pass', events: [raw] }];
      }

      default:  // Tap (thiet bi tu gop) va loai khac: chuyen nguyen
        return [{ type: 'pass', events: [raw] }];
    }
  }

  /**
   * Goi theo hen gio (xem holdDeadline): ngon tay da vuot qua nguong Gan day va dung yen du lau -> mo Gan day. Tach
   * khoi feed() vi "giu yen" la luc KHONG co su kien cham nao den (firmware co the khong gui Move khi dung yen).
   */
  poll(now = Date.now()): GestureAction[] {
    // (08/10/2026) Dai mo rong: het cua so ma ngon tay chua lao vao -> cham thuong, chuyen ngay cho trang.
    if (this.state === 'pendExt' && now - this.downAt >= FLICK_WINDOW_MS) {
      this.state = 'pass'; if (this.report) this.report.result = 'trang';
      return [{ type: 'pass', events: [this.down!] }];
    }
    if (this.state !== 'home' || this.holdFired) return [];
    if (this.homeD < recentsSwipePx(this.pageH) || now - this.holdSince < RECENTS_HOLD_MS) return [];
    this.holdFired = true; if (this.report) this.report.result = 'recents';
    return [{ type: 'homeDrag', phase: 'end', d: this.homeD }, { type: 'recents' }];
  }

  /** Thoi diem (ms) can goi poll() tiep theo, hoac null neu khong co cu chi giu nao dang cho. */
  holdDeadline(): number | null {
    if (this.state === 'pendExt') return this.downAt + FLICK_WINDOW_MS;
    if (this.state !== 'home' || this.holdFired || this.homeD < recentsSwipePx(this.pageH)) return null;
    return this.holdSince + RECENTS_HOLD_MS;
  }

  /** Quang duong keo VAO TRONG man hinh tinh tu diem cham xuong. */
  private inward(px: number): number { return this.side === 'left' ? px - this.sx : this.sx - px; }

  private giveUp(raw: RawTouch): GestureAction[] {
    this.state = 'pass';
    if (this.report && this.report.result === 'cham') this.report.result = 'trang';
    return [{ type: 'pass', events: [this.down!, raw] }];
  }
}

// (01/10/2026) YOUTUBE TV (tab 'yttv') chi dieu khien bang phim (remote): cham = click van chay, nhung vuot bi bo qua.
// Doi vuot thanh phim mui ten nhu dien thoai: vuot LEN = noi dung di len = xuong hang DUOI (ArrowDown); vuot TRAI =
// sang o ben PHAI (ArrowRight). Vuot dai = nhieu buoc (~1 buoc / 120 px, toi da 6). Duoi nguong = cham, khong gui gi.
export const TV_SWIPE_MIN_PX = 40;
export type TvKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export function tvSwipeKeys(dx: number, dy: number): TvKey[] {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < TV_SWIPE_MIN_PX) return [];
  const horiz = ax > ay;
  const key: TvKey = horiz ? (dx < 0 ? 'ArrowRight' : 'ArrowLeft') : (dy < 0 ? 'ArrowDown' : 'ArrowUp');
  const steps = Math.max(1, Math.min(6, Math.round((horiz ? ax : ay) / 120)));
  return new Array(steps).fill(key);
}
export const TV_KEY_CODE: Record<TvKey, number> = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
