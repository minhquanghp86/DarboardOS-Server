// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-4) CAI DAT TREN PANEL — phan THUAN (khong mang): tu so dang ky thiet bi/thuc the + trang thai cua Home
// Assistant, dung danh sach cai dat cua MOT man hinh, va kiem tra/chuyen mot thao tac cua nguoi dung thanh loi goi
// dich vu HA. Khong viet cung ten thuc the nao: thiet bi ESPHome duoc tim theo dia chi MAC (nam san trong id
// "esp32-<mac>" ma firmware gui len), roi lay MOI thuc the cua thiet bi do — cung ma chay cho ca P4 lan hai S3.

export type SettingKind = 'switch' | 'light' | 'number' | 'select' | 'text' | 'button' | 'value';
// (01/10/2026) 'stream' = muc "Luong camera" (tieng luong Frigate / tieng khi quay video — firmware P4 fw-2026.10.01f).
export type SettingGroup = 'control' | 'config' | 'diag' | 'stream';
const STREAM_LABEL = /^Tiếng (luồng camera|khi quay video)$/i;

export interface HaDevice { id: string; name?: string | null; name_by_user?: string | null; connections?: [string, string][];
  config_entries?: string[];
  model?: string | null; sw_version?: string | null; manufacturer?: string | null; }
export interface HaEntity { entity_id: string; device_id?: string | null; entity_category?: string | null;
  disabled_by?: string | null; hidden_by?: string | null; }
export interface HaState { entity_id: string; state: string; attributes?: Record<string, any>; }

export interface SettingItem {
  id: string;
  kind: SettingKind;
  group: SettingGroup;
  label: string;
  value: string;
  /** (01/10/2026) Dong goi y duoi nhan (Cai dat). */
  hint?: string;
  unit?: string;
  on?: boolean;
  /** light: do sang 0..100 */
  bri?: number;
  min?: number; max?: number; step?: number;
  options?: string[];
  maxLength?: number;
  unavailable?: boolean;
  /** Nut can hoi lai truoc khi bam (khoi dong lai...). */
  confirm?: boolean;
  /** (08/10/2026) Cai dat kieu iOS: muc lon (cat), nhom con (sub), ten hien de hieu (title), thu tu trong nhom (ord);
   *  hide = trung voi muc khac (vd "Ảnh màn hình chờ" cua firmware da dong bo voi cai dat addon "Hiện ảnh nền"). */
  cat?: SettingCat; sub?: string; title?: string; ord?: number; hide?: boolean;
}

/** (08/10/2026) Muc lon cua ung dung Cai dat (public/settings.html giu ten / icon / mau / thu tu). */
export type SettingCat = 'net' | 'sound' | 'display' | 'lock' | 'wall' | 'voice' | 'camera' | 'cast' | 'home' | 'battery' | 'about' | 'diag' | 'other';
interface PlaceRule { re: RegExp; cat: SettingCat; sub: string; title?: string; hint?: string; ord?: number; hide?: true }
/**
 * Xep muc theo entity_id (khong theo nhan — nhan do nguoi dung / firmware dat, co ban khong dau). Luat DAU TIEN khop
 * thang ("_anh_man_hinh_cho" phai dung truoc "_man_hinh_cho"). title co the chua $1 (nhom bat cua re).
 */
const PLACE: PlaceRule[] = [
  { re: /_(wifi_ket_noi|ssid)$/, cat: 'net', sub: 'Wi-Fi', title: 'Mạng đang kết nối', ord: 0 },
  { re: /_wifi_signal$/, cat: 'net', sub: 'Wi-Fi', title: 'Cường độ sóng', ord: 1 },
  { re: /^sensor\..*_(ip|ip_address)$/, cat: 'net', sub: 'Wi-Fi', title: 'Địa chỉ IP', ord: 2 },
  { re: /^sensor\..*_(mac_esp|mac|mac_address)$/, cat: 'net', sub: 'Wi-Fi', title: 'Địa chỉ MAC', ord: 3 },
  // (08/10/2026) Firmware doi Wi-Fi tu Cai dat: BSSID / DNS; danh sach mang quanh day + ket qua lan doi mang (trang Wi-Fi
  // dung rieng, khong hien thanh dong); ten node ESPHome (server tim dich vu esphome.<ten>_wifi_*).
  { re: /^sensor\..*_bssid$/, cat: 'net', sub: 'Wi-Fi', title: 'BSSID (điểm phát)', ord: 4 },
  { re: /^sensor\..*_dns$/, cat: 'net', sub: 'Wi-Fi', title: 'DNS', ord: 5 },
  { re: /^sensor\..*_mang_wi_fi_xung_quanh$/, cat: 'net', sub: 'Wi-Fi', title: 'Mạng Wi-Fi xung quanh', hide: true },
  { re: /^sensor\..*_doi_wi_fi$/, cat: 'net', sub: 'Wi-Fi', title: 'Đổi Wi-Fi', hide: true },
  // (08/10/2026) Chan doan lien ket (firmware P4 >= client d0c983a): kenh / chuan PHY / RSSI / cong suat phat; danh sach
  // diem phat theo kenh (dai, an — de chan doan nhieu cung kenh).
  { re: /^sensor\..*_lien_ket_wi_fi$/, cat: 'net', sub: 'Wi-Fi', title: 'Kênh & chuẩn kết nối', ord: 6 },
  { re: /^sensor\..*_kenh_wi_fi_xung_quanh$/, cat: 'net', sub: 'Wi-Fi', title: 'Kênh Wi-Fi xung quanh', hide: true },
  // (09/10/2026) Chon mang Cap / Wi-Fi: trang Wi-Fi & Mang ve rieng khoi "Kết nối" (an dong chung); IP cong cap o Chi tiet.
  { re: /^select\..*_mang_su_dung$/, cat: 'net', sub: 'Wi-Fi', title: 'Mạng sử dụng', hide: true },
  { re: /^sensor\..*_ket_noi_mang$/, cat: 'net', sub: 'Wi-Fi', title: 'Kết nối mạng', hide: true },
  { re: /^sensor\..*_ip_mang_day$/, cat: 'net', sub: 'Wi-Fi', title: 'IP mạng dây', ord: 3 },
  { re: /^sensor\..*_ten_esphome$/, cat: 'about', sub: 'Thiết bị', title: 'Tên ESPHome' },
  // (08/10/2026) Trang thai mat khau luong camera ("Bật · <ten>" / "Tắt" — KHONG co mat khau); trang Cai dat mo trang doi.
  { re: /^sensor\..*_mat_khau_luong_camera$/, cat: 'camera', sub: 'Bảo mật luồng camera', title: 'Mật khẩu luồng camera' },
  { re: /^sensor\..*_thoi_gian_chay$/, cat: 'diag', sub: 'Hiệu năng', title: 'Thời gian chạy', ord: 2 },
  { re: /_ha_darboard_server$/, cat: 'net', sub: 'Máy chủ Darboard', title: 'Địa chỉ máy chủ', ord: 0 },
  { re: /_ws_connected$/, cat: 'net', sub: 'Máy chủ Darboard', title: 'Kết nối', ord: 1 },
  { re: /_toc_do_tai_tcp$/, cat: 'net', sub: 'Đo tốc độ', title: 'Tốc độ tải lần đo gần nhất', ord: 0 },
  { re: /_do_toc_do_mang$/, cat: 'net', sub: 'Đo tốc độ', title: 'Đo tốc độ mạng', ord: 1 },
  { re: /_(audio_amplifier|amplifier)$/, cat: 'sound', sub: 'Loa', title: 'Bộ khuếch đại loa' },
  { re: /^number\..*_am_luong(_video_web|_media)?$/, cat: 'sound', sub: 'Âm lượng', title: 'Âm lượng' },
  { re: /^light\./, cat: 'display', sub: 'Độ sáng', title: 'Đèn nền' },
  { re: /^switch\..*_anh_man_hinh_cho$/, cat: 'wall', sub: 'Ảnh nền màn hình khóa', title: 'Ảnh màn hình chờ', hide: true },
  { re: /^switch\..*(_man_hinh_cho|_no_sleep)$/, cat: 'display', sub: 'Tự tắt màn hình', title: 'Luôn sáng (màn hình chờ)',
    hint: 'Bật: không tắt đèn nền — rảnh thì hiện màn hình khóa / chờ', ord: 0 },
  { re: /_sleep_time$/, cat: 'display', sub: 'Tự tắt màn hình', title: 'Tắt màn hình sau', hint: 'Khi không bật “Luôn sáng”', ord: 1 },
  { re: /_(xoay_man_hinh|rotation)$/, cat: 'display', sub: 'Hướng màn hình', title: 'Xoay màn hình' },
  { re: /^select\..*_assistant$/, cat: 'voice', sub: 'Trợ lý', title: 'Trợ lý chính', ord: 0 },
  { re: /^select\..*_assistant_2$/, cat: 'voice', sub: 'Trợ lý', title: 'Trợ lý thứ hai', ord: 1 },
  { re: /_tu_danh_thuc$/, cat: 'voice', sub: 'Đánh thức', title: 'Từ đánh thức', ord: 0 },
  { re: /_wake_word$/, cat: 'voice', sub: 'Đánh thức', title: 'Từ khoá trợ lý chính', ord: 1 },
  { re: /_wake_word_2$/, cat: 'voice', sub: 'Đánh thức', title: 'Từ khoá trợ lý thứ hai', ord: 2 },
  { re: /_(finished_speaking_detection|phat_hien_noi_xong)$/, cat: 'voice', sub: 'Nghe', title: 'Phát hiện nói xong' },
  { re: /_(khu_vong_mic_aec|aec)$/, cat: 'voice', sub: 'Micro', title: 'Khử vọng (AEC)', hint: 'Lọc tiếng loa khỏi micro khi trợ lý đang nghe' },
  { re: /_nguon_phat_hien_nguoi$/, cat: 'camera', sub: 'Phát hiện người', title: 'Nguồn phát hiện', ord: 0 },
  { re: /_do_nhay_chuyen_dong$/, cat: 'camera', sub: 'Phát hiện người', title: 'Độ nhạy chuyển động', ord: 1 },
  { re: /_nguong_nhan_dien_khuon_mat$/, cat: 'camera', sub: 'Phát hiện người', title: 'Ngưỡng nhận diện khuôn mặt', ord: 2 },
  { re: /^binary_sensor\..*_chuyen_dong$/, cat: 'camera', sub: 'Trạng thái', title: 'Chuyển động', ord: 0 },
  { re: /^binary_sensor\..*_person$/, cat: 'camera', sub: 'Trạng thái', title: 'Có người', ord: 1 },
  { re: /_tieng_luong_camera$/, cat: 'camera', sub: 'Âm thanh camera', title: 'Tiếng trong luồng camera', ord: 0 },
  { re: /_tieng_khi_quay_video$/, cat: 'camera', sub: 'Âm thanh camera', title: 'Tiếng khi quay video', ord: 1 },
  { re: /_home_url$/, cat: 'home', sub: 'Trang chủ', title: 'Địa chỉ trang chủ', ord: 0 },
  { re: /^text\..*_url_hien_thi$/, cat: 'home', sub: 'Trang chủ', title: 'Trang đang hiển thị', ord: 1 },
  { re: /_go_home$/, cat: 'home', sub: 'Trang chủ', title: 'Về trang chủ', ord: 2 },
  { re: /_battery_(percent|level)$/, cat: 'battery', sub: 'Pin', title: 'Mức pin', ord: 0 },
  { re: /_battery_voltage$/, cat: 'battery', sub: 'Pin', title: 'Điện áp pin', ord: 1 },
  { re: /_co_pin$/, cat: 'battery', sub: 'Pin', title: 'Có gắn pin', ord: 2 },
  { re: /^button\..*(_khoi_dong_lai|_restart)$/, cat: 'about', sub: 'Thiết bị', title: 'Khởi động lại' },
  { re: /_heap_free$/, cat: 'diag', sub: 'Bộ nhớ', title: 'RAM trống', ord: 0 },
  { re: /_heap_free_nho_nhat$/, cat: 'diag', sub: 'Bộ nhớ', title: 'RAM trống thấp nhất', ord: 1 },
  { re: /_heap_block_lon_nhat$/, cat: 'diag', sub: 'Bộ nhớ', title: 'Khối RAM lớn nhất', ord: 2 },
  { re: /_heap_phan_manh$/, cat: 'diag', sub: 'Bộ nhớ', title: 'Phân mảnh RAM', ord: 3 },
  { re: /_psram_free$/, cat: 'diag', sub: 'Bộ nhớ', title: 'PSRAM trống', ord: 4 },
  { re: /_loop_time$/, cat: 'diag', sub: 'Hiệu năng', title: 'Thời gian vòng lặp', ord: 0 },
  { re: /_tai_loi_(\d)$/, cat: 'diag', sub: 'Hiệu năng', title: 'Tải lõi $1', ord: 1 },
  { re: /_frame_update$/, cat: 'diag', sub: 'Hiệu năng', title: 'Đang nhận khung hình', ord: 3 },
  { re: /_video_dang_chay$/, cat: 'diag', sub: 'Hiệu năng', title: 'Video đang chạy', ord: 4 },
  { re: /_do_tai_cpu$/, cat: 'diag', sub: 'Hiệu năng', title: 'Đo tải CPU', ord: 9 },
  { re: /_ws_watchdog_restart$/, cat: 'diag', sub: 'Kết nối', title: 'Số lần tự nối lại', ord: 0 },
  { re: /_ws_watchdog_ly_do$/, cat: 'diag', sub: 'Kết nối', title: 'Lý do nối lại gần nhất', ord: 1 },
  { re: /_url_hien_tai$/, cat: 'diag', sub: 'Kết nối', title: 'Trang hiện tại', ord: 2 },
];

/** Gan muc lon / nhom con / ten de hieu cho MOT muc (khong khop luat nao: theo group cua HA). */
export function placeSetting(it: SettingItem): SettingItem {
  for (const r of PLACE) {
    const m = r.re.exec(it.id);
    if (!m) continue;
    const out: SettingItem = { ...it, cat: r.cat, sub: r.sub };
    if (r.title) out.title = r.title.replace('$1', m[1] ?? '');
    if (r.hint && !it.hint) out.hint = r.hint;
    if (r.ord != null) out.ord = r.ord;
    if (r.hide) out.hide = true;
    return out;
  }
  if (it.group === 'stream') return { ...it, cat: 'camera', sub: 'Âm thanh camera' };
  if (it.group === 'diag') return { ...it, cat: 'diag', sub: 'Khác' };
  return { ...it, cat: 'other', sub: it.group === 'config' ? 'Cấu hình' : 'Điều khiển' };
}

export interface SettingsView {
  device: { name: string; model?: string; version?: string };
  items: SettingItem[];
}

/** "esp32-0a0b0c0d0002" -> "0a0b0c0d0002" (MAC 12 hex, khong dau). null neu id khong theo mau firmware. */
export function macFromDeviceId(id: string): string | null {
  const m = /^esp32-([0-9a-f]{12})$/i.exec(id.trim());
  return m ? m[1].toLowerCase() : null;
}

const normMac = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, '');

export function findDeviceByMac(devices: HaDevice[], mac: string): HaDevice | undefined {
  return devices.find((d) => (d.connections ?? []).some(([t, v]) => t === 'mac' && normMac(v) === mac));
}

// Thu tu hien thi trong moi nhom.
const ORDER: Record<SettingKind, number> = { light: 0, switch: 1, number: 2, select: 3, text: 4, button: 5, value: 6 };
// Khong bao gio dua ra panel: xoa sach cau hinh thiet bi.
const DANGEROUS = /factory|khoi_phuc_cai_dat|factory_reset/i;

function kindOf(domain: string): SettingKind | null {
  switch (domain) {
    case 'switch': case 'light': case 'number': case 'select': case 'text': case 'button': return domain;
    case 'sensor': case 'binary_sensor': return 'value';
    default: return null;  // update, camera, media_player... khong phai cai dat
  }
}

/** Ten hien thi: friendly_name bo tien to ten thiet bi (HA dat "<ten thiet bi> <ten thuc the>"). */
function labelOf(st: HaState | undefined, entityId: string, deviceName: string): string {
  const fn = String(st?.attributes?.friendly_name ?? entityId.split('.')[1]);
  const p = deviceName.trim();
  return p && fn.startsWith(p + ' ') ? fn.slice(p.length + 1) : fn;
}

export function buildSettingsView(dev: HaDevice, entities: HaEntity[], states: Map<string, HaState>): SettingsView {
  const deviceName = dev.name_by_user || dev.name || '';
  const items: SettingItem[] = [];
  for (const e of entities) {
    if (e.device_id !== dev.id || e.disabled_by || e.hidden_by) continue;
    const domain = e.entity_id.split('.')[0];
    const kind = kindOf(domain);
    if (!kind || DANGEROUS.test(e.entity_id)) continue;
    const st = states.get(e.entity_id);
    const a = st?.attributes ?? {};
    const label = labelOf(st, e.entity_id, deviceName);
    if (DANGEROUS.test(label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'))) continue;
    const group: SettingGroup = STREAM_LABEL.test(label) ? 'stream'
      : e.entity_category === 'diagnostic' ? 'diag' : e.entity_category === 'config' ? 'config'
      : kind === 'value' ? 'diag' : 'control';

    const state = st?.state ?? 'unavailable';
    const it: SettingItem = { id: e.entity_id, kind, group, label, value: state,
      unavailable: state === 'unavailable' || state === 'unknown' && kind !== 'value' && kind !== 'button' };
    if (a.unit_of_measurement) it.unit = String(a.unit_of_measurement);
    if (kind === 'switch' || kind === 'light') it.on = state === 'on';
    if (kind === 'light') it.bri = typeof a.brightness === 'number' ? Math.round(a.brightness / 2.55) : it.on ? 100 : 0;
    if (kind === 'number') { it.min = Number(a.min ?? 0); it.max = Number(a.max ?? 100); it.step = Number(a.step ?? 1); }
    if (kind === 'select') it.options = Array.isArray(a.options) ? a.options.map(String) : [];
    if (kind === 'text') it.maxLength = Number(a.max ?? 255);
    if (group === 'stream') it.hint = /luồng/i.test(label)
      ? 'Tiếng trong luồng camera gửi Frigate / go2rtc. Đang phát video trên màn này thì tạm không lấy tiếng.'
      : 'Ghi tiếng micro khi quay video bằng ứng dụng Camera (áp dụng từ lần quay sau).';
    if (kind === 'button') it.confirm = a.device_class === 'restart' || /restart|khoi_dong_lai/i.test(e.entity_id);
    items.push(placeSetting(it));
  }
  items.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || x.label.localeCompare(y.label, 'vi'));
  return {
    device: { name: deviceName || 'Màn hình', ...(dev.model ? { model: dev.model } : {}), ...(dev.sw_version ? { version: dev.sw_version } : {}) },
    items,
  };
}

/**
 * (30/09/2026) Select "Nguồn phát hiện người" cua firmware P4 (Chuyen dong / Person / Ca 2 / Tat) — hien trong thanh
 * trang thai. Man khong co select nay (S3, firmware P4 cu) -> undefined, thanh trang thai khong hien hang do.
 */
export function findPresenceSelect(view: SettingsView): SettingItem | undefined {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  return view.items.find((i) => i.kind === 'select' && !i.unavailable && (i.options ?? []).length > 1 &&
    (/nguon_phat_hien_nguoi$/.test(i.id) || norm(i.label) === 'nguon phat hien nguoi'));
}

/**
 * (01/10/2026) Cong tac "No Sleep" cua firmware (P4 + S3; Shell goi la "Màn hình chờ"): giu den nen sang, ranh thi hien
 * man hinh cho. Tim theo entity_id hoac nhan.
 */
export function findNoSleepSwitch(view: SettingsView): SettingItem | undefined {
  // (01/10/2026) Firmware moi doi ten "No Sleep" -> "Màn hình chờ" (entity_id ..._man_hinh_cho); KHONG nham voi
  // "Ảnh màn hình chờ" (..._anh_man_hinh_cho).
  return view.items.find((i) => i.kind === 'switch' && !i.unavailable && (/_no_sleep$/.test(i.id) ||
    (/_man_hinh_cho$/.test(i.id) && !/_anh_man_hinh_cho$/.test(i.id)) || ['no sleep', 'màn hình chờ'].includes(i.label.trim().toLowerCase())));
}

/** (01/10/2026) Cong tac "Ảnh màn hình chờ" cua firmware (P4 + S3) — server dong bo hai chieu voi Cai dat. */
export function isSaverPhotosSwitchId(entityId: string): boolean {
  return /^switch\..*_anh_man_hinh_cho$/.test(entityId);
}

export interface ServiceCall { domain: string; service: string; data: Record<string, unknown> }

/**
 * (08/10/2026) DOI WI-FI tu Cai dat: firmware co dich vu (action ESPHome) wifi_scan / wifi_connect -> HA dat ten
 * esphome.<ten node, '-' thanh '_'>_<action>. Ten node lay tu cam bien "Tên ESPHome" cua CHINH man hinh nay (ten node
 * khac tien to ma thuc the — do that: P4 node esp32-p4-tab7, thuc the 7inch_tab_* / 7_0_guition_*). Kiem tra: ten mang
 * 1-32 byte, mat khau rong (mang mo) hoac 8-63 ky tu (WPA2). Chuoi = loi (khong goi HA).
 */
/**
 * (08/10/2026) MAT KHAU LUONG CAMERA dat / doi luc chay (nguoi dung cuoi, trang Cai dat): dich vu esphome.<node>_set_camera_auth
 * cua CHINH man hinh nay. Ten 1-32 ky tu [A-Za-z0-9._@-]; mat khau 4-64 ky tu in duoc; bat ma mat khau rong = giu mat
 * khau dang luu — chi hop le khi dang bat san (cam bien "Mật khẩu luồng camera" = "Bật · ...").
 */
export function planCamAuth(view: SettingsView, enabled: unknown, user: unknown, password: unknown): ServiceCall | string {
  const node = view.items.find((i) => /^sensor\..*_ten_esphome$/.test(i.id) && !i.unavailable)?.value ?? '';
  const st = view.items.find((i) => /^sensor\..*_mat_khau_luong_camera$/.test(i.id))?.value ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(node) || !st || st === 'unavailable') return 'firmware chua ho tro mat khau camera';
  if (typeof enabled !== 'boolean') return 'thieu bat / tat';
  const u = typeof user === 'string' ? user.trim() : '', p = typeof password === 'string' ? password : '';
  if (enabled) {
    if (!/^[A-Za-z0-9._@-]{1,32}$/.test(u)) return 'ten dang nhap khong hop le';
    if (p && (p.length < 4 || p.length > 64 || /[\u0000-\u001f\u007f]/.test(p))) return 'mat khau phai 4-64 ky tu';
    if (!p && !/^Bật/.test(st)) return 'can mat khau';
  }
  return { domain: 'esphome', service: `${node.replace(/-/g, '_')}_set_camera_auth`, data: { enabled, username: u, password: p } };
}

export function planWifi(view: SettingsView, op: unknown, ssid?: unknown, password?: unknown): ServiceCall | string {
  const node = view.items.find((i) => /^sensor\..*_ten_esphome$/.test(i.id) && !i.unavailable)?.value ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(node)) return 'firmware chua ho tro doi Wi-Fi';
  const svc = node.replace(/-/g, '_');
  if (op === 'scan') return { domain: 'esphome', service: `${svc}_wifi_scan`, data: {} };
  if (op !== 'connect') return 'thao tac la';
  if (typeof ssid !== 'string' || typeof password !== 'string') return 'thieu ten mang / mat khau';
  const bytes = new TextEncoder().encode(ssid).length;
  if (!ssid.trim() || bytes > 32 || /[\u0000-\u001f]/.test(ssid)) return 'ten mang khong hop le';
  if (password.length && (password.length < 8 || password.length > 63 || /[\u0000-\u001f]/.test(password))) return 'mat khau phai 8-63 ky tu';
  return { domain: 'esphome', service: `${svc}_wifi_connect`, data: { ssid, password } };
}

/**
 * Kiem tra thao tac cua nguoi dung voi MOT muc cai dat (phai nam trong view cua CHINH man hinh do) va doi thanh loi goi
 * dich vu HA. Tra ve chuoi loi neu khong hop le.
 */
export function planSet(view: SettingsView, id: string, value: unknown): ServiceCall | string {
  const it = view.items.find((i) => i.id === id);
  if (!it) return 'khong phai cai dat cua man hinh nay';
  const data: Record<string, unknown> = { entity_id: id };
  switch (it.kind) {
    case 'switch':
      return { domain: 'switch', service: value ? 'turn_on' : 'turn_off', data };
    case 'light': {
      if (typeof value === 'boolean') return { domain: 'light', service: value ? 'turn_on' : 'turn_off', data };
      const v = Number(value);
      if (!Number.isFinite(v)) return 'do sang khong hop le';
      const pct = Math.max(1, Math.min(100, Math.round(v)));
      return { domain: 'light', service: 'turn_on', data: { ...data, brightness_pct: pct } };
    }
    case 'number': {
      const v = Number(value);
      if (!Number.isFinite(v)) return 'gia tri khong hop le';
      const min = it.min ?? 0, max = it.max ?? 100, step = it.step || 1;
      const snapped = Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
      return { domain: 'number', service: 'set_value', data: { ...data, value: Number(snapped.toFixed(6)) } };
    }
    case 'select':
      if (typeof value !== 'string' || !(it.options ?? []).includes(value)) return 'lua chon khong hop le';
      return { domain: 'select', service: 'select_option', data: { ...data, option: value } };
    case 'text':
      if (typeof value !== 'string' || value.length > (it.maxLength ?? 255)) return 'noi dung khong hop le';
      return { domain: 'text', service: 'set_value', data: { ...data, value } };
    case 'button':
      return { domain: 'button', service: 'press', data };
    default:
      return 'muc nay chi de xem';
  }
}

// ── (08/10/2026) BIEU TUONG CANH DONG HO (giot nuoc o mep tren moi trang): pin ben trai, mang ben phai ──────────────────
/** k = 'eth' (dang dung cap RJ45) | 'wifi' (q = so vach sang 0..3). */
export type NetIcon = { k: 'eth' } | { k: 'wifi'; q: 0 | 1 | 2 | 3 };
export interface StatusIcons { nw: NetIcon | null; bt: number | null }
export interface StatusIds { sig?: string; kind?: string; bat?: string }

/** Thuc the cua thiet bi HA `devId`: cuong do Wi-Fi, kieu ket noi (firmware co Ethernet), muc pin. */
export function statusEntityIds(entities: HaEntity[], devId: string): StatusIds {
  const out: StatusIds = {};
  for (const e of entities) {
    if (e.device_id !== devId || e.disabled_by) continue;
    const id = e.entity_id;
    if (!out.sig && /^sensor\..*_wifi_signal$/.test(id)) out.sig = id;
    else if (!out.kind && /^sensor\..*_ket_noi_mang$/.test(id)) out.kind = id;
    else if (!out.bat && /^sensor\..*_battery_(percent|level)$/.test(id)) out.bat = id;
  }
  return out;
}

/** Vach Wi-Fi: dBm (ESPHome wifi_signal) hoac % (neu nguoi dung loc sang %). */
export function wifiBars(v: number, unit?: string): 0 | 1 | 2 | 3 {
  if (unit === '%') return v >= 70 ? 3 : v >= 45 ? 2 : v >= 20 ? 1 : 0;
  return v >= -60 ? 3 : v >= -70 ? 2 : v >= -80 ? 1 : 0;
}

const num = (s?: HaState | null) => {
  if (!s || s.state === '' || s.state === 'unknown' || s.state === 'unavailable') return null;
  const v = Number(s.state);
  return Number.isFinite(v) ? v : null;
};

export function statusIconsOf(sig?: HaState | null, kind?: HaState | null, bat?: HaState | null): StatusIcons {
  let nw: NetIcon | null = null;
  if (/ethernet|rj45|day|dây|lan/i.test(kind?.state ?? '')) nw = { k: 'eth' };
  else {
    const v = num(sig), unit = sig?.attributes?.unit_of_measurement;
    if (v != null && (unit === '%' ? v >= 0 : v < 0)) nw = { k: 'wifi', q: wifiBars(v, unit) };
  }
  const b = num(bat);
  return { nw, bt: b == null ? null : Math.max(0, Math.min(100, Math.round(b))) };
}
