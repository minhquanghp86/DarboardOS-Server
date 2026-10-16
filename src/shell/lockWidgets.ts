// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (08/10/2026) WIDGET MAN HINH KHOA (st.lw — server >= 2.9.116, src/lockWidgets.ts): server gui so lieu tho, o day viet
// chu tieng Viet theo gio THIET BI ("Ngày mai", "5 phút trước", "1,2 kW") va dung DOM. Tach rieng de thu
// (lockWidgets.test.ts). Khong hoat anh (moi khung doi la mot khung gui qua WiFi).
import { el, mdi, svgEl } from './dom';

/** W, kWh, %. bat + = dang xa; grid + = dang mua dien. */
export interface LwEnergy { pv?: number; pvd?: number; soc?: number; bat?: number; load?: number; grid?: number; ld?: number }
/** t = tieu de; s/e = ms epoch; ad = ca ngay (s/e = nua dem gio dia phuong). */
export interface LwEvent { t: string; s: number; e: number; ad?: 1 }
/** c = camera Frigate, l = nhan (person/car...), sub = ten nhan dien, s = ms epoch bat dau, live = dang dien ra. */
export interface LwCam { id: string; c: string; l: string; sub?: string; s: number; live?: 1 }
export interface LwData { en?: LwEnergy; ev?: LwEvent[]; cam?: LwCam }

export interface LwStat { k: 'pv' | 'pvd' | 'ld' | 'bat' | 'load' | 'grid'; v: string; l: string; cls: string; soc?: number }
export interface LwRow { k: string; ic: string; b: string; t: string; cls: string }
export interface LwModel { stats: LwStat[]; rows: LwRow[]; key: string }

const LABELS: Record<string, string> = { person: 'Người', car: 'Ô tô', motorcycle: 'Xe máy', bicycle: 'Xe đạp', bus: 'Xe buýt',
  truck: 'Xe tải', dog: 'Chó', cat: 'Mèo', bird: 'Chim', horse: 'Ngựa', face: 'Khuôn mặt', license_plate: 'Biển số', package: 'Bưu kiện' };
const WD = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const DAY = 86_400_000;
const CAM_WINDOW_MS = 3_600_000;
/** Duoi nguong nay coi nhu pin nghi / khong mua ban dien (nhieu do cua bien tan). */
const IDLE_W = 25;

const pad = (n: number) => (n < 10 ? '0' : '') + n;
/** So thu tu ngay DIA PHUONG cua thoi diem ms (tz = phut lech UTC). */
const dayNo = (ms: number, tz: number) => Math.floor((ms + tz * 60_000) / DAY);
const local = (ms: number, tz: number) => new Date(ms + tz * 60_000);

export function fmtW(w: number): string {
  const a = Math.abs(w);
  // Lam tron tren so nguyen (3150 W -> 3,2 kW; toFixed tren 3.15 cho 3,1 vi sai so dau phay dong).
  return a < 999.5 ? `${Math.round(a)} W` : a < 9950 ? `${(Math.round(a / 100) / 10).toFixed(1).replace('.', ',')} kW` : `${Math.round(a / 1000)} kW`;
}
export function fmtKwh(k: number): string { return `${String(Math.round(k * 10) / 10).replace('.', ',')} kWh`; }

export function eventWhen(e: LwEvent, now: number, tz: number): string {
  const d = dayNo(e.s, tz) - dayNo(now, tz), x = local(e.s, tz), wd = WD[x.getUTCDay()];
  if (e.ad) return d <= 0 ? 'Hôm nay' : d === 1 ? 'Ngày mai' : `${wd} ${x.getUTCDate()}/${x.getUTCMonth() + 1}`;
  if (e.s <= now) return 'Đang diễn ra';
  const hm = `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
  return d === 0 ? hm : d === 1 ? `Mai ${hm}` : `${wd} ${hm}`;
}
export function camName(c: string): string {
  return c === 'p4_panel' ? 'Panel P4' : c.replace(/_/g, ' ').replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}
export function camWhen(c: LwCam, now: number): string {
  if (c.live) return 'Đang phát hiện';
  const m = Math.floor((now - c.s) / 60_000);
  return m < 1 ? 'Vừa xong' : `${m} phút trước`;
}

/** (16/10/2026) 6 chi so theo thu tu nguoi dung chon: PV hom nay (kWh) · Cong suat PV (W) · Tai hom nay (kWh) · Tieu thu
 *  luoi (W) · Tieu thu tai (W) · Pin % (dang sac / xa bao nhieu). Thieu cam bien nao thi bo o do. */
export function energyStats(en: LwEnergy): LwStat[] {
  const out: LwStat[] = [];
  const sun = en.pv == null || en.pv >= 5 ? 'sun' : 'sun off';
  if (en.pvd != null) out.push({ k: 'pvd', v: fmtKwh(en.pvd), l: 'PV hôm nay', cls: sun });
  if (en.pv != null) out.push({ k: 'pv', v: fmtW(en.pv), l: en.pvd != null ? 'Công suất PV' : 'Mặt trời', cls: sun });
  if (en.ld != null) out.push({ k: 'ld', v: fmtKwh(en.ld), l: 'Tải hôm nay', cls: 'load' });
  const g = en.grid;
  if (g != null) out.push({ k: 'grid', v: fmtW(g), l: g < -IDLE_W ? 'Bán lưới' : 'Tiêu thụ lưới', cls: 'grid' });
  if (en.load != null) out.push({ k: 'load', v: fmtW(en.load), l: 'Tiêu thụ tải', cls: 'load' });
  if (en.soc != null || en.bat != null) {
    const p = en.bat ?? 0, soc = en.soc != null ? Math.round(en.soc) : undefined;
    out.push({
      k: 'bat', v: soc != null ? `${soc}%` : fmtW(p),
      l: p > IDLE_W ? `Đang xả ${fmtW(p)}` : p < -IDLE_W ? `Đang sạc ${fmtW(p)}` : 'Pin',
      cls: soc == null || soc >= 50 ? 'b-ok' : soc >= 20 ? 'b-mid' : 'b-low', ...(soc != null ? { soc } : {}),
    });
  }
  return out;
}

/** Dong lich / camera: camera DANG phat hien len dau; lich (toi da maxEv) roi camera da xong. */
export function lwRows(lw: LwData, now: number, tz: number, maxEv = 2): LwRow[] {
  const c = lw.cam && (lw.cam.live || now - lw.cam.s < CAM_WINDOW_MS) ? lw.cam : null;
  const cam: LwRow | null = c ? {
    k: `cam:${c.id}:${c.live ? 1 : 0}`, ic: 'cctv', b: camWhen(c, now), cls: 'cam' + (c.live ? ' live' : ''),
    t: (LABELS[c.l] || c.l) + (c.sub ? ` (${c.sub})` : '') + ' · ' + camName(c.c),
  } : null;
  const ev = (lw.ev || []).filter((e) => e.e > now).slice(0, maxEv)
    .map((e): LwRow => ({ k: `ev:${e.s}:${e.t}`, ic: 'calclock', b: eventWhen(e, now, tz), t: e.t, cls: 'cal' }));
  return cam && c!.live ? [cam, ...ev] : cam ? [...ev, cam] : ev;
}

/** null = khong co gi de hien. key = CAU TRUC (doi thi ve ngay); con lai (so lieu) doi thi cho luc doi phut. */
export function lwModel(lw: LwData | null | undefined, now: number, tz: number, maxEv = 2): LwModel | null {
  if (!lw) return null;
  const stats = lw.en ? energyStats(lw.en) : [], rows = lwRows(lw, now, tz, maxEv);
  if (!stats.length && !rows.length) return null;
  return { stats, rows, key: stats.map((s) => s.k).join() + '|' + rows.map((r) => r.k).join() };
}

/** Bieu tuong pin ve theo % (muc day ty le that, khong phai 7 nac cua MDI). */
function batteryIcon(soc: number | undefined): SVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'ic', 'aria-hidden': 'true' });
  s.append(svgEl('rect', { x: '1.8', y: '6.6', width: '18', height: '10.8', rx: '2.4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7' }),
    svgEl('rect', { x: '20.6', y: '9.9', width: '2', height: '4.2', rx: '0.9', fill: 'currentColor' }));
  if (soc != null) {
    const w = 14.2 * Math.max(4, Math.min(100, soc)) / 100;
    s.append(svgEl('rect', { x: '3.7', y: '8.5', width: w.toFixed(2), height: '7', rx: '1.1', fill: 'currentColor' }));
  }
  return s;
}

export function buildLockWidgets(m: LwModel): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (m.stats.length) {
    const strip = el('div', 'lw-en');
    for (const s of m.stats) {
      const box = el('div', 'lw-s ' + s.cls), tx = el('div', 'lw-tx');
      tx.append(el('div', 'lw-v', s.v), el('div', 'lw-l', s.l));
      box.append(s.k === 'bat' ? batteryIcon(s.soc) : mdi(s.k === 'pvd' ? 'solar' : s.k === 'pv' ? 'sun' : s.k === 'load' ? 'homebolt' : s.k === 'ld' ? 'homebolto' : 'tower'), tx);
      strip.append(box);
    }
    out.push(strip);
  }
  for (const r of m.rows) {
    const row = el('div', 'lw-r ' + r.cls), ic = el('span', 'lw-ri'), tx = el('span', 'lw-rt');
    ic.append(mdi(r.ic));
    tx.append(el('b', '', r.b), document.createTextNode(' ' + r.t));
    row.append(ic, tx);
    out.push(row);
  }
  return out;
}
