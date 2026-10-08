// (08/10/2026) BIEU TUONG CANH DONG HO (giot nuoc o mep tren moi trang): pin ben trai (muc day theo % con lai), mang ben
// phai (Wi-Fi 3 vach theo cuong do song, hoac bieu tuong cap mang khi dang dung RJ45). Server doc tu HA moi 30 s
// (st.sb — src/settingsModel.ts statusIconsOf). Tach rieng de thu (statusIcons.test.ts).
import { mdi, svgEl } from './dom';

export type SbNet = { k: 'eth' } | { k: 'wifi'; q: 0 | 1 | 2 | 3 };
export interface SbData { nw: SbNet | null; bt: number | null }

/** Pin yeu (do) tu muc nay tro xuong. */
export const LOW_BATTERY = 20;

/** Khoa cau truc + gia tri: giong nhau thi khong ve lai (moi lan ve la mot khung truyen qua WiFi). */
export function sbKey(sb: SbData | null | undefined): string {
  if (!sb) return '';
  const n = sb.nw ? (sb.nw.k === 'eth' ? 'e' : 'w' + sb.nw.q) : '';
  return n + '|' + (sb.bt == null ? '' : sb.bt);
}

/** Giot nuoc: rong them `extra` px o giua (cho pin + mang hai ben gio), giu nguyen hai duong cong. */
export function dropPath(extra: number): { w: number; d: string } {
  const e = Math.max(0, Math.round(extra)), x = (v: number) => v + e;
  return {
    w: 104 + e,
    d: `M0 0H${x(104)}C${x(91)} 0 ${x(86)} 4 ${x(79)} 11C${x(72)} 18 ${x(64)} 22 ${x(52)} 22H52` +
      'C40 22 32 18 25 11C18 4 13 0 0 0Z',
  };
}

/** Wi-Fi kieu dien thoai: cham + 2 vong cung; q = so phan sang (0 = song rat yeu, chi mo). */
export function wifiIcon(q: number): SVGElement {
  const s = svgEl('svg', { viewBox: '0 0 16 13', class: 'sb-wifi', 'aria-hidden': 'true' });
  const on = (i: number) => (i < q ? '1' : '0.32');
  s.append(
    svgEl('circle', { cx: '8', cy: '11.2', r: '1.6', fill: 'currentColor', opacity: on(0) }),
    svgEl('path', { d: 'M5.17 8.37A4 4 0 0 1 10.83 8.37', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', opacity: on(1) }),
    svgEl('path', { d: 'M2.52 5.71A7.75 7.75 0 0 1 13.48 5.71', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', opacity: on(2) }),
  );
  return s;
}

/** Pin nam ngang, phan day ty le % that; <= LOW_BATTERY thi do. */
export function batteryIcon(pct: number): SVGElement {
  const p = Math.max(0, Math.min(100, pct));
  const s = svgEl('svg', { viewBox: '0 0 25 12', class: 'sb-bat' + (p <= LOW_BATTERY ? ' low' : ''), 'aria-hidden': 'true' });
  s.append(
    svgEl('rect', { x: '0.6', y: '0.6', width: '21', height: '10.8', rx: '3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.1', opacity: '0.55' }),
    svgEl('rect', { x: '22.6', y: '3.8', width: '1.8', height: '4.4', rx: '0.9', fill: 'currentColor', opacity: '0.55' }),
    svgEl('rect', { class: 'lvl', x: '2.2', y: '2.2', width: (Math.max(p, 4) * 17.6 / 100).toFixed(2), height: '7.6', rx: '1.6', fill: 'currentColor' }),
  );
  return s;
}

export function netIcon(nw: SbNet): SVGElement {
  return nw.k === 'eth' ? mdi('ethernet', 'sb-eth') : wifiIcon(nw.q);
}
