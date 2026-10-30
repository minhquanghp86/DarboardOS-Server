// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — DIEN THOAI THUONG TRU: app Android (WebView shell + PhoneService) tu dang ky MOT LAN bang
// POST /app/register {id, name, url?}. `id` do app sinh ra va luu trong SharedPreferences, nen dien thoai van la
// cung mot "thiet bi" qua cac lan mo app / khoi dong lai may.
//
// So dang ky nay (src/phoneStore.ts) chi lo PHAN LUU TRU thuan (khong mang, khong HTTP) de test de dang:
//   - file /data/rwv-phones.json (ben qua cap nhat add-on, nhu rwv-board.json),
//   - lastSeen cap nhat moi lan app poll (GET /app/incoming) nhung chi GHI FILE toi da 10 s/lan
//     (app poll 2 s/lan -> khong duoc phep ghi the 30 lan/phut).
// src/calls.ts doc so nay de coi moi dien thoai la thiet bi goi duoc (danh ba cua P4 + do chuong).
import fs from 'node:fs';
import path from 'node:path';

export interface Phone { id: string; name: string; url: string; lastSeen: number; ts: number }
export interface PhoneReg { id: string; name: string; url: string }

/** Toida so dien thoai dang ky (nha dung that, con so nay chi de chan lam day file). */
export const MAX_PHONES = 32;
/** Nhan hien trong danh ba cua P4 (yeu cau GD2: "Điện thoại"). */
export const PHONE_KIND_LABEL = 'Điện thoại';
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SAVE_MIN_MS = 10_000;

/** Ten hien thi: "<ten may> · Điện thoại" (chua dang ky ten -> chi "Điện thoại"). */
export function phoneLabel(p?: { name?: string } | null): string {
  const n = (p?.name || '').trim();
  if (!n || n === PHONE_KIND_LABEL) return PHONE_KIND_LABEL;
  return `${n} · ${PHONE_KIND_LABEL}`;
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';

/** Kiem tra body POST /app/register. */
export function parseRegister(body: any): { ok: true; reg: PhoneReg } | { ok: false; error: string } {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return { ok: false, error: 'can id' };
  if (!ID_RE.test(id)) return { ok: false, error: 'id khong hop le' };
  const url = clean(body?.url, 200);
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: 'url phai la http(s)' };
  return { ok: true, reg: { id, name: clean(body?.name, 40) || PHONE_KIND_LABEL, url } };
}

export class PhoneStore {
  private map = new Map<string, Phone>();
  private lastSave = 0;

  constructor(private file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const arr: unknown[] = Array.isArray(j) ? j : Array.isArray((j as any)?.phones) ? (j as any).phones : [];
      for (const raw of arr) {
        const p = raw as Partial<Phone>;
        if (typeof p?.id !== 'string' || !ID_RE.test(p.id)) continue;
        this.map.set(p.id, {
          id: p.id,
          name: clean(p.name, 40) || PHONE_KIND_LABEL,
          url: clean(p.url, 200),
          lastSeen: Number(p.lastSeen) || 0,
          ts: Number(p.ts) || 0,
        });
      }
    } catch { /* chua co file */ }
  }

  /** Dang ky / cap nhat. `ts` (lan dang ky dau) duoc giu nguyen. */
  register(reg: PhoneReg, now = Date.now()): Phone {
    const old = this.map.get(reg.id);
    const p: Phone = {
      id: reg.id,
      name: clean(reg.name, 40) || PHONE_KIND_LABEL,
      url: clean(reg.url, 200),
      lastSeen: now,
      ts: old?.ts || now,
    };
    this.map.set(reg.id, p);
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
