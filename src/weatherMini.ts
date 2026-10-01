// (25/09/2026) Thoi tiet THU GON cho dau menu ung dung (bieu tuong + nhiet do + kha nang mua) tai vi tri nha trong HA.
// Server lay 15 phut/lan tu Open-Meteo roi day kem trang thai thiet bi — menu khong phai tu tai gi khi mo.
// (01/10/2026) Open-Meteo tra 503 dung luc addon khoi dong lai -> khung thoi tiet o Home bien mat 15 phut. Nay: loi thi thu
// lai sau 1 phut; luu ket qua cuoi vao /data va nap lai khi khoi dong (con moi < 3 gio) de Home khong trong.
import fs from 'node:fs';
import path from 'node:path';
import { getHaLocation } from './haLocation.js';

export interface WeatherMini { t: number; code: number; day: boolean; pp: number | null; name: string; at: number; }

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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto` +
      `&current=temperature_2m,weather_code,is_day&daily=precipitation_probability_max&forecast_days=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as any;
    current = {
      t: Math.round(j.current.temperature_2m), code: j.current.weather_code, day: j.current.is_day === 1,
      pp: j.daily?.precipitation_probability_max?.[0] ?? null, name: loc.name, at: Date.now(),
    };
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
