// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) Nguon anh cua khung anh so: thu muc media/photos + album Google Photos chia se; chon anh ke tiep (ngau
// nhien khong lap lai gan day / theo thu tu), lich su de VUOT xem anh truoc/sau, chu thich (ngay chup, album).
import path from 'node:path';
import sharp from 'sharp';
import { cachedAlbum, exifDate, fetchAlbum } from './photoFrame.js';
import type { FrameSettings } from './panelPrefs.js';

/** Mot anh: 'f' = tep trong thu muc anh (duong dan tuong doi), 'g' = anh album Google (URL goc lh3). */
export interface PhotoRef { k: 'f' | 'g'; id: string }
export const refKey = (r: PhotoRef) => `${r.k}:${r.id}`;

export function sourceList(files: string[], album: string[], source: FrameSettings['source']): PhotoRef[] {
  const out: PhotoRef[] = [];
  if (source !== 'google') for (const f of files) out.push({ k: 'f', id: f });
  if (source !== 'folder') for (const g of album) out.push({ k: 'g', id: g });
  return out;
}

/** Trang thai duyet anh cua MOT man hinh: lich su (toi da 60) + vi tri dang xem. */
export interface Nav { hist: PhotoRef[]; idx: number }

/**
 * Anh ke tiep (dir = 1) hoac truoc (dir = -1). Truoc: lui trong lich su. Sau: tien trong lich su neu da lui, khong thi
 * chon moi — 'name' = anh sau anh hien tai theo thu tu danh sach, 'random' = ngau nhien tranh ~10 anh vua xem.
 */
export function step(nav: Nav, list: PhotoRef[], dir: 1 | -1, order: FrameSettings['order'], rand: () => number = Math.random): PhotoRef | null {
  if (!list.length) return null;
  const has = (r: PhotoRef) => list.some((x) => x.k === r.k && x.id === r.id);
  if (dir === -1) {
    while (nav.idx > 0) { nav.idx--; if (has(nav.hist[nav.idx])) return nav.hist[nav.idx]; }
    return nav.hist[nav.idx] && has(nav.hist[nav.idx]) ? nav.hist[nav.idx] : null;
  }
  if (nav.idx < nav.hist.length - 1) { nav.idx++; return nav.hist[nav.idx]; }
  const cur = nav.hist[nav.idx];
  let next: PhotoRef;
  if (order === 'name') {
    const i = cur ? list.findIndex((x) => x.k === cur.k && x.id === cur.id) : -1;
    next = list[(i + 1) % list.length];
  } else {
    const recent = new Set(nav.hist.slice(-Math.min(10, list.length - 1)).map(refKey));
    const pool = list.filter((x) => !recent.has(refKey(x)));
    const from = pool.length ? pool : list;
    next = from[Math.floor(rand() * from.length) % from.length];
  }
  nav.hist.push(next);
  if (nav.hist.length > 60) nav.hist.splice(0, nav.hist.length - 60);
  nav.idx = nav.hist.length - 1;
  return next;
}

/** URL anh (tu Chromium cua addon) cho man hinh w x h. */
export function photoUrl(origin: string, r: PhotoRef, w: number, h: number, fit: FrameSettings['fit']): string {
  const q = `&w=${w}&h=${h}&fit=${fit}`;
  return r.k === 'f' ? `${origin}/photos/img?f=${encodeURIComponent(r.id)}${q}` : `${origin}/photos/gp?u=${encodeURIComponent(r.id)}${q}`;
}

const capCache = new Map<string, string>();
/** Chu thich: "01/05/2024 · Da Lat" (ngay chup EXIF + thu muc) — anh album Google: "Google Photos". */
export async function caption(dir: string, r: PhotoRef): Promise<string> {
  if (r.k === 'g') return 'Google Photos';
  const hit = capCache.get(r.id);
  if (hit != null) return hit;
  let date: string | null = null;
  try { date = exifDate((await sharp(path.join(dir, r.id)).metadata()).exif); } catch { /* bo qua */ }
  const folder = path.dirname(r.id) === '.' ? '' : path.basename(path.dirname(r.id));
  const s = [date, folder].filter(Boolean).join(' · ');
  if (capCache.size > 5000) capCache.clear();
  capCache.set(r.id, s);
  return s;
}

/** Anh album (cache 30 phut); loi mang -> danh sach cu / rong, khong lam hong man hinh cho. */
export async function albumItems(url: string): Promise<string[]> {
  if (!url) return [];
  try { return await fetchAlbum(url); } catch (e) {
    console.warn(`[photos] khong doc duoc album Google Photos: ${(e as Error).message}`);
    return cachedAlbum(url);
  }
}
