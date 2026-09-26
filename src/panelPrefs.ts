// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) CAI DAT CUA ADDON THEO TUNG MAN HINH, chinh ngay tren panel (ung dung Cai dat: nhom "Màn hình" va
// "Khung ảnh"). Khac thuc the ESPHome (do HA luu), cac muc nay do server luu /data/rwv-panel-prefs.json. Chua dat ->
// theo tuy chon addon / mac dinh. Link album Google Photos dung chung moi man hinh (khoa "__global").
import fs from 'node:fs';
import path from 'node:path';
import { isAlbumUrl } from './photoFrame.js';

export interface PanelPrefs {
  saverPhotos?: boolean; morning?: boolean; saverIdleS?: number;
  photoIntervalS?: number; photoEffect?: PhotoEffect; photoFit?: 'cover' | 'frame'; photoOrder?: 'random' | 'name';
  photoClock?: boolean; photoInfo?: boolean; photoSource?: 'folder' | 'google' | 'both'; gphotosUrl?: string;
  /** (27/09/2026) Nhan truyen YouTube tu dien thoai (DIAL) + ten hien tren dien thoai. */
  cast?: boolean; castName?: string;
}
export type PhotoEffect = 'fade' | 'slide' | 'zoom' | 'none';
/** Gia tri mac dinh = tuy chon addon (dung khi man hinh chua chinh). */
export interface PanelDefaults { saverPhotos: boolean; morning: boolean; saverIdleS: number; cast?: boolean }
/** Muc hien tren trang Cai dat: id bat dau "rwv." de phan biet voi thuc the HA. sec: nhom tren trang. */
export interface PanelPrefItem {
  id: string; kind: 'switch' | 'select' | 'text'; label: string; hint: string; on: boolean; value: string;
  options?: string[]; maxLength?: number; group: 'panel'; sec: 'screen' | 'frame';
}
/** Tat ca thong so khung anh cua MOT man hinh (da ap mac dinh). */
export interface FrameSettings {
  intervalS: number; effect: PhotoEffect; fit: 'cover' | 'frame'; order: 'random' | 'name';
  clock: boolean; info: boolean; source: 'folder' | 'google' | 'both'; album: string;
}

type Choice<T> = [string, T];
export const IDLE_CHOICES: Choice<number>[] = [['Tắt', 0], ['1 phút', 60], ['2 phút', 120], ['5 phút', 300], ['10 phút', 600]];
const INTERVAL_CHOICES: Choice<number>[] = [['15 giây', 15], ['30 giây', 30], ['1 phút', 60], ['2 phút', 120], ['5 phút', 300]];
const EFFECT_CHOICES: Choice<PhotoEffect>[] = [['Mờ dần', 'fade'], ['Trượt', 'slide'], ['Thu phóng', 'zoom'], ['Không', 'none']];
const FIT_CHOICES: Choice<'cover' | 'frame'>[] = [['Lấp đầy', 'cover'], ['Vừa khung', 'frame']];
const ORDER_CHOICES: Choice<'random' | 'name'>[] = [['Ngẫu nhiên', 'random'], ['Theo thứ tự', 'name']];
const SOURCE_CHOICES: Choice<'folder' | 'google' | 'both'>[] = [['Thư mục', 'folder'], ['Google Photos', 'google'], ['Cả hai', 'both']];

const label = <T>(cs: Choice<T>[], v: T, fallback: string) => cs.find(([, x]) => x === v)?.[0] ?? fallback;
const value = <T>(cs: Choice<T>[], l: unknown): T | undefined => cs.find(([x]) => x === l)?.[1];

export class PanelPrefsStore {
  private all: Record<string, PanelPrefs> = {};
  constructor(private file: string | null) {
    if (!file) return;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') this.all = j; } catch { /* chua co */ }
  }
  get(dev: string): PanelPrefs { return this.all[dev] ?? {}; }
  private global(): PanelPrefs { return this.all.__global ?? {}; }

  /** Doi mot muc; tra ve false neu id khong phai muc cua addon / gia tri sai. */
  set(dev: string, id: string, v: unknown): boolean {
    let patch: PanelPrefs | null = null;
    let key = dev;
    const pick = <T>(cs: Choice<T>[], f: (x: T) => PanelPrefs) => { const x = value(cs, v); if (x !== undefined) patch = f(x); };
    switch (id) {
      case 'rwv.saver_photos': if (typeof v === 'boolean') patch = { saverPhotos: v }; break;
      case 'rwv.morning': if (typeof v === 'boolean') patch = { morning: v }; break;
      case 'rwv.photo_clock': if (typeof v === 'boolean') patch = { photoClock: v }; break;
      case 'rwv.photo_info': if (typeof v === 'boolean') patch = { photoInfo: v }; break;
      case 'rwv.cast': if (typeof v === 'boolean') patch = { cast: v }; break;
      case 'rwv.cast_name':
        if (typeof v === 'string' && v.trim().length <= 40) patch = { castName: v.replace(/[\u0000-\u001f<>&]/g, '').trim() };
        break;
      case 'rwv.saver_idle': pick(IDLE_CHOICES, (x) => ({ saverIdleS: x })); break;
      case 'rwv.photo_interval': pick(INTERVAL_CHOICES, (x) => ({ photoIntervalS: x })); break;
      case 'rwv.photo_effect': pick(EFFECT_CHOICES, (x) => ({ photoEffect: x })); break;
      case 'rwv.photo_fit': pick(FIT_CHOICES, (x) => ({ photoFit: x })); break;
      case 'rwv.photo_order': pick(ORDER_CHOICES, (x) => ({ photoOrder: x })); break;
      case 'rwv.photo_source': pick(SOURCE_CHOICES, (x) => ({ photoSource: x })); break;
      case 'rwv.gphotos_url':
        if (typeof v === 'string' && (v.trim() === '' || isAlbumUrl(v))) { patch = { gphotosUrl: v.trim() }; key = '__global'; }
        break;
    }
    if (!patch) return false;
    this.all[key] = { ...(this.all[key] ?? {}), ...(patch as PanelPrefs) };
    if (this.file) {
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.all)); } catch { /* bo qua */ }
    }
    return true;
  }
  saverPhotos(dev: string, addonDefault: boolean): boolean { return this.get(dev).saverPhotos ?? addonDefault; }
  morning(dev: string, addonDefault: boolean): boolean { return this.get(dev).morning ?? addonDefault; }
  saverIdleS(dev: string, addonDefault: number): number { return this.get(dev).saverIdleS ?? addonDefault; }
  albumUrl(envDefault = ''): string { return this.global().gphotosUrl ?? envDefault; }
  cast(dev: string, addonDefault: boolean): boolean { return this.get(dev).cast ?? addonDefault; }
  /** Ten panel hien trong nut truyen cua dien thoai. */
  castName(dev: string): string { return this.get(dev).castName || `Darboard ${dev.replace(/^esp32-/, '').slice(-4).toUpperCase()}`; }
  frame(dev: string, envAlbum = ''): FrameSettings {
    const p = this.get(dev);
    return {
      intervalS: p.photoIntervalS ?? 60, effect: p.photoEffect ?? 'fade', fit: p.photoFit ?? 'cover', order: p.photoOrder ?? 'random',
      clock: p.photoClock ?? true, info: p.photoInfo ?? true, source: p.photoSource ?? 'both', album: this.albumUrl(envAlbum),
    };
  }

  items(dev: string, d: PanelDefaults, envAlbum = ''): PanelPrefItem[] {
    const idle = this.saverIdleS(dev, d.saverIdleS);
    const f = this.frame(dev, envAlbum);
    const sel = <T>(id: string, sec: 'screen' | 'frame', lab: string, cs: Choice<T>[], v: T, fallback: string, hint = ''): PanelPrefItem => {
      const cur = label(cs, v, fallback), opts = cs.map(([l]) => l);
      return { id, kind: 'select', group: 'panel', sec, label: lab, hint, on: true, value: cur, options: opts.includes(cur) ? opts : [...opts, cur] };
    };
    const sw = (id: string, sec: 'screen' | 'frame', lab: string, on: boolean, hint: string): PanelPrefItem =>
      ({ id, kind: 'switch', group: 'panel', sec, label: lab, hint, on, value: '' });
    return [
      sel('rwv.saver_idle', 'screen', 'Hiện màn hình chờ sau', IDLE_CHOICES, idle, `${Math.round(idle / 60)} phút`),
      sw('rwv.saver_photos', 'screen', 'Màn hình chờ hiện ảnh', this.saverPhotos(dev, d.saverPhotos), 'Khung ảnh số · đêm chỉ đồng hồ'),
      sw('rwv.morning', 'screen', 'Chào buổi sáng', this.morning(dev, d.morning), 'Camera thấy người buổi sáng → mở “Hôm nay”'),
      sw('rwv.cast', 'screen', 'Nhận truyền YouTube', this.cast(dev, d.cast ?? true), 'Hiện trong nút truyền của app YouTube (cùng WiFi)'),
      { id: 'rwv.cast_name', kind: 'text', group: 'panel', sec: 'screen', label: 'Tên khi truyền', maxLength: 40, on: true,
        value: this.castName(dev), hint: '' },
      sel('rwv.photo_interval', 'frame', 'Đổi ảnh sau', INTERVAL_CHOICES, f.intervalS, `${f.intervalS} giây`),
      sel('rwv.photo_effect', 'frame', 'Hiệu ứng chuyển', EFFECT_CHOICES, f.effect, 'Mờ dần'),
      sel('rwv.photo_fit', 'frame', 'Kiểu hiển thị', FIT_CHOICES, f.fit, 'Lấp đầy', 'Vừa khung: giữ trọn ảnh, nền mờ'),
      sel('rwv.photo_order', 'frame', 'Thứ tự', ORDER_CHOICES, f.order, 'Ngẫu nhiên'),
      sel('rwv.photo_source', 'frame', 'Nguồn ảnh', SOURCE_CHOICES, f.source, 'Cả hai', 'Thư mục = media/photos của HA'),
      sw('rwv.photo_clock', 'frame', 'Hiện đồng hồ', f.clock, ''),
      sw('rwv.photo_info', 'frame', 'Hiện ngày chụp / album', f.info, ''),
      { id: 'rwv.gphotos_url', kind: 'text', group: 'panel', sec: 'frame', label: 'Album Google Photos', maxLength: 200, on: !!f.album,
        value: f.album, hint: f.album ? '' : 'Dán link chia sẻ album (photos.app.goo.gl/…) · dùng chung mọi màn hình' },
    ];
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const panelPrefs = new PanelPrefsStore(process.env.PANEL_PREFS_FILE || path.join(DATA_DIR, 'rwv-panel-prefs.json'));
