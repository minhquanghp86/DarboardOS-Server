// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (25/09/2026) Vi tri NHA tu Home Assistant cho ung dung "Thoi tiet" (du lieu thoi tiet van lay tu web — Open-Meteo).
// Can quyen addon `homeassistant_api: true`: Supervisor cap SUPERVISOR_TOKEN, goi http://supervisor/core/api/config
// (khong can mat khau/token cua nguoi dung). Chi tra ve qua HEALTH_PORT (LAN), khong qua ingress/Cloudflare.

export interface HaLocation { name: string; lat: number; lon: number; }

const CACHE_MS = 60 * 60 * 1000;
let cached: { at: number; loc: HaLocation | null } | null = null;

export async function getHaLocation(): Promise<HaLocation | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.loc;
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return null;  // chay ngoai HA (docker-compose) -> khong co
  let loc: HaLocation | null = null;
  try {
    const r = await fetch('http://supervisor/core/api/config', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = await r.json() as { latitude?: number; longitude?: number; location_name?: string };
      if (Number.isFinite(j.latitude) && Number.isFinite(j.longitude)) {
        loc = { name: j.location_name || 'Nhà', lat: j.latitude as number, lon: j.longitude as number };
      }
    } else {
      console.warn(`[weather] HA /api/config tra ${r.status} (addon can homeassistant_api: true)`);
    }
  } catch (e) {
    console.warn(`[weather] khong doc duoc vi tri HA: ${(e as Error).message}`);
  }
  cached = { at: Date.now(), loc };
  return loc;
}

/** (09/10/2026) Vi tri da doc gan nhat (khong cho) — Google Maps / quyen vi tri cua Chrome. null = chua doc / khong co. */
export function haLocationCached(): HaLocation | null { return cached?.loc ?? null; }
