// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (08/10/2026) SU KIEN CAMERA (Frigate) cho ung dung public/events.html.
// Tim API Frigate KHONG can quyen Supervisor (addon goi /addons -> 403): muc cau hinh cua tich hop Frigate trong HA co
// tieu de "ten-may:cong" (vd: frigate:5000) -> phan giai ten qua DNS noi bo cua add-on (172.30.32.3 —
// addon chay host_network van toi duoc) -> http://<ip>:<cong> (cong 5000 khong xac thuc, chi trong mang add-on).
// FRIGATE_URL (bien moi truong) de ghi de. Anh / clip CHI phuc vu trang cung may (127.0.0.1): hinh camera trong nha.
import http from 'node:http';
import dns from 'node:dns';
import { haFetch } from './haSettings.js';

const DNS_HASSIO = process.env.HASSIO_DNS || '172.30.32.3';
const BASE_TTL_MS = 10 * 60_000;
let base: { url: string; at: number } | null = null;
let cfgCache: { at: number; cfg: FrigateConfig } | null = null;

/** "frigate:5000" / "http://frigate:5000/" -> { host, port }. */
export function parseFrigateTitle(title: string): { host: string; port: number } | null {
  const m = /^(?:https?:\/\/)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?$/.exec(String(title || '').trim());
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 5000;
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

async function discover(): Promise<string> {
  if (process.env.FRIGATE_URL) return process.env.FRIGATE_URL.replace(/\/+$/, '');
  const r = await haFetch('/config/config_entries/entry');
  if (!r.ok) throw new Error(`Home Assistant trả lỗi ${r.status}`);
  const entries = await r.json() as { domain: string; title: string; state: string }[];
  const e = entries.find((x) => x.domain === 'frigate' && x.state === 'loaded') ?? entries.find((x) => x.domain === 'frigate');
  if (!e) throw new Error('Chưa cài tích hợp Frigate trong Home Assistant.');
  const hp = parseFrigateTitle(e.title);
  if (!hp) throw new Error(`Không đọc được địa chỉ Frigate (${e.title}).`);
  let ip = hp.host;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    try { const res = new dns.promises.Resolver(); res.setServers([DNS_HASSIO]); ip = (await res.resolve4(hp.host))[0]; }
    catch { ip = (await dns.promises.lookup(hp.host)).address; }
  }
  return `http://${ip}:${hp.port}`;
}

/** (09/10/2026) Tich hop Frigate co hay khong (null = chua biet) — an ung dung Frigate / Su kien khi nha khong co Frigate. */
let known: boolean | null = null;
export function frigateKnown(): boolean | null { return known; }
/** IP noi bo cua Frigate (go2rtc cua Frigate nghe cong 1984 cung IP) — src/go2rtcProxy.ts. */
export async function frigateHostIp(): Promise<string | null> {
  try { return new URL(await frigateBase()).hostname; } catch { return null; }
}
/** Luong go2rtc dang chay cua Frigate (ten -> nguon). */
export async function go2rtcStreams(): Promise<Record<string, unknown>> {
  return await getJson('/api/go2rtc/streams') as Record<string, unknown>;
}

async function frigateBase(): Promise<string> {
  if (base && Date.now() - base.at < BASE_TTL_MS) return base.url;
  let url: string;
  try { url = await discover(); known = true; } catch (e) { if (/Chưa cài tích hợp Frigate/.test((e as Error).message)) known = false; throw e; }
  if (base?.url !== url) console.log(`[frigate] API: ${url}`);
  base = { url, at: Date.now() };
  return url;
}

async function getJson(path: string): Promise<unknown> {
  const b = await frigateBase();
  try {
    const r = await fetch(b + path, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Frigate trả lỗi ${r.status}`);
    return await r.json();
  } catch (e) { base = null; throw e; }  // dia chi co the da doi (add-on khoi dong lai) -> tim lai lan sau
}

export interface FEvent {
  id: string; camera: string; label: string; sub?: string; score: number; start: number; end: number | null;
  clip: boolean; snap: boolean; zones: string[];
}
/** Su kien Frigate (0.14–0.18) -> ban gon cho trang. */
export function toEvent(e: Record<string, unknown>): FEvent | null {
  const id = String(e.id ?? '');
  if (!/^[0-9]+\.[0-9]+-[A-Za-z0-9]+$/.test(id)) return null;
  const data = (e.data ?? {}) as Record<string, unknown>;
  const sub = Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label;
  const score = Number(e.top_score ?? data.top_score ?? data.score ?? 0);
  return {
    id, camera: String(e.camera ?? ''), label: String(e.label ?? ''), ...(sub ? { sub: String(sub) } : {}),
    score: Number.isFinite(score) ? Math.round(score * 100) / 100 : 0,
    start: Number(e.start_time) || 0, end: e.end_time == null ? null : Number(e.end_time) || null,
    clip: !!e.has_clip, snap: !!e.has_snapshot, zones: Array.isArray(e.zones) ? e.zones.map(String) : [],
  };
}

interface FrigateConfig {
  cameras?: Record<string, { enabled?: boolean; ffmpeg?: { inputs?: { path?: string }[] } }>;
  go2rtc?: { streams?: Record<string, string | string[]> };
}
async function frigateConfig(): Promise<FrigateConfig> {
  if (cfgCache && Date.now() - cfgCache.at < BASE_TTL_MS) return cfgCache.cfg;
  const cfg = await getJson('/api/config') as FrigateConfig;
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}
async function cameras(): Promise<string[]> {
  const cfg = await frigateConfig();
  return Object.entries(cfg.cameras ?? {}).filter(([, c]) => c?.enabled !== false).map(([n]) => n);
}

/**
 * (08/10/2026) Camera -> may chu NGUON (luong go2rtc cung ten + dau vao ffmpeg; bo 127.0.0.1 / localhost — go2rtc phat
 * lai). Dung de nhan ra camera cua CHINH panel (do that: p4_panel <- go2rtc http://192.168.1.179:...): widget man khoa
 * khong bao "co nguoi" moi lan chinh nguoi dang dung truoc panel. Chi doc ten may, khong giu mat khau trong URL.
 */
function hostOf(u: unknown): string | null {
  try {
    const h = new URL(String(u).replace(/^ffmpeg:/, '').replace(/#.*$/, '')).hostname;
    return h && !/^(127\.|localhost$|::1$|\[::1\]$)/.test(h) ? h : null;
  } catch { return null; }
}
export function hostsOfConfig(cfg: FrigateConfig): Record<string, string[]> {
  const host = hostOf;
  const out: Record<string, string[]> = {};
  for (const [name, c] of Object.entries(cfg.cameras ?? {})) {
    const srcs: unknown[] = [...(c?.ffmpeg?.inputs ?? []).map((i) => i?.path), ...([] as unknown[]).concat(cfg.go2rtc?.streams?.[name] ?? [])];
    out[name] = [...new Set(srcs.map(host).filter((h): h is string => !!h))];
  }
  return out;
}
/**
 * (08/10/2026) Nguon DANG CHAY that cua go2rtc (Frigate /api/go2rtc/streams): cau hinh Frigate chi nap luc khoi dong — do
 * that: doi IP P4 (.179 -> .24, DHCP) va cap nhat luong go2rtc qua API, /api/config van bao .179 toi khi Frigate khoi
 * dong lai -> P4 khong nhan ra camera cua chinh no.
 */
export function hostsOfRuntime(streams: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, s] of Object.entries((streams && typeof streams === 'object' ? streams : {}) as Record<string, unknown>)) {
    const prods = ((s as { producers?: { url?: unknown }[] })?.producers ?? []);
    // (09/10/2026) Nguon qua server Dashboard (/cam/live/<id thiet bi>) -> them dau "cam-live:<id>" (nhan camera cua chinh panel).
    const live = prods.map((p) => /\/cam\/live\/([A-Za-z0-9_-]+)/.exec(String(p?.url ?? ''))?.[1]).filter((x): x is string => !!x).map((x) => 'cam-live:' + x);
    out[name] = [...new Set([...prods.map((p) => hostOf(p?.url)).filter((h): h is string => !!h), ...live])];
  }
  return out;
}
export async function cameraHosts(): Promise<Record<string, string[]>> {
  const out = hostsOfConfig(await frigateConfig());
  try {
    for (const [cam, hs] of Object.entries(hostsOfRuntime(await getJson('/api/go2rtc/streams')))) {
      out[cam] = [...new Set([...(out[cam] ?? []), ...hs])];
    }
  } catch { /* Frigate cu khong co API go2rtc: chi dung cau hinh */ }
  return out;
}

/** (08/10/2026) Su kien bat dau sau `afterSec` (giay epoch), moi nhat truoc — widget man khoa. */
export async function recentEvents(afterSec: number, limit = 20): Promise<FEvent[]> {
  const ps = new URLSearchParams({ include_thumbnails: '0', limit: String(limit), after: String(Math.floor(afterSec)) });
  const ev = await getJson('/api/events?' + ps.toString());
  return (Array.isArray(ev) ? ev : []).map((e) => toEvent(e as Record<string, unknown>)).filter((e): e is FEvent => !!e);
}

const ID_RE = /^[0-9]+\.[0-9]+-[A-Za-z0-9]+$/;
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Chuyen tiep anh / clip (giu Range de tua video). Moi buoc ghi boc try — server khong co bo bat loi toan cuc. */
function pipeMedia(req: http.IncomingMessage, res: http.ServerResponse, path: string, cacheable: boolean): void {
  frigateBase().then((b) => {
    const up = http.request(new URL(b + path), { method: 'GET', timeout: 20_000,
      headers: req.headers.range ? { range: String(req.headers.range) } : {} }, (r) => {
      const h: http.OutgoingHttpHeaders = { 'cache-control': cacheable ? 'private, max-age=86400' : 'no-store' };
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers[k]) h[k] = r.headers[k];
      try { res.writeHead(r.statusCode || 502, h); } catch { r.destroy(); res.destroy(); return; }
      r.on('error', () => res.destroy());
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('Frigate không trả lời')));
    up.on('error', () => {
      base = null;
      if (res.headersSent) { res.destroy(); return; }
      try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Frigate không trả lời'); } catch { res.destroy(); }
    });
    res.on('close', () => up.destroy());
    up.end();
  }).catch((e: Error) => {
    try { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end(e.message); } catch { res.destroy(); }
  });
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** true = da xu ly. Chi trang chay tren chinh may chu (127.0.0.1). */
export function handleFrigateApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/frigate/')) return false;
  if (!/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '')) { json(res, 403, { error: 'Chỉ dùng được từ màn hình.' }); return true; }
  if (p === '/frigate/events') {
    const q = url.searchParams, ps = new URLSearchParams({ include_thumbnails: '0' });
    ps.set('limit', String(Math.min(100, Math.max(1, Number(q.get('limit')) || 60))));
    const cam = q.get('camera'), lab = q.get('label'), before = Number(q.get('before'));
    if (cam && NAME_RE.test(cam)) ps.set('cameras', cam);
    if (lab && NAME_RE.test(lab)) ps.set('labels', lab);
    if (before > 0) ps.set('before', String(before));
    Promise.all([getJson('/api/events?' + ps.toString()), cameras().catch(() => [] as string[])])
      .then(([ev, cams]) => json(res, 200, {
        ok: true, cameras: cams,
        events: (Array.isArray(ev) ? ev : []).map((e) => toEvent(e as Record<string, unknown>)).filter((e): e is FEvent => !!e),
      }))
      .catch((e: Error) => json(res, 200, { ok: false, error: e.message }));
    return true;
  }
  const m = /^\/frigate\/(thumb|snap|clip)\/([^/]+)$/.exec(p);
  if (!m || !ID_RE.test(m[2])) { json(res, 404, { error: 'khong co' }); return true; }
  const id = encodeURIComponent(m[2]);
  if (m[1] === 'thumb') pipeMedia(req, res, `/api/events/${id}/thumbnail.jpg`, true);
  else if (m[1] === 'snap') pipeMedia(req, res, `/api/events/${id}/snapshot.jpg?bbox=1`, true);
  else pipeMedia(req, res, `/api/events/${id}/clip.mp4`, false);
  return true;
}
