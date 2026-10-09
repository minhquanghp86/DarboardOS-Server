// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (08/10/2026) WIDGET TREN MAN HINH KHOA / CHO: nang luong (mat troi, pin, tieu thu, luoi), lich 3 ngay toi, camera vua
// phat hien (Frigate). Server chi gom SO LIEU THO; Shell (src/shell/main.ts) tu viet chu theo gio thiet bi ("Ngày mai",
// "5 phút trước") va chi ve lai so lieu luc doi phut (moi khung doi la mot khung gui qua WiFi).
// Cam bien nang luong: trang Darboard (ingress) -> tab "Màn khóa" luu /data/rwv-lock-widgets.json; chua luu -> lay theo
// trang Nang luong cua HA (HA >= 2025.12 co stat_rate = cam bien CONG SUAT; do that 08/10: cau hinh Nang luong cua nguoi
// dung tro toi cam bien khong con ton tai -> phai chon tay).
// Chi hoi HA / Frigate thuong xuyen khi co man hinh dang hien lop khoa / cho (deviceManager.screensaverTick); con lai 5 phut/lan
// de luc khoa la co san so lieu.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { haFetch, wsCalls } from './haSettings.js';
import { cameraHosts, recentEvents } from './frigate.js';

/** Cam bien nang luong (entity_id). bat: + = DANG XA (quy uoc HA); batInvert: cam bien nguoc dau (+ = dang sac).
 *  grid: + = MUA dien (quy uoc HA); gridInvert: nguoc dau. pvToday: san luong mat troi HOM NAY (kWh, tu ve 0 luc nua dem). */
export interface EnergyCfg {
  pv?: string; pvToday?: string; soc?: string; bat?: string; batInvert?: boolean; load?: string; grid?: string; gridInvert?: boolean;
}
/** So lieu gui Shell: W, kWh, %. bat + = dang xa; grid + = dang mua. Thieu / unavailable -> bo truong. */
export interface LwEnergy { pv?: number; pvd?: number; soc?: number; bat?: number; load?: number; grid?: number }
/** Su kien lich: t = tieu de; s/e = bat dau / ket thuc (ms epoch); ad = ca ngay (s/e = nua dem gio dia phuong). */
export interface LwEvent { t: string; s: number; e: number; ad?: 1 }
/** Lan phat hien camera gan nhat: c = camera, l = nhan Frigate (person/car...), sub = ten (nhan dien mat), live = dang dien ra. */
export interface LwCam { id: string; c: string; l: string; sub?: string; s: number; live?: 1 }
export interface LwData { en?: LwEnergy; ev?: LwEvent[]; cam?: LwCam }
export interface LwWant { en: boolean; cal: boolean; cam: boolean }

const ENTITY_RE = /^sensor\.[a-z0-9_]{1,120}$/;
const CAM_WINDOW_MS = 60 * 60_000;     // camera: chi lan phat hien trong 1 gio
const CAL_DAYS = 3;                   // lich: hom nay + 2 ngay toi
const IDLE_REFRESH_MS = 5 * 60_000;   // khong man nao dang khoa: 5 phut/lan
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const CFG_FILE = () => process.env.LOCK_WIDGETS_FILE || path.join(DATA_DIR, 'rwv-lock-widgets.json');

// ── Cau hinh ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Cau hinh da luu (null = chua luu -> theo trang Nang luong cua HA). */
export function savedEnergyCfg(): EnergyCfg | null {
  try {
    const j = JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8'));
    return j && typeof j.energy === 'object' && j.energy ? sanitizeEnergyCfg(j.energy) : null;
  } catch { return null; }
}
export function sanitizeEnergyCfg(x: unknown): EnergyCfg {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const out: EnergyCfg = {};
  for (const k of ['pv', 'pvToday', 'soc', 'bat', 'load', 'grid'] as const) {
    const v = typeof o[k] === 'string' ? (o[k] as string).trim() : '';
    if (ENTITY_RE.test(v)) out[k] = v;
  }
  if (o.batInvert === true && out.bat) out.batInvert = true;
  if (o.gridInvert === true && out.grid) out.gridInvert = true;
  return out;
}
function saveEnergyCfg(c: EnergyCfg | null): void {
  fs.mkdirSync(path.dirname(CFG_FILE()), { recursive: true });
  fs.writeFileSync(CFG_FILE(), JSON.stringify(c ? { energy: c } : {}));
}

type Src = { type?: string; stat_rate?: string; stat_soc?: string; power_config?: { stat_rate?: string; stat_rate_inverted?: string } };
/** Trang Nang luong cua HA -> cam bien cong suat (stat_rate), % pin (stat_soc). Khong co -> bo truong. */
export function energyFromPrefs(prefs: unknown): EnergyCfg {
  const src = ((prefs as { energy_sources?: Src[] })?.energy_sources ?? []) as Src[];
  const of = (t: string) => src.find((s) => s?.type === t);
  const cfg: EnergyCfg = {};
  const rate = (s: Src | undefined, k: 'bat' | 'grid', inv: 'batInvert' | 'gridInvert') => {
    const r = s?.power_config?.stat_rate ?? s?.stat_rate, ri = s?.power_config?.stat_rate_inverted;
    if (r) cfg[k] = r; else if (ri) { cfg[k] = ri; cfg[inv] = true; }
  };
  const pv = of('solar')?.power_config?.stat_rate ?? of('solar')?.stat_rate;
  if (pv) cfg.pv = pv;
  if (of('battery')?.stat_soc) cfg.soc = of('battery')!.stat_soc;
  rate(of('battery'), 'bat', 'batInvert');
  rate(of('grid'), 'grid', 'gridInvert');
  return sanitizeEnergyCfg(cfg);
}
let prefsCache: { at: number; cfg: EnergyCfg } | null = null;
async function haEnergyDefaults(): Promise<EnergyCfg> {
  if (prefsCache && Date.now() - prefsCache.at < 10 * 60_000) return prefsCache.cfg;
  let cfg: EnergyCfg = {};
  try { const [p] = await wsCalls([{ type: 'energy/get_prefs' }]); cfg = energyFromPrefs(p); } catch { /* chua cai trang Nang luong */ }
  prefsCache = { at: Date.now(), cfg };
  return cfg;
}
async function effectiveEnergyCfg(): Promise<{ cfg: EnergyCfg; from: 'saved' | 'ha' }> {
  const s = savedEnergyCfg();
  return s ? { cfg: s, from: 'saved' } : { cfg: await haEnergyDefaults(), from: 'ha' };
}

// ── Doc so lieu ──────────────────────────────────────────────────────────────────────────────────────────────────
interface RawState { state: string; attributes?: { unit_of_measurement?: string; friendly_name?: string; device_class?: string } }
async function readState(id: string): Promise<RawState | null> {
  try { const r = await haFetch('/states/' + encodeURIComponent(id)); return r.ok ? await r.json() as RawState : null; } catch { return null; }
}
/** Gia tri so theo don vi chuan (W / kWh / %); unavailable / unknown / sai don vi -> undefined. */
export function numIn(s: RawState | null, kind: 'W' | 'kWh' | '%'): number | undefined {
  if (!s) return undefined;
  const v = Number(s.state), u = String(s.attributes?.unit_of_measurement ?? '').trim();
  if (s.state === '' || !Number.isFinite(v)) return undefined;
  const k = kind === 'W' ? { W: 1, kW: 1000, MW: 1e6 }[u] : kind === 'kWh' ? { Wh: 0.001, kWh: 1, MWh: 1000 }[u] : (u === '%' || u === '' ? 1 : undefined);
  return k === undefined ? undefined : Math.round(v * k * 100) / 100;
}
export function buildEnergy(cfg: EnergyCfg, st: Partial<Record<keyof EnergyCfg, RawState | null>>): LwEnergy {
  const out: LwEnergy = {};
  const put = (k: keyof LwEnergy, v: number | undefined) => { if (v !== undefined) out[k] = v; };
  put('pv', numIn(st.pv ?? null, 'W'));
  put('pvd', numIn(st.pvToday ?? null, 'kWh'));
  const soc = numIn(st.soc ?? null, '%');
  if (soc !== undefined && soc >= 0 && soc <= 100) out.soc = soc;
  const bat = numIn(st.bat ?? null, 'W'), grid = numIn(st.grid ?? null, 'W');
  if (bat !== undefined) out.bat = cfg.batInvert ? -bat : bat;
  if (grid !== undefined) out.grid = cfg.gridInvert ? -grid : grid;
  put('load', numIn(st.load ?? null, 'W'));
  return out;
}
async function fetchEnergy(): Promise<LwEnergy> {
  const { cfg } = await effectiveEnergyCfg();
  const keys = (['pv', 'pvToday', 'soc', 'bat', 'load', 'grid'] as const).filter((k) => cfg[k]);
  const vals = await Promise.all(keys.map((k) => readState(cfg[k]!)));
  const st: Partial<Record<keyof EnergyCfg, RawState | null>> = {};
  keys.forEach((k, i) => { st[k] = vals[i]; });
  return buildEnergy(cfg, st);
}

/** Su kien lich tho cua HA (REST /calendars/<id>). */
export interface HaCalEvent { summary?: unknown; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }
/** 'YYYY-MM-DD' -> ms epoch cua nua dem gio dia phuong (tzMin = phut lech UTC). */
function localMidnight(d: string, tzMin: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - tzMin * 60_000 : NaN;
}
/**
 * Gop su kien cua cac lich -> danh sach chua xong, som truoc, toi da `max`. Lich co su kien CA NGAY o >= 4 ngay khac nhau
 * trong khung 5 ngay (vd "Lịch âm" moi ngay mot su kien "28/8") la lich nen — bo su kien ca ngay cua no (man khoa da co
 * ngay am).
 */
export function pickEvents(perCal: HaCalEvent[][], nowMs: number, tzMin: number, max = 6): LwEvent[] {
  const out: LwEvent[] = [];
  for (const evs of perCal) {
    const days = new Set(evs.filter((x) => x?.start?.date && !x.start.dateTime).map((x) => x.start!.date));
    const ambient = days.size >= 4;
    for (const x of evs) {
      const t = typeof x?.summary === 'string' ? x.summary.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      if (!t) continue;
      if (x.start?.dateTime) {
        const s = Date.parse(x.start.dateTime), e = x.end?.dateTime ? Date.parse(x.end.dateTime) : s + 3600_000;
        if (Number.isFinite(s) && e > nowMs) out.push({ t, s, e: Number.isFinite(e) ? e : s + 3600_000 });
      } else if (x.start?.date && !ambient) {
        const s = localMidnight(x.start.date, tzMin), e = x.end?.date ? localMidnight(x.end.date, tzMin) : s + 86_400_000;
        if (Number.isFinite(s) && e > nowMs) out.push({ t, s, e: Number.isFinite(e) && e > s ? e : s + 86_400_000, ad: 1 });
      }
    }
  }
  return out.sort((a, b) => a.s - b.s || Number(!!b.ad) - Number(!!a.ad)).slice(0, max);
}
async function fetchCalendar(tzMin: number): Promise<LwEvent[]> {
  const r = await haFetch('/calendars');
  if (!r.ok) throw new Error('calendars ' + r.status);
  const cals = (await r.json() as { entity_id: string }[]).slice(0, 12);
  const now = Date.now(), from = new Date(now - 86_400_000).toISOString(), to = new Date(now + CAL_DAYS * 86_400_000).toISOString();
  const per = await Promise.all(cals.map(async (c) => {
    try {
      const e = await haFetch(`/calendars/${encodeURIComponent(c.entity_id)}?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`);
      return e.ok ? await e.json() as HaCalEvent[] : [];
    } catch { return []; }
  }));
  return pickEvents(per, now, tzMin);
}

// ── Bo dem + lam moi ─────────────────────────────────────────────────────────────────────────────────────────────
interface Slot<T> { at: number; ok: number; v: T; busy?: boolean; err?: number }
const S = {
  en: { at: 0, ok: 0, v: {} } as Slot<LwEnergy>,
  cal: { at: 0, ok: 0, v: [] } as Slot<LwEvent[]>,
  cam: { at: 0, ok: 0, v: [] } as Slot<LwCam[]>,
  hosts: { at: 0, ok: 0, v: {} } as Slot<Record<string, string[]>>,
};
const devIp = new Map<string, string>();
/** Goi luc thiet bi noi WebSocket: nho IP de nhan ra camera cua chinh panel. */
export function noteDeviceIp(deviceId: string, remoteAddress: string | undefined): void {
  const ip = (remoteAddress || '').replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) devIp.set(deviceId, ip);
}

async function run<T>(slot: Slot<T>, every: number, fn: () => Promise<T>): Promise<boolean> {
  const now = Date.now();
  // Loi (vd chua cai Frigate): thu lai sau 5 phut, khong hoi lien tuc.
  if (slot.busy || now - slot.at < (slot.err ? Math.max(every, 5 * 60_000) : every)) return false;
  slot.busy = true; slot.at = now;
  try {
    const v = await fn();
    slot.ok = Date.now(); slot.err = 0;
    const changed = JSON.stringify(v) !== JSON.stringify(slot.v);
    slot.v = v;
    return changed;
  } catch {
    slot.err = (slot.err ?? 0) + 1;
    // So lieu cu qua 15 phut: bo (khong hien cong suat cua nua gio truoc nhu dang la bay gio).
    if (slot.ok && Date.now() - slot.ok > 15 * 60_000) { slot.ok = 0; slot.v = (Array.isArray(slot.v) ? [] : {}) as T; return true; }
    return false;
  } finally { slot.busy = false; }
}

/**
 * Lam moi theo nhip (active = co man hinh dang khoa / cho: nang luong 30 s, camera 20 s, lich 5 phut; khong thi tat ca 5
 * phut). Tra ve true neu so lieu doi (deviceManager day lai trang thai cho cac man dang khoa).
 */
export async function refreshLockWidgets(active: boolean, tzMin: number): Promise<boolean> {
  const k = active ? 1 : 0;
  const res = await Promise.all([
    run(S.en, k ? 30_000 : IDLE_REFRESH_MS, fetchEnergy),
    run(S.cal, IDLE_REFRESH_MS, () => fetchCalendar(tzMin)),
    run(S.hosts, 10 * 60_000, cameraHosts),
    run(S.cam, k ? 20_000 : IDLE_REFRESH_MS, async () => (await recentEvents(Date.now() / 1000 - CAM_WINDOW_MS / 1000, 20))
      .map((e) => ({ id: e.id, c: e.camera, l: e.label, ...(e.sub ? { sub: e.sub } : {}), s: Math.round(e.start * 1000), ...(e.end == null ? { live: 1 as const } : {}) }))),
  ]);
  return res.some(Boolean);
}

/** Widget cho MOT man hinh theo cai dat cua no (null = khong co gi de hien). */
export function lockWidgetsFor(deviceId: string, want: LwWant, nowMs = Date.now()): LwData | null {
  const out: LwData = {};
  if (want.en && Object.keys(S.en.v).length) out.en = S.en.v;
  if (want.cal) { const ev = S.cal.v.filter((e) => e.e > nowMs); if (ev.length) out.ev = ev; }
  if (want.cam) {
    const ip = devIp.get(deviceId);
    const self = new Set(ip ? Object.entries(S.hosts.v).filter(([, h]) => h.includes(ip)).map(([c]) => c) : []);
    const e = S.cam.v.find((x) => !self.has(x.c) && (x.live || nowMs - x.s < CAM_WINDOW_MS));
    if (e) out.cam = e;
  }
  return Object.keys(out).length ? out : null;
}

// ── API cho trang Darboard (ingress): tab "Màn khóa" ────────────────────────────────────────────────────────────
const INGRESS_IP = '172.30.32.2';
function fromIngress(req: http.IncomingMessage): boolean {
  if (process.env.LAUNCHER_CONFIG_OPEN === '1') return true;
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === INGRESS_IP;
}
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
interface Candidate { id: string; name: string; unit: string; dc: string; state: string }
async function snapshot(): Promise<Record<string, unknown>> {
  const [eff, ha] = await Promise.all([effectiveEnergyCfg(), haEnergyDefaults()]);
  let cands: Candidate[] = [];
  try {
    const r = await haFetch('/states');
    if (r.ok) {
      const all = await r.json() as (RawState & { entity_id: string })[];
      cands = all.filter((s) => s.entity_id.startsWith('sensor.') &&
          (['power', 'energy', 'battery'].includes(String(s.attributes?.device_class)) || /^(W|kW|Wh|kWh|MWh)$/.test(String(s.attributes?.unit_of_measurement ?? ''))))
        .map((s) => ({ id: s.entity_id, name: String(s.attributes?.friendly_name ?? '').slice(0, 80), unit: String(s.attributes?.unit_of_measurement ?? ''),
          dc: String(s.attributes?.device_class ?? ''), state: String(s.state).slice(0, 20) }))
        .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 600);
    }
  } catch { /* HA chua san sang */ }
  return { ok: true, from: eff.from, cfg: eff.cfg, ha, candidates: cands, energy: S.en.v };
}
/** GET/POST lockwidgets/config (duong dan trang KHONG co "/" dau — ingress them tien to). GET: ingress / 127.0.0.1; POST chi ingress. */
export function handleLockWidgetsApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (url.pathname !== '/lockwidgets/config') return false;
  // Danh sach cam bien + so lieu nha nguoi dung: chi trang Darboard (ingress) hoac chinh may chu doc duoc, khong mo ca LAN.
  if (!fromIngress(req) && !/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '')) {
    json(res, 403, { error: 'Chỉ mở được từ trang Darboard trong Home Assistant.' }); return true;
  }
  if (req.method === 'GET') { snapshot().then((s) => json(res, 200, s)).catch((e: Error) => json(res, 500, { error: e.message })); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'method' }); return true; }
  if (!fromIngress(req)) { json(res, 403, { error: 'Chỉ lưu được từ trang Darboard trong Home Assistant.' }); return true; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 20_000) req.destroy(); });
  req.on('end', () => {
    try {
      const j = JSON.parse(body) as { energy?: unknown };
      saveEnergyCfg(j.energy === null ? null : sanitizeEnergyCfg(j.energy));
      S.en.at = 0; prefsCache = null;            // doc lai ngay o lan lam moi ke tiep
      fetchEnergy().then((v) => { S.en.v = v; S.en.ok = Date.now(); }).catch(() => { })
        .finally(() => { snapshot().then((s) => json(res, 200, s)).catch((e: Error) => json(res, 500, { error: e.message })); });
      console.log('[lockwidgets] da luu cam bien nang luong');
    } catch (e) { json(res, 400, { error: (e as Error).message }); }
  });
  return true;
}
