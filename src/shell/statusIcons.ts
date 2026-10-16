// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (08/10/2026) BIEU TUONG CANH DONG HO (giot nuoc o mep tren moi trang): pin ben trai (muc day theo % con lai), mang ben
// phai (Wi-Fi 3 vach theo cuong do song, hoac bieu tuong cap mang khi dang dung RJ45). Server doc tu HA moi 30 s
// (st.sb — src/settingsModel.ts statusIconsOf). Tach rieng de thu (statusIcons.test.ts).
import { mdi, svgEl } from './dom';

export type SbNet = { k: 'eth' } | { k: 'wifi'; q: 0 | 1 | 2 | 3 };
/** (16/10/2026) ch = nguon (firmware battery_monitor.h): none = khong co pin (nguon ngoai), chg = dang sac, full = cam nguon
 *  + day, bat = dang dung pin. Thieu = chua biet (ve pin thuong). */
export type SbPower = 'none' | 'chg' | 'full' | 'bat';
export interface SbData { nw: SbNet | null; bt: number | null; ch?: SbPower }

/** Pin yeu (do) tu muc nay tro xuong. */
export const LOW_BATTERY = 20;

/** Khoa cau truc + gia tri: giong nhau thi khong ve lai (moi lan ve la mot khung truyen qua WiFi). */
export function sbKey(sb: SbData | null | undefined): string {
  if (!sb) return '';
  const n = sb.nw ? (sb.nw.k === 'eth' ? 'e' : 'w' + sb.nw.q) : '';
  return n + '|' + (sb.bt == null ? '' : sb.bt) + (sb.ch ? '|' + sb.ch : '');
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

/** Pin nam ngang, phan day ty le % that; <= LOW_BATTERY thi do. (16/10/2026) Dang sac / cam nguon: xanh la + tia set
 *  (dang sac) — giong dien thoai; dang dung pin: trang (do khi yeu). */
export function batteryIcon(pct: number, ch?: SbPower): SVGElement {
  const p = Math.max(0, Math.min(100, pct));
  const plugged = ch === 'chg' || ch === 'full';
  const s = svgEl('svg', { viewBox: '0 0 25 12', class: 'sb-bat' + (plugged ? ' chg' : p <= LOW_BATTERY ? ' low' : ''), 'aria-hidden': 'true' });
  s.append(
    svgEl('rect', { x: '0.6', y: '0.6', width: '21', height: '10.8', rx: '3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.1', opacity: '0.55' }),
    svgEl('rect', { x: '22.6', y: '3.8', width: '1.8', height: '4.4', rx: '0.9', fill: 'currentColor', opacity: '0.55' }),
    svgEl('rect', { class: 'lvl', x: '2.2', y: '2.2', width: (Math.max(p, 4) * 17.6 / 100).toFixed(2), height: '7.6', rx: '1.6', fill: 'currentColor' }),
  );
  if (ch === 'chg') s.append(svgEl('path', { class: 'bolt', d: 'M12.4 1.2L7.6 6.7H10.6L9.4 10.8L14.4 5.1H11.3Z', fill: '#fff', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': '0.7', 'stroke-linejoin': 'round' }));
  return s;
}

/** (16/10/2026) Phich cam: khong co pin (chay nguon ngoai) hoac cam nguon da day (canh pin). */
export function plugIcon(): SVGElement { return mdi('plug', 'sb-plug'); }

/** Pin + nguon cho thanh trang thai: [pin(+tia set)] [phich cam neu cam nguon da day] / chi phich cam neu khong co pin. */
export function powerIcons(sb: SbData | null | undefined): SVGElement[] {
  if (!sb) return [];
  if (sb.bt != null) return sb.ch === 'full' ? [batteryIcon(sb.bt, sb.ch), plugIcon()] : [batteryIcon(sb.bt, sb.ch)];
  return sb.ch === 'none' ? [plugIcon()] : [];
}

export function netIcon(nw: SbNet): SVGElement {
  return nw.k === 'eth' ? mdi('ethernet', 'sb-eth') : wifiIcon(nw.q);
}
