// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) UNG DUNG NHA (Phong, Dieu khien TV/loa) — phan THUAN: tu so dang ky khu vuc/thiet bi/thuc the + trang
// thai cua Home Assistant, dung danh sach phong va cac nut dieu khien; kiem tra/chuyen mot thao tac thanh loi goi dich
// vu. Chi cho phep mot danh sach thao tac CO DINH tren thuc the DANG hien (khong khoa cua, khong bao dong, khong dich vu
// tuy y).
import type { HaDevice, HaEntity, HaState, ServiceCall } from './settingsModel.js';
import type { HaArea } from './haSettings.js';

export type RoomKind = 'toggle' | 'light' | 'cover' | 'climate' | 'media' | 'lock';
export interface RoomItem {
  id: string; name: string; kind: RoomKind; on: boolean; state: string; unavailable?: boolean;
  /** light: do sang 0..100 (khi dang bat) */ bri?: number; dim?: boolean;
  /** cover: vi tri 0..100 */ pos?: number;
  /** climate */ cur?: number; target?: number; min?: number; max?: number; step?: number; modes?: string[]; mode?: string;
  /** media */ title?: string; vol?: number;
}
export interface Room {
  id: string; name: string; items: RoomItem[];
  temp?: number; hum?: number; open?: number; motion?: boolean; lightsOn: number;
}
export interface MediaItem {
  id: string; name: string; state: string; title?: string; artist?: string; vol?: number; muted?: boolean;
  art: boolean; area?: string; canPrev: boolean; canNext: boolean; canVol: boolean; canPower: boolean;
}

type Ent = HaEntity & { area_id?: string | null; name?: string | null; original_name?: string | null };
type Dev = HaDevice & { area_id?: string | null };

const CONTROL = new Set(['light', 'switch', 'fan', 'input_boolean', 'cover', 'climate', 'media_player', 'lock']);
const KIND: Record<string, RoomKind> = { light: 'light', switch: 'toggle', fan: 'toggle', input_boolean: 'toggle', cover: 'cover',
  climate: 'climate', media_player: 'media', lock: 'lock' };
const ORDER: Record<RoomKind, number> = { light: 0, toggle: 1, climate: 2, cover: 3, media: 4, lock: 5 };
const OFF_STATES = new Set(['off', 'closed', 'idle', 'standby', 'unavailable', 'unknown', 'locked']);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

/** Bo phan ten phong / ten thiet bi o dau ("Phong khach Den tran" -> "Den tran"). */
export function shortName(full: string, prefixes: string[]): string {
  const f = full.trim();
  for (const p of prefixes) {
    if (!p) continue;
    if (f.toLowerCase().startsWith(p.toLowerCase() + ' ') && f.length > p.length + 1) return f.slice(p.length + 1).trim();
  }
  return f;
}

function itemOf(e: Ent, st: HaState, prefixes: string[]): RoomItem | null {
  const domain = e.entity_id.split('.')[0];
  const kind = KIND[domain];
  if (!kind) return null;
  const a = st.attributes ?? {};
  const name = shortName(String(a.friendly_name || e.name || e.original_name || e.entity_id), prefixes);
  const unavailable = st.state === 'unavailable' || st.state === 'unknown';
  const it: RoomItem = { id: e.entity_id, name, kind, state: st.state, on: !OFF_STATES.has(st.state) };
  if (unavailable) it.unavailable = true;
  if (kind === 'light') {
    const modes: string[] = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
    it.dim = modes.some((m) => m !== 'onoff');
    if (it.on && num(a.brightness) != null) it.bri = Math.max(1, Math.round((num(a.brightness)! / 255) * 100));
  } else if (kind === 'cover') {
    it.on = st.state === 'open' || st.state === 'opening';
    if (num(a.current_position) != null) it.pos = num(a.current_position);
  } else if (kind === 'climate') {
    it.on = st.state !== 'off' && !unavailable;
    it.mode = st.state;
    it.cur = num(a.current_temperature);
    it.target = num(a.temperature);
    it.min = num(a.min_temp) ?? 16; it.max = num(a.max_temp) ?? 32;
    it.step = num(a.target_temp_step) ?? 0.5;
    if (Array.isArray(a.hvac_modes)) it.modes = a.hvac_modes.filter((m: unknown) => typeof m === 'string').slice(0, 8);
  } else if (kind === 'media') {
    it.on = !OFF_STATES.has(st.state);
    if (a.media_title) it.title = String(a.media_title);
    if (num(a.volume_level) != null) it.vol = Math.round(num(a.volume_level)! * 100);
  } else if (kind === 'lock') {
    it.on = st.state === 'unlocked';
  }
  return it;
}

/** Danh sach phong: theo thu tu khu vuc cua HA; phong khong co gi dieu khien duoc thi bo. */
export function buildRooms(areas: HaArea[], devices: Dev[], entities: Ent[], states: Map<string, HaState>): Room[] {
  const devById = new Map(devices.map((d) => [d.id, d]));
  const rooms = new Map<string, Room>(areas.map((a) => [a.area_id, { id: a.area_id, name: a.name, items: [], lightsOn: 0 }]));
  for (const e of entities) {
    if (e.disabled_by || e.hidden_by || e.entity_category) continue;
    const dev = e.device_id ? devById.get(e.device_id) : undefined;
    const areaId = e.area_id || dev?.area_id;
    const room = areaId ? rooms.get(areaId) : undefined;
    const st = states.get(e.entity_id);
    if (!room || !st) continue;
    const domain = e.entity_id.split('.')[0];
    const a = st.attributes ?? {};
    if (domain === 'sensor') {
      const v = num(st.state);
      if (v == null) continue;
      if (a.device_class === 'temperature' && room.temp == null) room.temp = Math.round(v * 10) / 10;
      if (a.device_class === 'humidity' && room.hum == null) room.hum = Math.round(v);
      continue;
    }
    if (domain === 'binary_sensor') {
      const dc = a.device_class;
      if ((dc === 'door' || dc === 'window' || dc === 'opening' || dc === 'garage_door') && st.state === 'on') room.open = (room.open ?? 0) + 1;
      if ((dc === 'motion' || dc === 'occupancy' || dc === 'presence') && st.state === 'on') room.motion = true;
      continue;
    }
    if (!CONTROL.has(domain)) continue;
    const devName = dev ? String(dev.name_by_user || dev.name || '') : '';
    const it = itemOf(e, st, [room.name, devName]);
    if (!it) continue;
    room.items.push(it);
    if (it.kind === 'light' && it.on) room.lightsOn++;
  }
  const out: Room[] = [];
  for (const r of rooms.values()) {
    if (!r.items.length) continue;
    r.items.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || x.name.localeCompare(y.name, 'vi'));
    out.push(r);
  }
  return out;
}

/** Moi media_player dang dung duoc (TV, loa, Chromecast...) cho ung dung Dieu khien. */
export function buildMedia(states: HaState[], areaOf: (id: string) => string | undefined): MediaItem[] {
  const out: MediaItem[] = [];
  for (const s of states) {
    if (!s.entity_id.startsWith('media_player.') || s.state === 'unavailable') continue;
    const a = s.attributes ?? {};
    const f = num(a.supported_features) ?? 0;
    out.push({
      id: s.entity_id, name: String(a.friendly_name || s.entity_id), state: s.state,
      title: a.media_title ? String(a.media_title) : undefined,
      artist: a.media_artist ? String(a.media_artist) : a.app_name ? String(a.app_name) : undefined,
      vol: num(a.volume_level) != null ? Math.round(num(a.volume_level)! * 100) : undefined,
      muted: a.is_volume_muted === true,
      art: typeof a.entity_picture === 'string' && a.entity_picture.length > 0,
      area: areaOf(s.entity_id),
      // MediaPlayerEntityFeature: PREVIOUS_TRACK 16, NEXT_TRACK 32, VOLUME_SET 4, TURN_ON 128, TURN_OFF 256
      canPrev: (f & 16) !== 0, canNext: (f & 32) !== 0, canVol: (f & 4) !== 0, canPower: (f & 384) !== 0,
    });
  }
  const rank = (m: MediaItem) => (m.state === 'playing' ? 0 : m.state === 'paused' ? 1 : m.state === 'off' ? 3 : 2);
  return out.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name, 'vi'));
}

/**
 * Thao tac tu trang -> loi goi dich vu, hoac chuoi loi. `known` = trang thai cac thuc the trang DANG hien
 * (chi thuc the co trong danh sach moi dieu khien duoc).
 */
export function planAction(known: Map<string, HaState>, entity: string, action: string, value?: unknown): ServiceCall | string {
  const st = known.get(entity);
  if (!st) return 'Thiết bị không có trong danh sách.';
  const domain = entity.split('.')[0];
  const data = { entity_id: entity };
  const a = st.attributes ?? {};
  switch (domain) {
    case 'light':
      if (action === 'toggle') return { domain, service: 'toggle', data };
      if (action === 'bri') {
        const v = num(value);
        if (v == null) return 'Độ sáng không hợp lệ.';
        return { domain, service: 'turn_on', data: { ...data, brightness_pct: Math.min(100, Math.max(1, Math.round(v))) } };
      }
      break;
    case 'switch': case 'fan': case 'input_boolean':
      if (action === 'toggle') return { domain, service: 'toggle', data };
      break;
    case 'cover':
      if (action === 'open') return { domain, service: 'open_cover', data };
      if (action === 'close') return { domain, service: 'close_cover', data };
      if (action === 'stop') return { domain, service: 'stop_cover', data };
      break;
    case 'climate': {
      if (action === 'temp') {
        const v = num(value);
        if (v == null) return 'Nhiệt độ không hợp lệ.';
        const step = num(a.target_temp_step) ?? 0.5, lo = num(a.min_temp) ?? 16, hi = num(a.max_temp) ?? 32;
        const t = Math.min(hi, Math.max(lo, Math.round(v / step) * step));
        return { domain, service: 'set_temperature', data: { ...data, temperature: t } };
      }
      if (action === 'mode') {
        const modes: string[] = Array.isArray(a.hvac_modes) ? a.hvac_modes : [];
        if (typeof value !== 'string' || !modes.includes(value)) return 'Chế độ không hợp lệ.';
        return { domain, service: 'set_hvac_mode', data: { ...data, hvac_mode: value } };
      }
      break;
    }
    case 'media_player': {
      if (action === 'play') return { domain, service: 'media_play_pause', data };
      if (action === 'next') return { domain, service: 'media_next_track', data };
      if (action === 'prev') return { domain, service: 'media_previous_track', data };
      if (action === 'power') return { domain, service: st.state === 'off' ? 'turn_on' : 'turn_off', data };
      if (action === 'mute') return { domain, service: 'volume_mute', data: { ...data, is_volume_muted: a.is_volume_muted !== true } };
      if (action === 'vol') {
        const v = num(value);
        if (v == null) return 'Âm lượng không hợp lệ.';
        return { domain, service: 'volume_set', data: { ...data, volume_level: Math.min(100, Math.max(0, Math.round(v))) / 100 } };
      }
      break;
    }
  }
  return 'Thao tác không được phép.';
}

// ── Viec can lam (thuc the todo.* cua HA: Danh sach mua sam, Google Tasks, Local To-do...) ─────────────────────
export interface TodoList { id: string; name: string; open: number }
export interface TodoItem { uid: string; summary: string; done: boolean; due?: string }

export function buildTodoLists(states: HaState[]): TodoList[] {
  return states.filter((s) => s.entity_id.startsWith('todo.') && s.state !== 'unavailable')
    .map((s) => ({ id: s.entity_id, name: String(s.attributes?.friendly_name || s.entity_id), open: num(s.state) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function todoItemsOf(raw: unknown): TodoItem[] {
  const items = (raw as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((x: any) => (x && typeof x.uid === 'string' && typeof x.summary === 'string')
    ? [{ uid: x.uid, summary: x.summary, done: x.status === 'completed', ...(x.due ? { due: String(x.due) } : {}) }] : []);
}

/** Thao tac danh sach viec: them / danh dau / xoa cac muc da xong. */
export function planTodo(lists: TodoList[], list: string, action: string, value?: unknown, done?: unknown): ServiceCall | string {
  if (!lists.some((l) => l.id === list)) return 'Danh sách không tồn tại.';
  const data = { entity_id: list };
  if (action === 'add') {
    const t = typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
    if (!t || t.length > 200) return 'Nội dung trống hoặc quá dài.';
    return { domain: 'todo', service: 'add_item', data: { ...data, item: t } };
  }
  if (action === 'set') {
    if (typeof value !== 'string' || !value || value.length > 200) return 'Mục không hợp lệ.';
    return { domain: 'todo', service: 'update_item', data: { ...data, item: value, status: done ? 'completed' : 'needs_action' } };
  }
  if (action === 'clear') return { domain: 'todo', service: 'remove_completed_items', data };
  return 'Thao tác không được phép.';
}
