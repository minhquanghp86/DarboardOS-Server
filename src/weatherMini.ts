// (25/09/2026) Thoi tiet THU GON cho dau menu ung dung (bieu tuong + nhiet do + kha nang mua) tai vi tri nha trong HA.
// Server lay 15 phut/lan tu Open-Meteo roi day kem trang thai thiet bi — menu khong phai tu tai gi khi mo.
import { getHaLocation } from './haLocation.js';

export interface WeatherMini { t: number; code: number; day: boolean; pp: number | null; name: string; at: number; }

const REFRESH_MS = 15 * 60 * 1000;
let current: WeatherMini | null = null;
const listeners: Array<() => void> = [];

export function getWeatherMini(): WeatherMini | null { return current; }
export function onWeatherMiniUpdate(fn: () => void): void { listeners.push(fn); }

async function refresh(): Promise<void> {
  const loc = await getHaLocation();
  if (!loc) return;
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
    for (const fn of listeners) { try { fn(); } catch { } }
  } catch (e) {
    console.warn(`[weather] thoi tiet thu gon loi: ${(e as Error).message}`);
  }
}

let started = false;
export function startWeatherMini(): void {
  if (started) return;
  started = true;
  refresh();
  setInterval(refresh, REFRESH_MS);
}
