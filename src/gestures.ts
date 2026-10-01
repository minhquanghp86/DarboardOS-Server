// (25/09/2026) Nhan dien cu chi MEP MAN HINH o server (docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 3.3).
// Server thay chuoi cham tho cua panel TRUOC trinh duyet -> cu chi chay tren moi trang (ke ca trang chan cham, video,
// iframe khac nguon). Quy tac:
//   - Cham xuong trong dai mep tren + keo xuong > 18 px  -> dieu khien thanh trang thai (Shell) theo ngon tay.
//   - Cham xuong trong dai mep duoi + vuot len > 50 px    -> ve Home cua OS.
//     ... vuot qua nguong "Gan day" roi GIU YEN ~0,35 s   -> mo "Gan day" (nhu dien thoai), tha tay khong ve Home nua.
//   - Cham xuong o mep TRAI/PHAI + keo vao trong > 20 px  -> "Quay lai" (kieu Android; tha qua nguong moi thuc hien).
//   - Cham NHANH o mep (khong keo) hoac keo NGANG         -> chuyen nguyen cho trang (nut HA, nut dong ho van bam duoc).
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

type State = 'idle' | 'pendTop' | 'pendBottom' | 'pendSide' | 'shade' | 'home' | 'back' | 'pass';

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

  /**
   * px/py: toa do TRANG (sau xoay); raw: toa do thiet bi (de chuyen tiep cho trang nhu cu); pageH/pageW: kich thuoc
   * trang (pageW = 0: tat cu chi Quay lai o mep trai/phai).
   */
  feed(raw: RawTouch, px: number, py: number, pageH: number, pageW = 0, now = Date.now()): GestureAction[] {
    this.pageH = pageH;
    const edgeTop = Math.max(14, Math.round(pageH * 0.035));
    const edgeBottom = Math.max(16, Math.round(pageH * 0.04));
    // Dai mep ben mong (18 px tren 1024, 12 px tren 480): cuon ngang/thanh truot sat mep hiem khi bat dau o day.
    const edgeSide = Math.max(12, Math.round(pageW * 0.018));
    switch (raw.kind) {
      case TouchKind.Down:
        this.down = raw; this.sx = px; this.sy = py;
        if (py <= edgeTop) { this.state = 'pendTop'; return []; }
        if (py >= pageH - edgeBottom) { this.state = 'pendBottom'; return []; }
        if (pageW > 0 && (px <= edgeSide || px >= pageW - edgeSide)) {
          this.state = 'pendSide'; this.side = px <= edgeSide ? 'left' : 'right'; this.pageW = pageW; return [];
        }
        this.state = 'pass';
        return [{ type: 'pass', events: [raw] }];

      case TouchKind.Move:
        if (this.state === 'pendTop') {
          if (py - this.sy > SHADE_START_PX) {
            this.state = 'shade';
            return [{ type: 'shade', phase: 'start', y: this.sy }, { type: 'shade', phase: 'move', y: py }];
          }
          if (Math.abs(px - this.sx) > HORIZONTAL_GIVEUP_PX) return this.giveUp(raw);
          return [];
        }
        if (this.state === 'pendBottom') {
          if (this.sy - py > 20) {
            this.state = 'home'; this.holdFired = false;
            this.homeD = this.sy - py; this.holdY = py; this.holdSince = now;
            return [{ type: 'homeDrag', phase: 'start', d: this.homeD }];
          }
          if (Math.abs(px - this.sx) > HORIZONTAL_GIVEUP_PX) return this.giveUp(raw);
          return [];
        }
        if (this.state === 'pendSide') {
          const d = this.inward(px);
          if (d > BACK_START_PX && Math.abs(py - this.sy) < d) {
            this.state = 'back';
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
        const s = this.state;
        this.state = 'idle';
        if (s === 'pendTop' || s === 'pendBottom' || s === 'pendSide') return [{ type: 'pass', events: [this.down!, raw] }];  // cham nhanh
        if (s === 'back') {
          const d = Math.max(0, this.inward(px));
          return [{ type: 'back', phase: 'end', side: this.side, d, y: py, commit: d >= backCommitPx(this.pageW) }];
        }
        if (s === 'shade') return [{ type: 'shade', phase: 'end', y: py }];
        if (s === 'home') {
          if (this.holdFired) return [];                       // da mo Gan day luc giu — tha tay khong lam gi them
          const d = this.sy - py;
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
    if (this.state !== 'home' || this.holdFired) return [];
    if (this.homeD < recentsSwipePx(this.pageH) || now - this.holdSince < RECENTS_HOLD_MS) return [];
    this.holdFired = true;
    return [{ type: 'homeDrag', phase: 'end', d: this.homeD }, { type: 'recents' }];
  }

  /** Thoi diem (ms) can goi poll() tiep theo, hoac null neu khong co cu chi giu nao dang cho. */
  holdDeadline(): number | null {
    if (this.state !== 'home' || this.holdFired || this.homeD < recentsSwipePx(this.pageH)) return null;
    return this.holdSince + RECENTS_HOLD_MS;
  }

  /** Quang duong keo VAO TRONG man hinh tinh tu diem cham xuong. */
  private inward(px: number): number { return this.side === 'left' ? px - this.sx : this.sx - px; }

  private giveUp(raw: RawTouch): GestureAction[] {
    this.state = 'pass';
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
