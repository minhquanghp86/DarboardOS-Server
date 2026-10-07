// (25/09/2026) Thoi tiet THU GON cho dau menu ung dung (bieu tuong + nhiet do + kha nang mua) tai vi tri nha trong HA.
// Server lay 15 phut/lan tu Open-Meteo roi day kem trang thai thiet bi — menu khong phai tu tai gi khi mo.
// (01/10/2026) Open-Meteo tra 503 dung luc addon khoi dong lai -> khung thoi tiet o Home bien mat 15 phut. Nay: loi thi thu
// lai sau 1 phut; luu ket qua cuoi vao /data va nap lai khi khoi dong (con moi < 3 gio) de Home khong trong.
import fs from 'node:fs';
import path from 'node:path';
import { getHaLocation } from './haLocation.js';

export interface WeatherHour { h: number; t: number; c: number; p: number | null; }
/** (07/10/2026) Them truong CHI TIET cho man hinh khoa (deu co the null — Open-Meteo thieu / API khong khi loi):
 *  fl cam giac, rh do am %, ws gio km/h, hi/lo cao/thap trong ngay, aqi (US AQI) + pm (PM2.5), hr = 6 gio toi. */
export interface WeatherMini {
  t: number; code: number; day: boolean; pp: number | null; name: string; at: number;
  fl?: number | null; rh?: number | null; ws?: number | null; hi?: number | null; lo?: number | null;
  aqi?: number | null; pm?: number | null; hr?: WeatherHour[];
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);

/** Ket qua Open-Meteo forecast (+ air-quality neu co) -> WeatherMini. Ham thuan (xem weatherMini.test.ts). */
export function parseWeatherMini(j: any, aq: any, name: string, now = Date.now()): WeatherMini {
  const c = j?.current ?? {};
  const hr: WeatherHour[] = [];
  const ht: unknown[] = j?.hourly?.time ?? [];
  const curH = typeof c.time === 'string' ? c.time.slice(0, 13) : '';
  for (let i = 0; i < ht.length && hr.length < 6; i++) {
    const tm = String(ht[i]);
    if (curH && tm.slice(0, 13) <= curH) continue;  // bo gio hien tai (da la "bay gio")
    const t = num(j.hourly.temperature_2m?.[i]);
    if (t === null) continue;
    hr.push({ h: parseInt(tm.slice(11, 13), 10), t, c: j.hourly.weather_code?.[i] ?? 0, p: num(j.hourly.precipitation_probability?.[i]) });
  }
  return {
    t: Math.round(c.temperature_2m), code: c.weather_code, day: c.is_day === 1,
    pp: j?.daily?.precipitation_probability_max?.[0] ?? null, name, at: now,
    fl: num(c.apparent_temperature), rh: num(c.relative_humidity_2m), ws: num(c.wind_speed_10m),
    hi: num(j?.daily?.temperature_2m_max?.[0]), lo: num(j?.daily?.temperature_2m_min?.[0]),
    aqi: num(aq?.current?.us_aqi), pm: num(aq?.current?.pm2_5), hr,
  };
}

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(DATA_DIR, 'rwv-weather-mini.json');
let current: WeatherMini | null = null;
const listeners: Array<() => void> = [];

export function getWeatherMini(): WeatherMini | null { return current; }
export function onWeatherMiniUpdate(fn: () => void): void { listeners.push(fn); }

function loadCache(): void {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as WeatherMini;
    if (Number.isFinite(c?.t) && Date.now() - c.at < CACHE_MAX_AGE_MS) current = c;
  } catch { /* chua co */ }
}

/** true = da co so lieu moi. */
async function refresh(): Promise<boolean> {
  const loc = await getHaLocation();
  if (!loc) return false;
  try {
    const base = `latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto`;
    const url = `https://api.open-meteo.com/v1/forecast?${base}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
      `&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&forecast_days=1` +
      `&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=8`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as any;
    // Khong khi: API rieng, loi thi bo qua (van co thoi tiet).
    const aq = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${base}&current=us_aqi,pm2_5`,
      { signal: AbortSignal.timeout(8000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    current = parseWeatherMini(j, aq, loc.name);
    fs.promises.writeFile(CACHE_FILE, JSON.stringify(current)).catch(() => { });
    for (const fn of listeners) { try { fn(); } catch { } }
    return true;
  } catch (e) {
    console.warn(`[weather] thoi tiet thu gon loi: ${(e as Error).message}`);
    return false;
  }
}

function loop(): void {
  refresh().catch(() => false).then((ok) => { setTimeout(loop, ok ? REFRESH_MS : RETRY_MS); });
}

let started = false;
export function startWeatherMini(): void {
  if (started) return;
  started = true;
  loadCache();
  loop();
}
