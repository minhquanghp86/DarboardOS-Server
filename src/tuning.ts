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
//     "fullFrameAreaThreshold": 0.5 } // ghi de nguong khung day du cua thiet bi (mac dinh: theo thiet bi)
import fs from 'node:fs';

export type Tuning = {
  adaptive?: boolean;
  fixedIntervalMs?: number;
  maxBacklogBytes?: number;
  decodeBudgetRatio?: number;
  intervalBackoffFactor?: number;
  wsHighWaterBytes?: number;
  fullFrameAreaThreshold?: number;
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
  const f = num(o.fixedIntervalMs, 10, 2000); if (f !== undefined) t.fixedIntervalMs = Math.round(f);
  const b = num(o.maxBacklogBytes, 8192, 4_194_304); if (b !== undefined) t.maxBacklogBytes = Math.round(b);
  const r = num(o.decodeBudgetRatio, 0.1, 1.5); if (r !== undefined) t.decodeBudgetRatio = r;
  const k = num(o.intervalBackoffFactor, 1.05, 4); if (k !== undefined) t.intervalBackoffFactor = k;
  const w = num(o.wsHighWaterBytes, 16384, 8_388_608); if (w !== undefined) t.wsHighWaterBytes = Math.round(w);
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
