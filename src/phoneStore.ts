// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — DIEN THOAI THUONG TRU: app Android (WebView shell + PhoneService) tu dang ky MOT LAN bang
// POST /app/register {id, name, url?}. `id` do app sinh ra va luu trong SharedPreferences, nen dien thoai van la
// cung mot "thiet bi" qua cac lan mo app / khoi dong lai may.
//
// (GD8 — 30/10/2026) MOT MAY = MOT BAN GHI: `id` sinh moi lan CAI LAI APP / XOA DU LIEU APP, nen cung mot may
// thanh 2-3 ban ghi trong danh ba. App gui them `deviceKey` = Settings.Secure.ANDROID_ID (on dinh tren cung may,
// khong doi khi cai lai) + `model`:
//   - register: da co ban ghi CUNG `deviceKey` (khac id) -> GOP: giu ban ghi CU NHAT, cap nhat name/url/model/lastSeen,
//     xoa ban ghi trung, tra ve `id` cua ban ghi duoc giu (app cap nhat lai id trong Prefs).
//   - doc file: tu don ban ghi trung `deviceKey` (giu ban co lastSeen MOI NHAT) + ban ghi mo coi (id hong).
//   - ban ghi KHONG co `deviceKey` (du lieu cua ban cu): van dedupe theo `id` nhu truoc.
// `deviceKey` duoc BAM (sha256, 16 hex) truoc khi luu: file /data va GET /app/list khong bao gio chua ANDROID_ID tho.
//
// So dang ky nay (src/phoneStore.ts) chi lo PHAN LUU TRU thuan (khong mang, khong HTTP) de test de dang:
//   - file /data/rwv-phones.json (ben qua cap nhat add-on, nhu rwv-board.json),
//   - lastSeen cap nhat moi lan app poll (GET /app/incoming) nhung chi GHI FILE toi da 10 s/lan
//     (app poll 2 s/lan -> khong duoc phep ghi the 30 lan/phut).
// src/calls.ts doc so nay de coi moi dien thoai la thiet bi goi duoc (danh ba cua P4 + do chuong).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Phone {
  id: string;
  name: string;
  url: string;
  /** Build.MODEL cua may (chi de hien thi / phan biet cac may cung ten). */
  model?: string;
  /** `deviceKey` DA BAM (16 hex) — khoa nhan dang on dinh cua may, xem hashDeviceKey(). */
  deviceKey?: string;
  lastSeen: number;
  ts: number;
}
export interface PhoneReg { id: string; name: string; url: string; model?: string; deviceKey?: string }

/** Toida so dien thoai dang ky (nha dung that, con so nay chi de chan lam day file). */
export const MAX_PHONES = 32;
/** Nhan hien trong danh ba cua P4 (yeu cau GD2: "Điện thoại"). */
export const PHONE_KIND_LABEL = 'Điện thoại';
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SAVE_MIN_MS = 10_000;
/** Do dai `deviceKey` tho nhan tu app (ANDROID_ID = 16 hex, nhung cho rong ra cho ban ROM khac). */
const DEVICE_KEY_MAX = 128;
/** Do dai chuoi bam luu trong file / tra ve /app/list (du de phan biet may, khong du de doan nguoc). */
const DEVICE_KEY_HASH_LEN = 16;

/** Ten hien thi: "<ten may> · Điện thoại" (chua dang ky ten -> chi "Điện thoại"). */
export function phoneLabel(p?: { name?: string } | null): string {
  const n = (p?.name || '').trim();
  if (!n || n === PHONE_KIND_LABEL) return PHONE_KIND_LABEL;
  return `${n} · ${PHONE_KIND_LABEL}`;
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';

/**
 * Bam `deviceKey` tho (ANDROID_ID) -> 16 hex. Rong/khong hop le -> '' (= may khong gui deviceKey).
 * Nho vay file /data va GET /app/list khong luu/khong tra id phan cung tho. PhoneStore.register() tu goi ham nay,
 * nen noi khac chi can dung khoa THO.
 */
export function hashDeviceKey(raw?: string | null): string {
  const v = clean(raw, DEVICE_KEY_MAX);
  if (!v) return '';
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, DEVICE_KEY_HASH_LEN);
}

/** Kiem tra body POST /app/register. */
export function parseRegister(body: any): { ok: true; reg: PhoneReg } | { ok: false; error: string } {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return { ok: false, error: 'can id' };
  if (!ID_RE.test(id)) return { ok: false, error: 'id khong hop le' };
  const url = clean(body?.url, 200);
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: 'url phai la http(s)' };
  return {
    ok: true,
    reg: {
      id,
      name: clean(body?.name, 40) || PHONE_KIND_LABEL,
      url,
      model: clean(body?.model, 40),
      // Khoa THO (ANDROID_ID); PhoneStore.register() bam truoc khi luu.
      deviceKey: clean(body?.deviceKey, DEVICE_KEY_MAX),
    },
  };
}

/** Kiem tra body POST /app/rename / /app/remove (chi doc `id`, `name`). */
export function parseId(body: any): { ok: true; id: string } | { ok: false; error: string } {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return { ok: false, error: 'can id' };
  if (!ID_RE.test(id)) return { ok: false, error: 'id khong hop le' };
  return { ok: true, id };
}

export class PhoneStore {
  private map = new Map<string, Phone>();
  private lastSave = 0;

  constructor(private file: string | null) {
    if (!file) return;
    let dropped = 0;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const arr: unknown[] = Array.isArray(j) ? j : Array.isArray((j as any)?.phones) ? (j as any).phones : [];
      for (const raw of arr) {
        const p = raw as Partial<Phone>;
        if (typeof p?.id !== 'string' || !ID_RE.test(p.id)) { dropped++; continue; }   // ban ghi mo coi
        this.map.set(p.id, {
          id: p.id,
          name: clean(p.name, 40) || PHONE_KIND_LABEL,
          url: clean(p.url, 200),
          model: clean(p.model, 40),
          deviceKey: clean(p.deviceKey, DEVICE_KEY_HASH_LEN),
          lastSeen: Number(p.lastSeen) || 0,
          ts: Number(p.ts) || 0,
        });
      }
    } catch { /* chua co file / file hong */ }
    // Tu don file: ban ghi trung deviceKey (giu ban co lastSeen moi nhat). Chi ghi lai khi that su co ban ghi bi bo.
    dropped += this.dedupe();
    if (dropped) this.save(true);
  }

  /**
   * Dang ky / cap nhat. Gop ban ghi trung `deviceKey` (cung mot may, id moi do cai lai app):
   * giu ban ghi CU NHAT (ts nho nhat), tra ve ban ghi do. `ts` (lan dang ky dau) duoc giu nguyen.
   */
  register(reg: PhoneReg, now = Date.now()): Phone {
    const deviceKey = reg.deviceKey ? hashDeviceKey(reg.deviceKey) : '';
    const keeper = deviceKey ? this.oldestWithKey(deviceKey) : undefined;
    const id = keeper?.id || reg.id;
    const old = this.map.get(id);
    const p: Phone = {
      id,
      name: clean(reg.name, 40) || PHONE_KIND_LABEL,
      url: clean(reg.url, 200),
      model: clean(reg.model, 40) || old?.model || keeper?.model || '',
      deviceKey: deviceKey || old?.deviceKey || '',
      lastSeen: now,
      ts: old?.ts || keeper?.ts || now,
    };
    // Xoa cac ban ghi trung: cung deviceKey, va ban ghi CU chua co deviceKey dung id vua dang ky.
    // (Chi khi co deviceKey: neu khong, `deviceKey === ''` se khop voi MOI ban ghi cua file cu.)
    if (deviceKey) {
      for (const [k, v] of [...this.map]) {
        if (k === id) continue;
        if (v.deviceKey === deviceKey || (k === reg.id && !v.deviceKey)) this.map.delete(k);
      }
    }
    this.map.set(id, p);
    while (this.map.size > MAX_PHONES) {
      // Bo dien thoai LAU KHONG THAY NHAT (khong bao gio bo cai vua dang ky).
      const victim = [...this.map.values()].filter((x) => x.id !== p.id).sort((a, b) => a.lastSeen - b.lastSeen)[0];
      if (!victim) break;
      this.map.delete(victim.id);
    }
    this.save(true, now);
    return { ...p };
  }

  get(id: string): Phone | undefined {
    const p = this.map.get(id);
    return p ? { ...p } : undefined;
  }

  has(id: string): boolean { return this.map.has(id); }

  /** Ban ghi CUNG `deviceKey` cu nhat (ts nho nhat) — ban ghi duoc giu khi gop. */
  private oldestWithKey(deviceKey: string): Phone | undefined {
    const same = [...this.map.values()].filter((x) => x.deviceKey === deviceKey);
    same.sort((a, b) => (a.ts - b.ts) || a.id.localeCompare(b.id));
    return same[0];
  }

  /** Don ban ghi trung `deviceKey` (giu ban co `lastSeen` MOI NHAT). Tra so ban ghi da bo. */
  private dedupe(): number {
    const best = new Map<string, Phone>();
    let dropped = 0;
    for (const p of [...this.map.values()]) {
      if (!p.deviceKey) continue;
      const cur = best.get(p.deviceKey);
      if (!cur) { best.set(p.deviceKey, p); continue; }
      const loser = p.lastSeen > cur.lastSeen ? cur : p;
      best.set(p.deviceKey, loser === cur ? p : cur);
      this.map.delete(loser.id);
      dropped++;
    }
    return dropped;
  }

  /** App vua poll -> con song. Ghi file toi da 10 s/lan (xem SAVE_MIN_MS). */
  touch(id: string, now = Date.now()): void {
    const p = this.map.get(id);
    if (!p) return;
    p.lastSeen = now;
    if (now - this.lastSave >= SAVE_MIN_MS) this.save(false, now);
  }

  list(): Phone[] {
    return [...this.map.values()].map((p) => ({ ...p })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  /** Doi ten hien thi cua mot thiet bi (ghi file NGAY). undefined = khong co ban ghi do. */
  rename(id: string, name: string): Phone | undefined {
    const p = this.map.get(id);
    if (!p) return undefined;
    p.name = clean(name, 40) || PHONE_KIND_LABEL;
    this.save(true);
    return { ...p };
  }

  /** Xoa mot thiet bi (ghi file NGAY). false = khong co ban ghi do. */
  remove(id: string): boolean {
    const ok = this.map.delete(id);
    if (ok) this.save(true);
    return ok;
  }

  private save(force: boolean, now = Date.now()): void {
    if (!this.file) return;
    if (!force && now - this.lastSave < SAVE_MIN_MS) return;
    this.lastSave = now;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.list()));
    } catch { /* bo qua: dang ky chi de tien, khong duoc lam chet server */ }
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
/** So dang ky dung chung (src/calls.ts). */
export let phones = new PhoneStore(process.env.PHONES_FILE || path.join(DATA_DIR, 'rwv-phones.json'));

/** Thay so dang ky (test / khi doi duong dan du lieu). */
export function setPhoneStore(s: PhoneStore): void { phones = s; }
