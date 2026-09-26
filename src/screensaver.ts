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
  /** Den nen dang sang (thiet bi bao qua DeviceState); chua biet -> coi nhu sang. */
  backlightOn: boolean | null;
  shown: boolean;
}

/** true = can HIEN man hinh cho ngay bay gio (chua hien, du dieu kien). */
export function shouldShowSaver(s: SaverInput): boolean {
  if (s.shown || s.idleMs <= 0) return false;
  if (s.mediaPlaying) return false;              // dang xem video / camera: khong che
  if (s.backlightOn === false) return false;     // man hinh da tat: ve cung khong ai thay, ton bang thong
  return s.now - s.lastTouchMs >= s.idleMs;
}
