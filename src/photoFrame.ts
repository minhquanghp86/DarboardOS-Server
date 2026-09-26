// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) KHUNG ANH KY THUAT SO (man hinh cho + ung dung Khung anh) — phan xu ly anh va nguon anh:
//  - renderPhoto(): thu nho dung kich thuoc man hinh o SERVER. "Lap day" = cat vua khung; "Vua khung" = giu tron anh,
//    nen la chinh anh do phong to + lam mo + toi (nhu khung anh so / Google Nest Hub) — mot JPEG, panel khong ton gi.
//  - Ngay chup (EXIF DateTimeOriginal) de ghi duoi anh.
//  - Album Google Photos CHIA SE (link photos.app.goo.gl/...): doc trang album, lay danh sach anh lh3.googleusercontent
//    (khong can API / dang nhap — Google Photos Library API da khong cho doc thu vien tu 03/2025). Cach nay khong chinh
//    thuc: Google doi trang thi co the hong; ai co link album deu xem duoc album (dac diem cua album chia se).
import sharp from 'sharp';

export type FitMode = 'cover' | 'frame';

export async function renderPhoto(input: Buffer | string, w: number, h: number, mode: FitMode): Promise<Buffer> {
  const base = sharp(input, { failOn: 'none' }).rotate();
  if (mode === 'cover') return base.resize(w, h, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const src = await base.toBuffer();
  const bg = await sharp(src).resize(Math.max(8, Math.round(w / 8)), Math.max(8, Math.round(h / 8)), { fit: 'cover' })
    .blur(3).modulate({ brightness: 0.55 }).resize(w, h).toBuffer();
  const fg = await sharp(src).resize(w, h, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
  return sharp(bg).composite([{ input: fg.data, left: Math.round((w - fg.info.width) / 2), top: Math.round((h - fg.info.height) / 2) }])
    .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

/** Ngay chup tu EXIF ("2024:05:01 10:20:30") -> "01/05/2024"; khong co -> null. */
export function exifDate(exif: Buffer | undefined): string | null {
  if (!exif) return null;
  const all = [...exif.toString('latin1').matchAll(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/g)];
  // DateTimeOriginal thuong xuat hien SAU DateTime (ngay sua) -> lay moc som nhat hop le
  const ok = all.map((m) => [m[1], m[2], m[3]]).filter(([y, mo, d]) => +y > 1990 && +y < 2100 && +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31);
  if (!ok.length) return null;
  ok.sort((a, b) => a.join('').localeCompare(b.join('')));
  const [y, mo, d] = ok[0];
  return `${d}/${mo}/${y}`;
}

// ── Google Photos (album chia se) ───────────────────────────────────────────────────────────────────────────────
const ALBUM_URL_RE = /^https:\/\/(photos\.app\.goo\.gl\/[A-Za-z0-9]+|photos\.google\.com\/share\/[A-Za-z0-9_-]+(\?key=[A-Za-z0-9_-]+)?)\/?$/;
export const isAlbumUrl = (u: string) => ALBUM_URL_RE.test(u.trim());

/** Anh trong trang album: URL goc lh3.googleusercontent.com/pw/<id> (bo anh dai dien chu album /a/...). */
export function parseAlbumHtml(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]{30,}/g)) out.add(m[0]);
  return [...out];
}

/** URL tai anh vua khung (Google tu thu nho theo tham so =w..-h..). */
export const albumImageUrl = (base: string, w: number, h: number) => `${base}=w${w}-h${h}`;

let albumCache: { url: string; at: number; items: string[] } | null = null;
export async function fetchAlbum(url: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  if (!isAlbumUrl(url)) return [];
  if (albumCache && albumCache.url === url && Date.now() - albumCache.at < 30 * 60_000) return albumCache.items;
  const r = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'accept-language': 'vi,en' } });
  if (!r.ok) throw new Error(`Google Photos ${r.status}`);
  const items = parseAlbumHtml(await r.text()).slice(0, 2000);
  albumCache = { url, at: Date.now(), items };
  return items;
}
export function cachedAlbum(url: string): string[] { return albumCache && albumCache.url === url ? albumCache.items : []; }
export function _resetAlbumCache(): void { albumCache = null; }
