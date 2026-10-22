// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (25/09/2026) Tinh chinh LUC DANG CHAY, khong can khoi dong lai container.
//
// Ly do: moi lan `docker restart` de thu mot tham so, Supervisor lai TAO LAI container (do that 2 lan) -> ban va nong
// mat giua luot do. File nay nam trong /data (thu muc ben cua addon, con nguyen khi container duoc tao lai); server
// doc lai khi file doi (kiem tra toi da 2 s/lan). Xoa file = ve mac dinh. Chi nhan cac khoa duoi day, gia tri sai
// kieu/ngoai khoang bi bo qua.
//
//   { "adaptive": false,          // tat bo dieu tiet (giu nguyen nhip/quality hien tai, hoac fixedIntervalMs)
//     "fixedIntervalMs": 50,      // chi dung khi adaptive=false: ep nhip cho MOI thiet bi
//     "maxBacklogBytes": 196608,  // nguong ton dong khien bo dieu tiet gian nhip (mac dinh 98304)
//     "decodeBudgetRatio": 0.5,   // ngan sach xu ly = nhip x ti le (mac dinh 0.5)
//     "intervalBackoffFactor": 2, // gian nhip nhan bao nhieu khi qua tai (mac dinh 2)
//     "wsHighWaterBytes": 196608, // ton dong socket tren muc nay thi BO khung (mac dinh 196608)
//     "fullFrameAreaThreshold": 0.5, // ghi de nguong khung day du cua thiet bi (mac dinh: theo thiet bi)
//     "passthroughFit": false,   // tat "nen lai cho vua mot goi" o duong tat video (mac dinh bat — 2.9.71)
//     "videoLowQ": false,       // tat "ha chat luong screencast khi phat video" (mac dinh bat — 2.9.72)
//     "kernelBacklog": false,   // khong cong hang doi gui cua kernel vao "ton dong" (mac dinh bat — 2.9.108)
//     "netHalfHoldMs": 60000,   // giu khung nua bao lau sau lan nghen cuoi (mac dinh 60000)
//     "halfGraceMs": 8000 }     // vua bat khung nua vi nghen: bao lau khong gian nhip vi ton dong (mac dinh 8000; 0 = tat)
import fs from 'node:fs';

export type Tuning = {
  adaptive?: boolean;
  fixedIntervalMs?: number;
  maxBacklogBytes?: number;
  decodeBudgetRatio?: number;
  intervalBackoffFactor?: number;
  wsHighWaterBytes?: number;
  /** (14/10/2026) Nguong tranh nghen do MANG het han sau chung nay ms (0 / thieu = tat). Xem adaptive.ts. */
  probeFloorTtlMs?: number;
  fullFrameAreaThreshold?: number;
  passthroughFit?: boolean;
  videoLowQ?: boolean;
  kernelBacklog?: boolean;
  /** (07/10/2026) false = tab IPTV KHONG dung chinh sach khung nua do phan giai cua YouTube TV (gui khung day du tru khi
   *  duong truyen nghen). Mac dinh (khong dat) = co, nhu YouTube TV. */
  iptvHalf?: boolean;
  /** (22/10/2026) Tran chat luong JPEG khi PHAT VIDEO tren thiet bi half=2 (Sunton 800x480: giai ma cham).
   *  Do that: q40 van du net cho video, byte/khung giam ~35%. Mac dinh 40. */
  videoQCap?: number;
  /** (15/10/2026) Giu khung nua do phan giai bao lau sau lan nghen cuoi (mac dinh NET_HALF_HOLD_MS = 60 s). */
  netHalfHoldMs?: number;
  /** (15/10/2026) Bao lau sau khi VUA bat khung nua vi nghen, bo dieu tiet KHONG gian nhip vi ton dong (khung nua da giam
   *  4x byte, tu xa duoc; gian nhip thi ~50 s moi hoi). Mac dinh HALF_GRACE_MS = 8 s; 0 = tat. */
  halfGraceMs?: number;
};

const FILE = process.env.TUNING_FILE || '/data/rwv-tuning.json';
let cache: Tuning = {};
let mtime = 0;
let lastCheck = 0;

function num(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

export function sanitizeTuning(j: unknown): Tuning {
  const o = (j && typeof j === 'object') ? j as Record<string, unknown> : {};
  const t: Tuning = {};
  if (typeof o.adaptive === 'boolean') t.adaptive = o.adaptive;
  if (typeof o.passthroughFit === 'boolean') t.passthroughFit = o.passthroughFit;
  if (typeof o.videoLowQ === 'boolean') t.videoLowQ = o.videoLowQ;
  if (typeof o.kernelBacklog === 'boolean') t.kernelBacklog = o.kernelBacklog;
  if (typeof o.iptvHalf === 'boolean') t.iptvHalf = o.iptvHalf;
  const f = num(o.fixedIntervalMs, 10, 2000); if (f !== undefined) t.fixedIntervalMs = Math.round(f);
  const b = num(o.maxBacklogBytes, 8192, 4_194_304); if (b !== undefined) t.maxBacklogBytes = Math.round(b);
  const r = num(o.decodeBudgetRatio, 0.1, 1.5); if (r !== undefined) t.decodeBudgetRatio = r;
  const k = num(o.intervalBackoffFactor, 1.05, 4); if (k !== undefined) t.intervalBackoffFactor = k;
  const w = num(o.wsHighWaterBytes, 16384, 8_388_608); if (w !== undefined) t.wsHighWaterBytes = Math.round(w);
  const pf = num(o.probeFloorTtlMs, 0, 600_000); if (pf !== undefined) t.probeFloorTtlMs = Math.round(pf);
  const nh = num(o.netHalfHoldMs, 0, 600_000); if (nh !== undefined) t.netHalfHoldMs = Math.round(nh);
  const hg = num(o.halfGraceMs, 0, 60_000); if (hg !== undefined) t.halfGraceMs = Math.round(hg);
  const vq = num(o.videoQCap, 20, 90); if (vq !== undefined) t.videoQCap = Math.round(vq);
  const a = num(o.fullFrameAreaThreshold, 0.05, 1); if (a !== undefined) t.fullFrameAreaThreshold = a;
  return t;
}

export function tuning(): Tuning {
  const now = Date.now();
  if (now - lastCheck < 2000) return cache;
  lastCheck = now;
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs !== mtime) {
      mtime = st.mtimeMs;
      cache = sanitizeTuning(JSON.parse(fs.readFileSync(FILE, 'utf8')));
      console.log(`[tuning] doc ${FILE}: ${JSON.stringify(cache)}`);
    }
  } catch {
    if (mtime !== 0) { mtime = 0; cache = {}; console.log(`[tuning] khong con ${FILE} -> mac dinh`); }
  }
  return cache;
}
