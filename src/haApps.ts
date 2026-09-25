// (25/09/2026) API nho cho cac ung dung cua launcher (chi o HEALTH_PORT, LAN — nhu /metrics, cam.html):
//   GET  /ha/scenes          -> scene.* + script.* trong HA (ten, entity_id)
//   POST /ha/run?entity=...  -> scene.turn_on / script.turn_on. CHI nhan entity dang co trong danh sach tren.
//   GET  /cams/list          -> luong go2rtc (bo *_sub khi co luong chinh; *_sub dung cho anh chup nhe hon)
// Rui ro chap nhan: may trong LAN kich duoc scene/script (khong phai dich vu tuy y) — cung muc phoi bay voi
// go2rtc/ESPHome API tren LAN.
import type http from 'node:http';

const HA = 'http://supervisor/core/api';
const GO2RTC = process.env.GO2RTC_URL || 'http://127.0.0.1:1984';

function haHeaders(): Record<string, string> | null {
  const t = process.env.SUPERVISOR_TOKEN;
  return t ? { Authorization: `Bearer ${t}`, 'content-type': 'application/json' } : null;
}

async function listScenes(): Promise<Array<{ entity_id: string; name: string; domain: string }>> {
  const h = haHeaders();
  if (!h) return [];
  const r = await fetch(`${HA}/states`, { headers: h, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`HA ${r.status}`);
  const all = await r.json() as Array<{ entity_id: string; attributes?: { friendly_name?: string } }>;
  return all
    .filter(s => /^(scene|script)\./.test(s.entity_id))
    .map(s => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, domain: s.entity_id.split('.')[0] }))
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name, 'vi'));
}

async function runScene(entity: string): Promise<boolean> {
  const h = haHeaders();
  if (!h) return false;
  const list = await listScenes();
  const hit = list.find(s => s.entity_id === entity);
  if (!hit) return false;
  const r = await fetch(`${HA}/services/${hit.domain}/turn_on`, {
    method: 'POST', headers: h, body: JSON.stringify({ entity_id: entity }), signal: AbortSignal.timeout(8000),
  });
  return r.ok;
}

async function listCams(): Promise<Array<{ name: string; snap: string; live: string }>> {
  const r = await fetch(`${GO2RTC}/api/streams`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`go2rtc ${r.status}`);
  const names = Object.keys(await r.json() as Record<string, unknown>);
  const set = new Set(names);
  return names
    .filter(n => !(n.endsWith('_sub') && set.has(n.slice(0, -4))))
    .map(n => ({ name: n, snap: set.has(n + '_sub') ? n + '_sub' : n, live: n }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** true = da xu ly request. */
export function handleAppApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (p === '/ha/scenes' && req.method === 'GET') {
    listScenes().then(l => json(res, 200, l)).catch(e => json(res, 502, { error: (e as Error).message }));
    return true;
  }
  if (p === '/ha/run' && req.method === 'POST') {
    const entity = url.searchParams.get('entity') || '';
    runScene(entity).then(ok => json(res, ok ? 200 : 400, { ok })).catch(e => json(res, 502, { error: (e as Error).message }));
    return true;
  }
  if (p === '/cams/list' && req.method === 'GET') {
    listCams().then(l => json(res, 200, l)).catch(e => json(res, 502, { error: (e as Error).message }));
    return true;
  }
  return false;
}
