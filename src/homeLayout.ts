// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026 OS-3) BO CUC MAN HINH CHINH do nguoi dung sap tren panel (cham giu -> keo tha, gop thanh thu muc).
// Luu THU TU (khong luu toa do): moi man hinh tu chia trang theo so cot/hang cua no, nen mot bo cuc dung chung cho
// ca 3 panel. Thuan (khong I/O) de thu don vi.

export interface HomeFolder { f: string; n: string; a: string[] }
export type HomeItem = string | HomeFolder;
export interface HomeLayout { dock: string[]; items: HomeItem[] }

export const DOCK_MAX = 5;
export const FOLDER_MAX = 16;
const ID_RE = /^[a-z0-9_-]{1,40}$/i;
const FOLDER_ID_RE = /^f_[a-z0-9]{1,12}$/i;
/** Dock mac dinh (chua sap): Home Assistant roi 4 ung dung hay dung. */
const DEFAULT_DOCK = ['home', 'cams', 'youtube', 'weather', 'radio'];

export const isFolder = (x: HomeItem): x is HomeFolder => typeof x === 'object' && x !== null;

function folderName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
  return s || 'Thư mục';
}

/** Kiem tra du lieu tu panel / file: chi giu cau truc hop le, bo trung lap. null = khong co bo cuc (dung mac dinh). */
export function sanitizeLayout(raw: unknown): HomeLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { dock?: unknown; items?: unknown };
  if (!Array.isArray(r.dock) || !Array.isArray(r.items)) return null;
  const seen = new Set<string>();
  const take = (id: unknown): string | null => {
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  };
  const dock: string[] = [];
  for (const id of r.dock.slice(0, 50)) {
    if (dock.length >= DOCK_MAX) break;
    const t = take(id);
    if (t) dock.push(t);
  }
  const items: HomeItem[] = [];
  const fids = new Set<string>();
  for (const it of r.items.slice(0, 300)) {
    if (typeof it === 'string') { const id = take(it); if (id) items.push(id); continue; }
    const f = it as Partial<HomeFolder> | null;
    if (!f || typeof f !== 'object' || typeof f.f !== 'string' || !FOLDER_ID_RE.test(f.f) || fids.has(f.f) || !Array.isArray(f.a)) continue;
    fids.add(f.f);
    const a = f.a.slice(0, FOLDER_MAX).map(take).filter((x): x is string => !!x);
    if (a.length) items.push({ f: f.f, n: folderName(f.n), a });
  }
  return { dock, items };
}

/**
 * Bo cuc DUNG DUOC cho danh sach ung dung hien tai (`appIds` theo thu tu Menu panel): bo id khong con (an/xoa),
 * them ung dung moi vao cuoi, thu muc con 1 ung dung thi thanh ung dung thuong, rong thi bo.
 */
export function resolveLayout(saved: HomeLayout | null, appIds: string[]): HomeLayout {
  const have = new Set(appIds);
  if (!saved) {
    const dock = DEFAULT_DOCK.filter((id) => have.has(id));
    return { dock, items: appIds.filter((id) => !dock.includes(id)) };
  }
  const used = new Set<string>();
  const keep = (id: string) => { if (!have.has(id) || used.has(id)) return false; used.add(id); return true; };
  const dock = saved.dock.filter(keep);
  const items: HomeItem[] = [];
  for (const it of saved.items) {
    if (!isFolder(it)) { if (keep(it)) items.push(it); continue; }
    const a = it.a.filter(keep);
    if (a.length >= 2) items.push({ f: it.f, n: it.n, a });
    else if (a.length === 1) items.push(a[0]);
  }
  for (const id of appIds) if (!used.has(id)) items.push(id);
  return { dock, items };
}
