// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-4) CAI DAT TREN PANEL — phan THUAN (khong mang): tu so dang ky thiet bi/thuc the + trang thai cua Home
// Assistant, dung danh sach cai dat cua MOT man hinh, va kiem tra/chuyen mot thao tac cua nguoi dung thanh loi goi
// dich vu HA. Khong viet cung ten thuc the nao: thiet bi ESPHome duoc tim theo dia chi MAC (nam san trong id
// "esp32-<mac>" ma firmware gui len), roi lay MOI thuc the cua thiet bi do — cung ma chay cho ca P4 lan hai S3.

export type SettingKind = 'switch' | 'light' | 'number' | 'select' | 'text' | 'button' | 'value';
export type SettingGroup = 'control' | 'config' | 'diag';

export interface HaDevice { id: string; name?: string | null; name_by_user?: string | null; connections?: [string, string][];
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
}

export interface SettingsView {
  device: { name: string; model?: string; version?: string };
  items: SettingItem[];
}

/** "esp32-28372f8a0218" -> "28372f8a0218" (MAC 12 hex, khong dau). null neu id khong theo mau firmware. */
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
    const group: SettingGroup = e.entity_category === 'diagnostic' ? 'diag' : e.entity_category === 'config' ? 'config'
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
    if (kind === 'button') it.confirm = a.device_class === 'restart' || /restart|khoi_dong_lai/i.test(e.entity_id);
    items.push(it);
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

export interface ServiceCall { domain: string; service: string; data: Record<string, unknown> }

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
