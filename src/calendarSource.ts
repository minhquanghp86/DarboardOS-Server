// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (09/10/2026) NGUON LICH DUNG CHUNG (widget man hinh khoa, trang "Hôm nay"): KHONG bat buoc Home Assistant co lich.
//  - HA co tich hop lich (calendar.*) -> lay qua REST nhu truoc.
//  - Nguoi dung dan "Địa chỉ bí mật ở định dạng iCal" cua Google Calendar (hoac bat ky lich .ics nao) trong trang Dashboard
//    (the "Màn khóa") -> server tai, giai ma bang ical.js (su kien lap lai RRULE + ngoai le + mui gio VTIMEZONE).
//  - Khong co nguon nao -> mang rong (widget / trang Hom nay an phan lich).
// Dia chi iCal bi mat = quyen DOC lich: chi luu /data cua add-on, chi trang Dashboard (ingress) doc / sua; khong log,
// khong tra nguyen van ra trang (chi ten + duoi rut gon).
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import ICAL from 'ical.js';
import { haFetch } from './haSettings.js';

/** Su kien theo dinh dang REST /calendars cua HA (de dung chung pickEvents / trang Hom nay). */
export interface CalEv { summary: string; start: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }
export interface IcalSrc { name: string; url: string }

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const CFG_FILE = () => process.env.CALENDAR_FILE || path.join(DATA_DIR, 'rwv-calendars.json');
const MAX_SRC = 8;
const MAX_BYTES = 5 * 1024 * 1024;
const TTL_MS = 15 * 60_000;

// ── Cau hinh ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function normIcalUrl(u: string): string | null {
  let s = String(u || '').trim();
  if (/^webcal:\/\//i.test(s)) s = 'https://' + s.slice(9);
  try { const x = new URL(s); return /^https?:$/.test(x.protocol) && s.length <= 1000 ? s : null; } catch { return null; }
}
export function sanitizeIcal(list: unknown): IcalSrc[] {
  const out: IcalSrc[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const url = normIcalUrl((x as IcalSrc)?.url);
    if (!url || out.some((o) => o.url === url)) continue;
    const name = String((x as IcalSrc)?.name ?? '').trim().slice(0, 40) || new URL(url).hostname;
    out.push({ name, url });
    if (out.length >= MAX_SRC) break;
  }
  return out;
}
export function icalSources(): IcalSrc[] {
  try { return sanitizeIcal(JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')).ical); } catch { return []; }
}
export function saveIcalSources(list: IcalSrc[]): void {
  fs.mkdirSync(path.dirname(CFG_FILE()), { recursive: true });
  fs.writeFileSync(CFG_FILE(), JSON.stringify({ ical: list }), { mode: 0o600 });
  cache.clear();
}
/** Hien tren trang: KHONG tra nguyen dia chi bi mat. */
export function maskUrl(u: string): string {
  try { const x = new URL(u); const t = x.pathname; return `${x.hostname}/…${t.slice(-14)}`; } catch { return '…'; }
}

// ── Giai ma iCal ────────────────────────────────────────────────────────────────────────────────────────────────
function toCal(t: ICAL.Time): { date?: string; dateTime?: string } {
  if (t.isDate) return { date: `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` };
  return { dateTime: t.toJSDate().toISOString() };
}
/** Su kien trong [fromMs, toMs) cua mot tep iCal (lap lai: toi da 20 000 lan lap / su kien, 400 su kien ra). */
export function parseIcal(text: string, fromMs: number, toMs: number): CalEv[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(new ICAL.Timezone(tz)); } catch { /* mui gio loi: dung UTC */ }
  }
  const masters = new Map<string, ICAL.Event>(), exceptions: ICAL.Event[] = [];
  for (const vc of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vc);
    if (ev.isRecurrenceException()) exceptions.push(ev); else if (ev.uid) masters.set(ev.uid, ev); else masters.set(Math.random().toString(36), ev);
  }
  for (const ex of exceptions) { const m = masters.get(ex.uid); if (m) m.relateException(ex); }
  const out: CalEv[] = [];
  const push = (summary: string, s: ICAL.Time, e: ICAL.Time | null) => {
    const sm = s.toJSDate().getTime(), em = e ? e.toJSDate().getTime() : sm;
    if (em >= fromMs && sm < toMs && out.length < 400) out.push({ summary: String(summary || '').slice(0, 120), start: toCal(s), ...(e ? { end: toCal(e) } : {}) });
  };
  for (const ev of masters.values()) {
    try {
      if (!ev.isRecurring()) { push(ev.summary, ev.startDate, ev.endDate); continue; }
      const it = ev.iterator();
      for (let n = 0, next = it.next(); next && n < 20_000; n++, next = it.next()) {
        if (next.toJSDate().getTime() >= toMs) break;
        const d = ev.getOccurrenceDetails(next);
        push(d.item.summary, d.startDate, d.endDate);
      }
    } catch { /* su kien hong: bo qua */ }
  }
  return out;
}

// ── Lay du lieu ──────────────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map<string, { at: number; text: string }>();
/** Trang thai lan tai gan nhat cua tung nguon (trang Dashboard hien). */
export const icalStatus = new Map<string, { at: number; ok: boolean; msg: string }>();

async function fetchText(url: string): Promise<string> {
  const c = cache.get(url);
  if (c && Date.now() - c.at < TTL_MS) return c.text;
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'HA-Dashboard/1 (+calendar)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('tệp lịch quá lớn');
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error('tệp lịch quá lớn');
  if (!/BEGIN:VCALENDAR/.test(text.slice(0, 2000))) throw new Error('không phải tệp iCal (.ics)');
  cache.set(url, { at: Date.now(), text });
  return text;
}

/** Lich iCal da cau hinh, moi nguon mot mang. Loi mot nguon khong anh huong nguon khac. */
export async function icalEvents(fromMs: number, toMs: number): Promise<CalEv[][]> {
  return Promise.all(icalSources().map(async (s) => {
    try {
      const ev = parseIcal(await fetchText(s.url), fromMs, toMs);
      icalStatus.set(s.url, { at: Date.now(), ok: true, msg: `${ev.length} sự kiện trong khoảng đang xem` });
      return ev;
    } catch (e) {
      icalStatus.set(s.url, { at: Date.now(), ok: false, msg: (e as Error).message });
      return [];
    }
  }));
}

/** Lich cua HA (neu co tich hop lich). Khong co HA / khong co lich -> []. */
export async function haCalendarEvents(fromMs: number, toMs: number, maxCals = 12): Promise<CalEv[][]> {
  let cals: { entity_id: string }[] = [];
  try { const r = await haFetch('/calendars'); if (r.ok) cals = (await r.json() as { entity_id: string }[]).slice(0, maxCals); } catch { return []; }
  const from = new Date(fromMs).toISOString(), to = new Date(toMs).toISOString();
  return Promise.all(cals.map(async (c) => {
    try {
      const e = await haFetch(`/calendars/${encodeURIComponent(c.entity_id)}?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`);
      return e.ok ? await e.json() as CalEv[] : [];
    } catch { return []; }
  }));
}

/** Tat ca nguon lich (HA + iCal). */
export async function allCalendarEvents(fromMs: number, toMs: number): Promise<CalEv[][]> {
  const [ha, ic] = await Promise.all([haCalendarEvents(fromMs, toMs), icalEvents(fromMs, toMs)]);
  return [...ha, ...ic];
}

// ── API cho trang Dashboard (ingress): the "Màn khóa" -> khung "Lịch" ───────────────────────────────────────────
const INGRESS_IP = '172.30.32.2';
const fromIngress = (req: http.IncomingMessage) =>
  process.env.LAUNCHER_CONFIG_OPEN === '1' || (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === INGRESS_IP;
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function view(): Promise<Record<string, unknown>> {
  let ha: string[] = [];
  try { const r = await haFetch('/calendars'); if (r.ok) ha = (await r.json() as { name?: string; entity_id: string }[]).map((c) => c.name || c.entity_id).slice(0, 20); } catch { /* khong co HA */ }
  const now = Date.now();
  await icalEvents(now - 86_400_000, now + 3 * 86_400_000).catch(() => null);   // cap nhat trang thai tung nguon
  return { ok: true, ha, ical: icalSources().map((s) => ({ name: s.name, url: maskUrl(s.url), ...(icalStatus.get(s.url) ?? {}) })) };
}
/** GET / POST calendar/config (khong "/" dau — ingress them tien to). POST {add:{name,url}} | {remove:<chi so>}. Chi ingress. */
export function handleCalendarApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (url.pathname !== '/calendar/config') return false;
  if (!fromIngress(req)) { json(res, 403, { error: 'Chỉ mở được từ trang Dashboard trong Home Assistant.' }); return true; }
  if (req.method === 'GET') { view().then((v) => json(res, 200, v)).catch((e: Error) => json(res, 500, { error: e.message })); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'method' }); return true; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 10_000) req.destroy(); });
  req.on('end', () => {
    try {
      const j = JSON.parse(body) as { add?: IcalSrc; remove?: number };
      const list = icalSources();
      if (j.add) {
        const u = normIcalUrl(j.add.url);
        if (!u) { json(res, 400, { error: 'Địa chỉ phải là https://… (hoặc webcal://…) của tệp lịch .ics.' }); return; }
        if (list.length >= MAX_SRC) { json(res, 400, { error: `Tối đa ${MAX_SRC} lịch.` }); return; }
        list.push({ name: String(j.add.name || '').trim().slice(0, 40) || new URL(u).hostname, url: u });
      } else if (Number.isInteger(j.remove) && j.remove! >= 0 && j.remove! < list.length) {
        list.splice(j.remove!, 1);
      } else { json(res, 400, { error: 'yêu cầu không hợp lệ' }); return; }
      saveIcalSources(sanitizeIcal(list));
      console.log(`[calendar] da luu ${icalSources().length} lich iCal`);   // KHONG log dia chi (quyen doc lich)
      view().then((v) => json(res, 200, v)).catch((e: Error) => json(res, 500, { error: e.message }));
    } catch (e) { json(res, 400, { error: (e as Error).message }); }
  });
  return true;
}
