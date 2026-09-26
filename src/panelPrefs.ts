// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) CAI DAT CUA ADDON THEO TUNG MAN HINH, chinh ngay tren panel (ung dung Cai dat, nhom "Màn hình"). Khac
// thuc the ESPHome (do HA luu), cac muc nay do server luu /data/rwv-panel-prefs.json. Chua dat -> theo tuy chon addon.
import fs from 'node:fs';
import path from 'node:path';

export interface PanelPrefs { saverPhotos?: boolean; morning?: boolean; saverIdleS?: number }
/** Gia tri mac dinh = tuy chon addon (dung khi man hinh chua chinh). */
export interface PanelDefaults { saverPhotos: boolean; morning: boolean; saverIdleS: number }
/** Muc hien tren trang Cai dat: id bat dau "rwv." de phan biet voi thuc the HA. */
export interface PanelPrefItem {
  id: string; kind: 'switch' | 'select'; label: string; hint: string; on: boolean; value: string; options?: string[]; group: 'panel';
}

/** Lua chon "Hien man hinh cho sau" (giay). */
export const IDLE_CHOICES: [string, number][] = [['Tắt', 0], ['1 phút', 60], ['2 phút', 120], ['5 phút', 300], ['10 phút', 600]];
const idleLabel = (s: number) => IDLE_CHOICES.find(([, v]) => v === s)?.[0] ?? `${Math.round(s / 60)} phút`;

export class PanelPrefsStore {
  private all: Record<string, PanelPrefs> = {};
  constructor(private file: string | null) {
    if (!file) return;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') this.all = j; } catch { /* chua co */ }
  }
  get(dev: string): PanelPrefs { return this.all[dev] ?? {}; }
  /** Doi mot muc; tra ve false neu id khong phai muc cua addon / gia tri sai. */
  set(dev: string, id: string, v: unknown): boolean {
    let patch: PanelPrefs | null = null;
    if (id === 'rwv.saver_photos' && typeof v === 'boolean') patch = { saverPhotos: v };
    if (id === 'rwv.morning' && typeof v === 'boolean') patch = { morning: v };
    if (id === 'rwv.saver_idle') { const c = IDLE_CHOICES.find(([l]) => l === v); if (c) patch = { saverIdleS: c[1] }; }
    if (!patch) return false;
    this.all[dev] = { ...this.get(dev), ...patch };
    if (this.file) {
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.all)); } catch { /* bo qua */ }
    }
    return true;
  }
  saverPhotos(dev: string, addonDefault: boolean): boolean { return this.get(dev).saverPhotos ?? addonDefault; }
  morning(dev: string, addonDefault: boolean): boolean { return this.get(dev).morning ?? addonDefault; }
  saverIdleS(dev: string, addonDefault: number): number { return this.get(dev).saverIdleS ?? addonDefault; }
  items(dev: string, d: PanelDefaults): PanelPrefItem[] {
    const idle = this.saverIdleS(dev, d.saverIdleS);
    const opts = IDLE_CHOICES.map(([l]) => l);
    const cur = idleLabel(idle);
    return [
      { id: 'rwv.saver_idle', kind: 'select', group: 'panel', label: 'Hiện màn hình chờ sau', hint: '', on: idle > 0,
        value: cur, options: opts.includes(cur) ? opts : [...opts, cur] },
      { id: 'rwv.saver_photos', kind: 'switch', group: 'panel', value: '', label: 'Màn hình chờ hiện ảnh',
        hint: 'Ảnh trong media/photos · đêm chỉ đồng hồ', on: this.saverPhotos(dev, d.saverPhotos) },
      { id: 'rwv.morning', kind: 'switch', group: 'panel', value: '', label: 'Chào buổi sáng',
        hint: 'Camera thấy người buổi sáng → mở “Hôm nay”', on: this.morning(dev, d.morning) },
    ];
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const panelPrefs = new PanelPrefsStore(process.env.PANEL_PREFS_FILE || path.join(DATA_DIR, 'rwv-panel-prefs.json'));
