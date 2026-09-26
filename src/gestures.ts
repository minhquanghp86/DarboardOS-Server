// (25/09/2026) Nhan dien cu chi MEP MAN HINH o server (docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 3.3).
// Server thay chuoi cham tho cua panel TRUOC trinh duyet -> cu chi chay tren moi trang (ke ca trang chan cham, video,
// iframe khac nguon). Quy tac:
//   - Cham xuong trong dai mep tren + keo xuong > 18 px  -> dieu khien thanh trang thai (Shell) theo ngon tay.
//   - Cham xuong trong dai mep duoi + vuot len > 50 px    -> ve Home cua OS.
//   - Cham xuong o mep TRAI/PHAI + keo vao trong > 20 px  -> "Quay lai" (kieu Android; tha qua nguong moi thuc hien).
//   - Cham NHANH o mep (khong keo) hoac keo NGANG         -> chuyen nguyen cho trang (nut HA, nut dong ho van bam duoc).
import { TouchKind } from './protocol.js';

export interface RawTouch { kind: TouchKind; x: number; y: number; }
export type GestureAction =
  | { type: 'pass'; events: RawTouch[] }
  | { type: 'shade'; phase: 'start' | 'move' | 'end'; y: number }
  | { type: 'home' }
  /** d = quang duong keo vao trong (px); commit chi co o 'end': true = thuc hien Quay lai. */
  | { type: 'back'; phase: 'start' | 'move' | 'end'; side: 'left' | 'right'; d: number; y: number; commit?: boolean };

type State = 'idle' | 'pendTop' | 'pendBottom' | 'pendSide' | 'shade' | 'home' | 'back' | 'pass';

export const SHADE_START_PX = 18;
export const HOME_SWIPE_PX = 50;
const HORIZONTAL_GIVEUP_PX = 24;
export const BACK_START_PX = 20;
/** Nguong THA de Quay lai: >= 60 px hoac 8% chieu ngang (man 1024 -> 82 px). Ngan hon -> huy, khong lam gi. */
export const backCommitPx = (pageW: number) => Math.max(60, Math.round(pageW * 0.08));

export class EdgeGestures {
  private state: State = 'idle';
  private down: RawTouch | null = null;
  private sx = 0;
  private sy = 0;
  private side: 'left' | 'right' = 'left';
  private pageW = 0;

  /**
   * px/py: toa do TRANG (sau xoay); raw: toa do thiet bi (de chuyen tiep cho trang nhu cu); pageH/pageW: kich thuoc
   * trang (pageW = 0: tat cu chi Quay lai o mep trai/phai).
   */
  feed(raw: RawTouch, px: number, py: number, pageH: number, pageW = 0): GestureAction[] {
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
          if (this.sy - py > 20) { this.state = 'home'; return []; }
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
        if (this.state === 'home') return [];
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
        if (s === 'home') return this.sy - py > HOME_SWIPE_PX ? [{ type: 'home' }] : [];
        return [{ type: 'pass', events: [raw] }];
      }

      default:  // Tap (thiet bi tu gop) va loai khac: chuyen nguyen
        return [{ type: 'pass', events: [raw] }];
    }
  }

  /** Quang duong keo VAO TRONG man hinh tinh tu diem cham xuong. */
  private inward(px: number): number { return this.side === 'left' ? px - this.sx : this.sx - px; }

  private giveUp(raw: RawTouch): GestureAction[] {
    this.state = 'pass';
    return [{ type: 'pass', events: [this.down!, raw] }];
  }
}
