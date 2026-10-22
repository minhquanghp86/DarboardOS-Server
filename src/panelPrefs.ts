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
  /** (13/10/2026) Tro giup YouTube tren tab dang hien: tu bo qua quang cao / YouTube TV tu vao che do khach (mac dinh bat). */
  ytSkipAds?: boolean; ytTvGuest?: boolean;
  /** (07/10/2026) Man hinh KHOA kieu dien thoai: vuot len de mo; do sang khi khoa (0 = giu nguyen); co dong ho; thoi
   *  tiet chi tiet. Xem src/shell/main.ts screensaver + deviceManager (locked). */
  lockMode?: boolean; lockBrightness?: number; clockSize?: ClockSize; wxDetail?: boolean;
  /** (08/10/2026) Widget tren man hinh khoa / cho (src/lockWidgets.ts): nang luong, lich sap toi, camera vua phat hien. */
  lwEnergy?: boolean; lwCal?: boolean; lwCam?: boolean;
  /** (21/10/2026) Chat luong JPEG nguoi dung dat (20..90). Khong co = de bo dieu tiet tu chon. */
  qualityPct?: number;
  /** (22/10/2026) Khoang "dem" theo gio dia phuong cua thiet bi: man hinh cho CHI hien dong ho, khong hien anh.
   *  from == to => tat che do dem (hien anh ca ngay). from > to => vat qua nua dem (vd 21 -> 6). */
  nightFrom?: number; nightTo?: number;
}
export type ClockSize = 'm' | 'l' | 'xl';
export type PhotoEffect = 'fade' | 'slide' | 'zoom' | 'none';
/** Gia tri mac dinh = tuy chon addon (dung khi man hinh chua chinh). */
export interface PanelDefaults { saverPhotos: boolean; morning: boolean; saverIdleS: number; cast?: boolean }
export type PrefSec = 'screen' | 'frame' | 'lock';
/** Muc hien tren trang Cai dat: id bat dau "rwv." de phan biet voi thuc the HA. sec: nhom tren trang. */
export interface PanelPrefItem {
  id: string; kind: 'switch' | 'select' | 'text'; label: string; hint: string; on: boolean; value: string;
  options?: string[]; maxLength?: number; group: 'panel'; sec: PrefSec;
  /** (08/10/2026) Cai dat kieu iOS (public/settings.html): muc lon + nhom con — xem settingsModel.SettingCat. */
  cat?: 'lock' | 'wall' | 'camera' | 'cast' | 'display'; sub?: string;
}
/** (08/10/2026) Cho tung muc cua addon trong ung dung Cai dat kieu iOS: [muc lon, nhom con]. */
const PLACE: Record<string, [NonNullable<PanelPrefItem['cat']>, string]> = {
  'rwv.lock': ['lock', 'Khóa'], 'rwv.saver_idle': ['lock', 'Khóa'], 'rwv.lock_bright': ['lock', 'Khóa'],
  'rwv.clock_size': ['lock', 'Hiển thị'], 'rwv.wx_detail': ['lock', 'Hiển thị'],
  'rwv.lw_energy': ['lock', 'Widget'], 'rwv.lw_cal': ['lock', 'Widget'], 'rwv.lw_cam': ['lock', 'Widget'],
  'rwv.saver_photos': ['wall', 'Ảnh nền màn hình khóa'], 'rwv.photo_interval': ['wall', 'Ảnh nền màn hình khóa'],
  'rwv.night_from': ['wall', 'Ảnh nền màn hình khóa'], 'rwv.night_to': ['wall', 'Ảnh nền màn hình khóa'],
  'rwv.quality': ['display', 'Hình ảnh'],
  'rwv.photo_effect': ['wall', 'Trình chiếu'], 'rwv.photo_fit': ['wall', 'Trình chiếu'], 'rwv.photo_order': ['wall', 'Trình chiếu'],
  'rwv.photo_source': ['wall', 'Nguồn ảnh'], 'rwv.gphotos_url': ['wall', 'Nguồn ảnh'],
  'rwv.photo_clock': ['wall', 'Trên ảnh'], 'rwv.photo_info': ['wall', 'Trên ảnh'],
  'rwv.morning': ['camera', 'Khi thấy người'], 'rwv.cast': ['cast', 'YouTube'], 'rwv.cast_name': ['cast', 'YouTube'],
  'rwv.yt_skip_ads': ['cast', 'YouTube'], 'rwv.yttv_guest': ['cast', 'YouTube'],
};
/** Tat ca thong so khung anh cua MOT man hinh (da ap mac dinh). */
export interface FrameSettings {
  intervalS: number; effect: PhotoEffect; fit: 'cover' | 'frame'; order: 'random' | 'name';
  clock: boolean; info: boolean; source: 'folder' | 'google' | 'both'; album: string;
}

type Choice<T> = [string, T];
export const IDLE_CHOICES: Choice<number>[] = [['Tắt', 0], ['30 giây', 30], ['1 phút', 60], ['2 phút', 120], ['5 phút', 300], ['10 phút', 600],
  ['15 phút', 900], ['30 phút', 1800]];
const BRIGHT_CHOICES: Choice<number>[] = [['Giữ nguyên', 0], ['5%', 5], ['10%', 10], ['20%', 20], ['30%', 30], ['50%', 50]];
const QUALITY_CHOICES: Choice<number>[] = [['Tự động', 0], ['20%', 20], ['30%', 30], ['40%', 40], ['50%', 50], ['60%', 60], ['70%', 70], ['80%', 80], ['90%', 90]];
const NIGHT_CHOICES: Choice<number>[] = Array.from({ length: 25 }, (_, i) => (i === 24 ? ['Cả ngày (tắt đêm)', 24] : [`${String(i).padStart(2, '0')}:00`, i]) as Choice<number>);
const CLOCK_CHOICES: Choice<ClockSize>[] = [['Vừa', 'm'], ['Lớn', 'l'], ['Rất lớn', 'xl']];
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
      case 'rwv.yt_skip_ads': if (typeof v === 'boolean') patch = { ytSkipAds: v }; break;
      case 'rwv.yttv_guest': if (typeof v === 'boolean') patch = { ytTvGuest: v }; break;
      case 'rwv.lock': if (typeof v === 'boolean') patch = { lockMode: v }; break;
      case 'rwv.wx_detail': if (typeof v === 'boolean') patch = { wxDetail: v }; break;
      case 'rwv.lw_energy': if (typeof v === 'boolean') patch = { lwEnergy: v }; break;
      case 'rwv.lw_cal': if (typeof v === 'boolean') patch = { lwCal: v }; break;
      case 'rwv.lw_cam': if (typeof v === 'boolean') patch = { lwCam: v }; break;
      case 'rwv.lock_bright': pick(BRIGHT_CHOICES, (x) => ({ lockBrightness: x })); break;
      case 'rwv.quality': {
        // UI gui NHAN ("60%", "Tự động"); API gui so. Chap nhan ca hai.
        if (typeof v === 'number' && Number.isFinite(v)) {
          const n = Math.round(v);
          if (n >= 0 && n <= 90) patch = { qualityPct: n };   // 0 = tự động
        } else {
          pick(QUALITY_CHOICES, (x) => ({ qualityPct: x }));
        }
        break;
      }
      case 'rwv.clock_size': pick(CLOCK_CHOICES, (x) => ({ clockSize: x })); break;
      case 'rwv.cast_name':
        if (typeof v === 'string' && v.trim().length <= 40) patch = { castName: v.replace(/[\u0000-\u001f<>&]/g, '').trim() };
        break;
      case 'rwv.saver_idle': pick(IDLE_CHOICES, (x) => ({ saverIdleS: x })); break;
      case 'rwv.night_from': pick(NIGHT_CHOICES, (x) => ({ nightFrom: x })); break;
      case 'rwv.night_to': pick(NIGHT_CHOICES, (x) => ({ nightTo: x })); break;
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
  /** (22/10/2026) Khoang dem cua man hinh (gio dia phuong). 24 = tat che do dem. Mac dinh 22 -> 6. */
  night(dev: string): { from: number; to: number } {
    const p = this.get(dev);
    return { from: p.nightFrom ?? 22, to: p.nightTo ?? 6 };
  }
  lockMode(dev: string): boolean { return this.get(dev).lockMode ?? false; }
  /** (21/10/2026) Chat luong JPEG nguoi dung dat; undefined = de bo dieu tiet tu chon. */
  qualityPct(dev: string): number | undefined { return this.get(dev).qualityPct; }
  /** % do sang khi khoa / man hinh cho; 0 = giu nguyen. */
  lockBrightness(dev: string): number { return this.get(dev).lockBrightness ?? 0; }
  clockSize(dev: string): ClockSize { return this.get(dev).clockSize ?? 'l'; }
  wxDetail(dev: string): boolean { return this.get(dev).wxDetail ?? true; }
  /** (08/10/2026) Widget man hinh khoa nao dang bat (mac dinh: ca ba — khong co so lieu thi tu an). */
  lockWidgets(dev: string): { en: boolean; cal: boolean; cam: boolean } {
    const p = this.get(dev);
    return { en: p.lwEnergy ?? true, cal: p.lwCal ?? true, cam: p.lwCam ?? true };
  }
  albumUrl(envDefault = ''): string { return this.global().gphotosUrl ?? envDefault; }
  cast(dev: string, addonDefault: boolean): boolean { return this.get(dev).cast ?? addonDefault; }
  ytSkipAds(dev: string): boolean { return this.get(dev).ytSkipAds ?? true; }
  ytTvGuest(dev: string): boolean { return this.get(dev).ytTvGuest ?? true; }
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
    const sel = <T>(id: string, sec: PrefSec, lab: string, cs: Choice<T>[], v: T, fallback: string, hint = ''): PanelPrefItem => {
      const cur = label(cs, v, fallback), opts = cs.map(([l]) => l);
      return { id, kind: 'select', group: 'panel', sec, label: lab, hint, on: true, value: cur, options: opts.includes(cur) ? opts : [...opts, cur] };
    };
    const sw = (id: string, sec: PrefSec, lab: string, on: boolean, hint: string): PanelPrefItem =>
      ({ id, kind: 'switch', group: 'panel', sec, label: lab, hint, on, value: '' });
    const list: PanelPrefItem[] = [
      // (21/10/2026) Chat luong anh gui tu server — dat dau danh sach (truoc nhom man hinh / do sang).
      sel('rwv.quality', 'screen', 'Chất lượng hình ảnh', QUALITY_CHOICES, this.qualityPct(dev) ?? 0, 'Tự động',
        'Tự động = server tự cân theo mạng và thời gian giải mã; đặt % để cố định (cao hơn = nét hơn, tốn băng thông)'),
      // (07/10/2026) Nhom "Màn hình khóa": gom moi thu cua man hinh cho / khoa (thoi gian, do sang, dong ho, thoi tiet, anh).
      sw('rwv.lock', 'lock', 'Khóa màn hình', this.lockMode(dev), 'Vuốt lên để mở · chạm nhầm không mở'),
      sel('rwv.saver_idle', 'lock', 'Khóa / màn hình chờ sau', IDLE_CHOICES, idle, idle < 60 ? `${idle} giây` : `${Math.round(idle / 60)} phút`),
      sel('rwv.lock_bright', 'lock', 'Độ sáng khi khóa', BRIGHT_CHOICES, this.lockBrightness(dev), `${this.lockBrightness(dev)}%`,
        'Mở khóa / chạm vào thì sáng lại'),
      sel('rwv.clock_size', 'lock', 'Cỡ đồng hồ', CLOCK_CHOICES, this.clockSize(dev), 'Lớn'),
      sw('rwv.wx_detail', 'lock', 'Thời tiết chi tiết', this.wxDetail(dev), 'Cảm giác, độ ẩm, gió, mưa, không khí, giờ tới'),
      // (08/10/2026) Widget: khong co so lieu (chua chon cam bien / khong co lich / khong co Frigate) thi tu an.
      sw('rwv.lw_energy', 'lock', 'Năng lượng', this.lockWidgets(dev).en, 'Mặt trời, pin, tiêu thụ · chọn cảm biến ở trang Darboard → Màn khóa'),
      sw('rwv.lw_cal', 'lock', 'Lịch sắp tới', this.lockWidgets(dev).cal, 'Sự kiện 3 ngày tới từ lịch Home Assistant'),
      sw('rwv.lw_cam', 'lock', 'Camera phát hiện', this.lockWidgets(dev).cam, 'Lần Frigate thấy người / xe gần nhất trong 1 giờ'),
      sw('rwv.saver_photos', 'lock', 'Hiện ảnh nền', this.saverPhotos(dev, d.saverPhotos), 'Khung ảnh số · đêm chỉ đồng hồ'),
      // (22/10/2026) Khoang dem: trong khoang nay man hinh cho CHI hien dong ho (khong anh). Tat = hien ca ngay.
      sel('rwv.night_from', 'lock', 'Đêm: tắt ảnh từ', NIGHT_CHOICES, this.night(dev).from, this.night(dev).from === 24 ? 'Cả ngày (tắt đêm)' : `${String(this.night(dev).from).padStart(2, '0')}:00`),
      sel('rwv.night_to', 'lock', 'Đêm: tắt ảnh đến', NIGHT_CHOICES, this.night(dev).to, this.night(dev).to === 24 ? 'Cả ngày (tắt đêm)' : `${String(this.night(dev).to).padStart(2, '0')}:00`,
        'Trong khoảng này màn hình chờ chỉ hiện đồng hồ (ban đêm) · chọn “Cả ngày” để luôn có ảnh'),
      sel('rwv.photo_interval', 'lock', 'Đổi ảnh sau', INTERVAL_CHOICES, f.intervalS, `${f.intervalS} giây`),
      sw('rwv.morning', 'screen', 'Chào buổi sáng', this.morning(dev, d.morning), 'Camera thấy người buổi sáng → mở “Hôm nay”'),
      sw('rwv.cast', 'screen', 'Nhận truyền YouTube', this.cast(dev, d.cast ?? true), 'Hiện trong nút truyền của app YouTube (cùng WiFi)'),
      sw('rwv.yt_skip_ads', 'screen', 'Tự bỏ qua quảng cáo YouTube', this.ytSkipAds(dev), 'Bấm “Bỏ qua” / tua hết quảng cáo video'),
      sw('rwv.yttv_guest', 'screen', 'YouTube TV: chế độ khách', this.ytTvGuest(dev), 'Tự chọn “Xem ở chế độ khách” khi hỏi tài khoản'),
      { id: 'rwv.cast_name', kind: 'text', group: 'panel', sec: 'screen', label: 'Tên khi truyền', maxLength: 40, on: true,
        value: this.castName(dev), hint: '' },
      sel('rwv.photo_effect', 'frame', 'Hiệu ứng chuyển', EFFECT_CHOICES, f.effect, 'Mờ dần'),
      sel('rwv.photo_fit', 'frame', 'Kiểu hiển thị', FIT_CHOICES, f.fit, 'Lấp đầy', 'Vừa khung: giữ trọn ảnh, nền mờ'),
      sel('rwv.photo_order', 'frame', 'Thứ tự', ORDER_CHOICES, f.order, 'Ngẫu nhiên'),
      sel('rwv.photo_source', 'frame', 'Nguồn ảnh', SOURCE_CHOICES, f.source, 'Cả hai', 'Thư mục = media/photos của HA'),
      sw('rwv.photo_clock', 'frame', 'Hiện đồng hồ', f.clock, ''),
      sw('rwv.photo_info', 'frame', 'Hiện ngày chụp / album', f.info, ''),
      { id: 'rwv.gphotos_url', kind: 'text', group: 'panel', sec: 'frame', label: 'Album Google Photos', maxLength: 200, on: !!f.album,
        value: f.album, hint: f.album ? '' : 'Dán link chia sẻ album (photos.app.goo.gl/…) · dùng chung mọi màn hình' },
    ];
    return list.map((i) => (PLACE[i.id] ? { ...i, cat: PLACE[i.id][0], sub: PLACE[i.id][1] } : i));
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const panelPrefs = new PanelPrefsStore(process.env.PANEL_PREFS_FILE || path.join(DATA_DIR, 'rwv-panel-prefs.json'));
