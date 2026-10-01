// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (02/10/2026) UNG DUNG BAO THUC (public/alarm.html). Bao thuc giu o SERVER (/data/rwv-alarms.json) — man hinh tat, mat
// ket noi hay mo ung dung khac van reo dung gio. Gio tinh theo mui gio cua man hinh (anyTzOffset — moi panel cung nha).
//   - Lap theo thu (days 0 = Chu nhat .. 6 = Thu bay) hoac mot lan (days rong -> tu tat sau khi reo).
//   - Reo tren man hinh chon (hoac moi man hinh); TAT / BAO LAI tren bat ky man nao = ca nhom ngung (mot bao thuc).
//   - Reo toi da 5 phut khong ai tat -> dung + thong bao "bao thuc bi lo".
//   - Am luong: loai Bao thuc (src/sound.ts). Khong lam phien: im lang (van hien man hinh bao thuc).
// Hen gio (timer.html) dung chung co che reo nay (id "timer:<man hinh>", khong co Bao lai).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

export interface Alarm {
  id: string;
  /** "HH:MM" gio dia phuong. */
  time: string;
  /** Thu lap lai (0 = CN .. 6 = T7). Rong = mot lan. */
  days: number[];
  label: string;
  enabled: boolean;
  /** Man hinh reo: 'all' hoac danh sach id. */
  devices: 'all' | string[];
  /** Phut bao lai. */
  snooze: number;
}

export interface Ringing { id: string; label: string; time: string; devices: string[]; since: number; snooze: number; timer: boolean }

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const RING_MAX_MS = 5 * 60_000;

export function normAlarm(a: any, old?: Alarm): Alarm {
  const time = typeof a?.time === 'string' && TIME_RE.test(a.time) ? a.time : old?.time;
  if (!time) throw new Error('Giờ không hợp lệ (HH:MM).');
  const days = Array.isArray(a?.days) ? [...new Set(a.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[] : (old?.days ?? []);
  const label = typeof a?.label === 'string' ? a.label.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) : (old?.label ?? '');
  const devs = a?.devices === 'all' ? 'all' : Array.isArray(a?.devices) ? a.devices.filter((d: unknown) => typeof d === 'string' && /^[\w.-]{1,64}$/.test(d)).slice(0, 20) : (old?.devices ?? 'all');
  const snooze = [5, 10, 15, 20, 30].includes(Number(a?.snooze)) ? Number(a.snooze) : (old?.snooze ?? 10);
  return { id: old?.id ?? crypto.randomBytes(6).toString('hex'), time, days, label, enabled: a?.enabled === undefined ? (old?.enabled ?? true) : !!a.enabled, devices: devs.length === 0 ? 'all' : devs, snooze };
}

/** Lan reo ke tiep (ms epoch) sau `now`, voi mui gio `tzMin` (phut, dong). null = khong bat. */
export function nextFire(a: Alarm, now: number, tzMin: number): number | null {
  if (!a.enabled) return null;
  const [h, m] = a.time.split(':').map(Number);
  const local = new Date(now + tzMin * 60_000);  // doc bang getUTC* = gio dia phuong
  for (let d = 0; d <= 7; d++) {
    const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d, h, m) - tzMin * 60_000;
    if (t <= now) continue;
    const wd = new Date(t + tzMin * 60_000).getUTCDay();
    if (a.days.length === 0 || a.days.includes(wd)) return t;
  }
  return null;
}

export interface AlarmHooks {
  tz(): number;
  screens(): string[];
  /** Bat dau reo tren cac man hinh (danh thuc, man hinh bao thuc, am Bao thuc). */
  ring(r: Ringing): void;
  /** Ngung reo (tat am + dong man hinh bao thuc). */
  stop(r: Ringing): void;
  missed(r: Ringing): void;
  changed(): void;
}

export class AlarmStore {
  alarms: Alarm[] = [];
  ringing = new Map<string, Ringing>();
  /** Bao lai: id -> thoi diem reo lai. */
  snoozed = new Map<string, number>();
  private fired = new Map<string, number>();  // id -> moc phut da reo (tranh reo 2 lan trong 1 phut)
  hooks: AlarmHooks | null = null;
  constructor(private file: string | null) {
    if (!file) return;
    try { this.alarms = (JSON.parse(fs.readFileSync(file, 'utf8')) as any[]).map((a) => { try { return { ...normAlarm(a), id: String(a.id) }; } catch { return null; } }).filter(Boolean) as Alarm[]; } catch { /* chua co */ }
  }
  private save(): void {
    if (this.file) fs.promises.writeFile(this.file, JSON.stringify(this.alarms)).catch(() => { });
    this.hooks?.changed();
  }
  upsert(a: any): Alarm {
    const old = typeof a?.id === 'string' ? this.alarms.find((x) => x.id === a.id) : undefined;
    if (!old && this.alarms.length >= 30) throw new Error('Tối đa 30 báo thức.');
    const n = normAlarm(a, old);
    if (old) Object.assign(old, n); else this.alarms.push(n);
    this.snoozed.delete(n.id);
    this.save();
    return n;
  }
  remove(id: string): boolean {
    const n = this.alarms.length;
    this.alarms = this.alarms.filter((a) => a.id !== id);
    this.snoozed.delete(id);
    if (this.ringing.has(id)) this.stop(id);
    if (n !== this.alarms.length) this.save();
    return n !== this.alarms.length;
  }
  /** Bao thuc ke tiep (tinh ca bao lai) — cho thanh trang thai / man hinh cho / ung dung. */
  next(now: number, tz: number, device?: string): { id: string; at: number; label: string; time: string } | null {
    let best: { id: string; at: number; label: string; time: string } | null = null;
    for (const a of this.alarms) {
      if (device && a.devices !== 'all' && !a.devices.includes(device)) continue;
      const at = this.snoozed.get(a.id) ?? nextFire(a, now, tz);
      if (at != null && (!best || at < best.at)) best = { id: a.id, at, label: a.label, time: a.time };
    }
    return best;
  }
  /** Goi moi vai giay. */
  tick(now = Date.now()): void {
    const h = this.hooks;
    if (!h) return;
    const tz = h.tz();
    const local = new Date(now + tz * 60_000);
    const hm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
    const minute = Math.floor((now + tz * 60_000) / 60_000);
    for (const a of this.alarms) {
      if (!a.enabled || a.time !== hm || this.fired.get(a.id) === minute) continue;
      if (a.days.length && !a.days.includes(local.getUTCDay())) continue;
      this.fired.set(a.id, minute);
      this.snoozed.delete(a.id);
      if (a.days.length === 0) { a.enabled = false; this.save(); }  // mot lan
      this.start(a, now);
    }
    for (const [id, at] of this.snoozed) {
      if (now < at) continue;
      this.snoozed.delete(id);
      const a = this.alarms.find((x) => x.id === id);
      if (a) this.start(a, now);
    }
    for (const r of [...this.ringing.values()]) {
      if (now - r.since < RING_MAX_MS) continue;
      this.ringing.delete(r.id);
      h.stop(r); h.missed(r); h.changed();
    }
  }
  private start(a: Alarm, now: number): void {
    const devices = a.devices === 'all' ? this.hooks!.screens() : a.devices;
    const r: Ringing = { id: a.id, label: a.label, time: a.time, devices, since: now, snooze: a.snooze, timer: false };
    this.ringing.set(a.id, r);
    console.log(`[alarm] REO ${a.time}${a.label ? ` (${a.label})` : ''} tren ${devices.length} man hinh`);
    this.hooks!.ring(r); this.hooks!.changed();
  }
  /** Hen gio het: reo tren DUNG man hinh do (khong Bao lai). */
  ringTimer(device: string, label: string, now = Date.now()): void {
    const r: Ringing = { id: 'timer:' + device, label: label || 'Hẹn giờ đã kết thúc', time: '', devices: [device], since: now, snooze: 0, timer: true };
    this.ringing.set(r.id, r);
    this.hooks?.ring(r); this.hooks?.changed();
  }
  stop(id: string): boolean {
    const r = this.ringing.get(id);
    if (!r) return false;
    this.ringing.delete(id);
    this.hooks?.stop(r); this.hooks?.changed();
    return true;
  }
  snooze(id: string, now = Date.now()): boolean {
    const r = this.ringing.get(id);
    if (!r || r.timer) return this.stop(id);
    this.snoozed.set(id, now + r.snooze * 60_000);
    return this.stop(id);
  }
  /** Bao thuc dang reo tren man hinh nay (de hien lai man hinh bao thuc khi trang tai lai). */
  ringingOn(device: string): Ringing | null {
    for (const r of this.ringing.values()) if (r.devices.includes(device)) return r;
    return null;
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const alarms = new AlarmStore(process.env.ALARMS_FILE || path.join(DATA_DIR, 'rwv-alarms.json'));
setInterval(() => alarms.tick(), 5_000).unref();

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** API cho alarm.html (chi tu man hinh — 127.0.0.1). true = da xu ly. */
export function handleAlarmApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL,
  screensInfo: () => { id: string; name: string; spk: boolean }[]): boolean {
  if (!url.pathname.startsWith('/alarm/')) return false;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip !== '127.0.0.1' && ip !== '::1') { json(res, 403, { error: 'Chỉ dùng được từ màn hình.' }); return true; }
  const route = url.pathname.slice(7), q = url.searchParams;
  const tz = alarms.hooks?.tz() ?? 420;
  if (route === 'list' && req.method === 'GET') {
    const now = Date.now();
    json(res, 200, {
      alarms: alarms.alarms.map((a) => ({ ...a, next: alarms.snoozed.get(a.id) ?? nextFire(a, now, tz), snoozed: alarms.snoozed.has(a.id) })),
      next: alarms.next(now, tz, q.get('dev') || undefined), screens: screensInfo(), now, tz,
    });
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { error: 'method' }); return true; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
  req.on('end', () => {
    try {
      const b = body ? JSON.parse(body) : {};
      const id = q.get('id') || b.id || '';
      if (route === 'save') return json(res, 200, { ok: true, alarm: alarms.upsert(b) });
      if (route === 'del') return json(res, 200, { ok: alarms.remove(id) });
      if (route === 'toggle') {
        const a = alarms.alarms.find((x) => x.id === id);
        if (!a) return json(res, 404, { error: 'Không tìm thấy báo thức.' });
        return json(res, 200, { ok: true, alarm: alarms.upsert({ id, enabled: q.get('on') === '1' }) });
      }
      if (route === 'stop') return json(res, 200, { ok: alarms.stop(id) });
      if (route === 'snooze') return json(res, 200, { ok: alarms.snooze(id) });
      json(res, 404, { error: 'khong co' });
    } catch (e) { json(res, 400, { error: (e as Error).message }); }
  });
  return true;
}
