// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) CAI DAT CUA ADDON THEO TUNG MAN HINH, chinh ngay tren panel (ung dung Cai dat, nhom "Màn hình"). Khac
// thuc the ESPHome (do HA luu), cac muc nay do server luu /data/rwv-panel-prefs.json. Chua dat -> theo tuy chon addon.
import fs from 'node:fs';
import path from 'node:path';

export interface PanelPrefs { saverPhotos?: boolean }
/** Muc hien tren trang Cai dat: id bat dau "rwv." de phan biet voi thuc the HA. */
export interface PanelPrefItem { id: string; kind: 'switch'; label: string; hint: string; on: boolean; value: string; group: 'panel' }

export class PanelPrefsStore {
  private all: Record<string, PanelPrefs> = {};
  constructor(private file: string | null) {
    if (!file) return;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') this.all = j; } catch { /* chua co */ }
  }
  get(dev: string): PanelPrefs { return this.all[dev] ?? {}; }
  /** Doi mot muc; tra ve false neu id khong phai muc cua addon / gia tri sai. */
  set(dev: string, id: string, v: unknown): boolean {
    if (id !== 'rwv.saver_photos' || typeof v !== 'boolean') return false;
    this.all[dev] = { ...this.get(dev), saverPhotos: v };
    if (this.file) {
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.all)); } catch { /* bo qua */ }
    }
    return true;
  }
  saverPhotos(dev: string, addonDefault: boolean): boolean { return this.get(dev).saverPhotos ?? addonDefault; }
  items(dev: string, addonDefault: boolean): PanelPrefItem[] {
    return [{
      id: 'rwv.saver_photos', kind: 'switch', group: 'panel', value: '', label: 'Màn hình chờ hiện ảnh',
      hint: 'Ảnh trong media/photos · đêm chỉ đồng hồ', on: this.saverPhotos(dev, addonDefault),
    }];
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const panelPrefs = new PanelPrefsStore(process.env.PANEL_PREFS_FILE || path.join(DATA_DIR, 'rwv-panel-prefs.json'));
