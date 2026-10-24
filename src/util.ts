// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

export function hash32(buf: Buffer): number {
  let h = 0x811C9DC5 >>> 0;
  for (let i = 0; i < buf.length; i += 16) {
    h ^= buf[i]; h = (h * 0x01000193) >>> 0;
    h ^= buf[i + 4] ?? 0; h = (h * 0x01000193) >>> 0;
    h ^= buf[i + 8] ?? 0; h = (h * 0x01000193) >>> 0;
    h ^= buf[i + 12] ?? 0; h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type Rotation = 0 | 90 | 180 | 270;

export function getRotatedDimensions(
  width: number,
  height: number,
  rotation: Rotation
): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * (24/10/2026) Server co phai xoay anh truoc khi gui khong?
 *  - 0: khong.
 *  - 180: co (firmware ve nguyen khung, khong tu xoay).
 *  - 90/270: chi khi firmware CHUA bao ?drot=1. Firmware tu xoay tile (PPA o P4) thi server gui nguyen
 *    khung 600x1024 cua Chrome — nho vay duong tat passthrough (chuyen thang JPEG cua Chrome, khong giai
 *    nen/nen lai) moi dung duoc; neu server xoay thi moi khung deu phai giai nen + nen lai toan khung.
 */
export function needsServerRotate(rotation: Rotation, drot: boolean): boolean {
  if (rotation === 180) return true;
  if (rotation === 90 || rotation === 270) return !drot;
  return false;
}

export function mapPointForRotation(
  xd: number, yd: number,
  srcW: number, srcH: number, // розмір сторінки у Chrome (до ротації)
  rotation: Rotation
): { x: number; y: number } {
  switch (rotation) {
    case 0:   return { x: xd,            y: yd };
    case 90:  return { x: yd,            y: srcH - 1 - xd };
    case 180: return { x: srcW - 1 - xd, y: srcH - 1 - yd };
    case 270: return { x: srcW - 1 - yd, y: xd };
  }
}
