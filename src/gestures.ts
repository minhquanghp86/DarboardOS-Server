// (25/09/2026) Nhan dien cu chi MEP MAN HINH o server (docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 3.3).
// Server thay chuoi cham tho cua panel TRUOC trinh duyet -> cu chi chay tren moi trang (ke ca trang chan cham, video,
// iframe khac nguon). Quy tac:
//   - Cham xuong trong dai mep tren + keo xuong > 18 px  -> dieu khien thanh trang thai (Shell) theo ngon tay.
//   - Cham xuong trong dai mep duoi + vuot len > 50 px    -> ve Home cua OS.
//   - Cham NHANH o mep (khong keo) hoac keo NGANG         -> chuyen nguyen cho trang (nut HA, nut dong ho van bam duoc).
import { TouchKind } from './protocol.js';

export interface RawTouch { kind: TouchKind; x: number; y: number; }
export type GestureAction =
  | { type: 'pass'; events: RawTouch[] }
  | { type: 'shade'; phase: 'start' | 'move' | 'end'; y: number }
  | { type: 'home' };

type State = 'idle' | 'pendTop' | 'pendBottom' | 'shade' | 'home' | 'pass';

export const SHADE_START_PX = 18;
export const HOME_SWIPE_PX = 50;
const HORIZONTAL_GIVEUP_PX = 24;

export class EdgeGestures {
  private state: State = 'idle';
  private down: RawTouch | null = null;
  private sx = 0;
  private sy = 0;

  /**
   * px/py: toa do TRANG (sau xoay); raw: toa do thiet bi (de chuyen tiep cho trang nhu cu); pageH: chieu cao trang.
   */
  feed(raw: RawTouch, px: number, py: number, pageH: number): GestureAction[] {
    const edgeTop = Math.max(14, Math.round(pageH * 0.035));
    const edgeBottom = Math.max(16, Math.round(pageH * 0.04));
    switch (raw.kind) {
      case TouchKind.Down:
        this.down = raw; this.sx = px; this.sy = py;
        if (py <= edgeTop) { this.state = 'pendTop'; return []; }
        if (py >= pageH - edgeBottom) { this.state = 'pendBottom'; return []; }
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
        if (this.state === 'shade') return [{ type: 'shade', phase: 'move', y: py }];
        if (this.state === 'home') return [];
        return [{ type: 'pass', events: [raw] }];

      case TouchKind.Up: {
        const s = this.state;
        this.state = 'idle';
        if (s === 'pendTop' || s === 'pendBottom') return [{ type: 'pass', events: [this.down!, raw] }];  // cham nhanh
        if (s === 'shade') return [{ type: 'shade', phase: 'end', y: py }];
        if (s === 'home') return this.sy - py > HOME_SWIPE_PX ? [{ type: 'home' }] : [];
        return [{ type: 'pass', events: [raw] }];
      }

      default:  // Tap (thiet bi tu gop) va loai khac: chuyen nguyen
        return [{ type: 'pass', events: [raw] }];
    }
  }

  private giveUp(raw: RawTouch): GestureAction[] {
    this.state = 'pass';
    return [{ type: 'pass', events: [this.down!, raw] }];
  }
}
