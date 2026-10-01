// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-5) MAN HINH CHO: sau mot luc khong cham, Shell phu len dong ho lon + ngay am duong + thoi tiet (xem
// src/shell/main.ts screensaver). Thay cho "man hinh dung im mot trang dashboard" khi den nen van sang (vd bat "Luon
// sang"), dong thoi chong luu anh (noi dung doi cho moi phut). Quyet dinh o SERVER vi server biet: lan cham cuoi, tab
// dang hien co dang phat video/camera khong, den nen dang bat hay tat.

/** Giay khong cham truoc khi hien man hinh cho; 0 = tat. Addon: tuy chon screensaver_idle_s. */
export const SCREENSAVER_IDLE_S = Math.max(0, parseInt(process.env.SCREENSAVER_IDLE_S ?? '120', 10) || 0);

export interface SaverInput {
  now: number;
  lastTouchMs: number;
  idleMs: number;
  /** Tab dang hien dang phat <video>/<audio> (YouTube, camera, radio dang mo...). */
  mediaPlaying: boolean;
  /** (01/10/2026) Luc tab dang hien ngung phat gan nhat (ms); undefined = chua tung phat. */
  mediaStoppedMs?: number;
  /** Den nen dang sang (thiet bi bao qua DeviceState); chua biet -> coi nhu sang. */
  backlightOn: boolean | null;
  shown: boolean;
}

/** true = can HIEN man hinh cho ngay bay gio (chua hien, du dieu kien). */
export function shouldShowSaver(s: SaverInput): boolean {
  if (s.shown || s.idleMs <= 0) return false;
  if (s.mediaPlaying) return false;              // dang xem video / camera: khong che
  if (s.backlightOn === false) return false;     // man hinh da tat: ve cung khong ai thay, ton bang thong
  // (01/10/2026) Nhu dien thoai: NGUNG PHAT cung tinh la "vua dung" — dem thoi gian ranh tu lan cham cuoi HOAC luc video
  // ngung, lay cai muon hon. Truoc day YouTube bao "tam dung" thoang qua (nap dem) khi da qua 2 phut khong cham -> man
  // hinh cho hien de len video dang phat roi tat sau 3-6 s, lap lai (log that P4 01/10).
  const since = Math.max(s.lastTouchMs, s.mediaStoppedMs ?? 0);
  return s.now - since >= s.idleMs;
}

// ── (27/09/2026) Man hinh cho dang KHUNG ANH + theo gio trong ngay ─────────────────────────────────────────────────
/** Addon: screensaver_photos (mac dinh bat). Co anh trong thu muc anh thi man hinh cho hien anh, doi moi phut. */
export const SCREENSAVER_PHOTOS = !['0', 'false'].includes(process.env.SCREENSAVER_PHOTOS ?? '');
export const SAVER_PHOTO_MS = 60_000;

/** Gio (0..23) tai noi dat thiet bi: gio UTC + mui gio thiet bi bao (phut). */
export function deviceHour(nowMs: number, tzOffsetMin: number): number {
  return new Date(nowMs + tzOffsetMin * 60_000).getUTCHours();
}
/** Ban dem (22h-6h): man hinh cho chi dong ho tong am toi, khong anh (it anh sang trong phong ngu). */
export const isNightHour = (h: number) => h >= 22 || h < 6;

/** Anh ke tiep cho man hinh cho: ngau nhien, khong lap lai anh vua hien. */
export function nextSaverPhoto(files: string[], prev: string | null, rand: () => number = Math.random): string | null {
  if (!files.length) return null;
  if (files.length === 1) return files[0];
  for (let i = 0; i < 4; i++) {
    const f = files[Math.floor(rand() * files.length)];
    if (f !== prev) return f;
  }
  return files.find((f) => f !== prev) ?? files[0];
}
