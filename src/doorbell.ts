// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) MAN HINH CHUONG CUA — phan THUAN. Home Assistant (automation khi nut chuong duoc bam) goi
// POST /doorbell {camera, title?, unlock?, timeout?, device?}: moi panel sang man hinh, mo camera cong toan man hinh voi
// chuong keu, nut "Mo cong" (chay DUNG thuc the HA da khai trong yeu cau — script/button/lock), "Dong"; het gio thi
// quay ve ung dung dang dung truoc do.
import type { ServiceCall } from './settingsModel.js';

export interface Doorbell { camera: string; title: string; unlock: string | null; timeoutS: number; device: string; mode: 'mse' | 'mjpeg' }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const UNLOCK_RE = /^(script|button|lock)\.[a-z0-9_]{1,64}$/;

export function parseDoorbell(body: any): { ok: true; bell: Doorbell } | { ok: false; error: string } {
  const camera = str(body?.camera, 64);
  if (!camera || !/^[\w.-]+$/.test(camera)) return { ok: false, error: 'can camera (ten luong go2rtc)' };
  const unlock = str(body?.unlock, 80) || null;
  if (unlock && !UNLOCK_RE.test(unlock)) return { ok: false, error: 'unlock phai la script.*, button.* hoac lock.*' };
  const t = Number(body?.timeout);
  // (16/10/2026) mode: cách xem luồng go2rtc của camera cổng. `mjpeg` cho camera ESPHome MJPEG
  // (esp32_camera_web_server) — hiện hình ngay, không bắt go2rtc chạy ffmpeg chuyển sang H.264.
  const rawMode = str(body?.mode, 8).toLowerCase();
  const mode: 'mse' | 'mjpeg' = rawMode === 'mjpeg' ? 'mjpeg' : 'mse';
  if (rawMode && rawMode !== 'mse' && rawMode !== 'mjpeg') return { ok: false, error: 'mode phai la mse hoac mjpeg' };
  return {
    ok: true,
    bell: {
      camera, unlock, title: str(body?.title, 60) || 'Có người bấm chuông',
      timeoutS: Number.isFinite(t) ? Math.min(300, Math.max(10, Math.round(t))) : 60,
      device: str(body?.device, 64) || 'all', mode,
    },
  };
}

/** Loi goi dich vu de mo cong theo loai thuc the. */
export function unlockCall(entity: string): ServiceCall {
  const domain = entity.split('.')[0];
  const service = domain === 'script' ? 'turn_on' : domain === 'button' ? 'press' : 'unlock';
  return { domain, service, data: { entity_id: entity } };
}
