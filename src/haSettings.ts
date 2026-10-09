// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-4) Ket noi Home Assistant cho trang Cai dat tren panel: so dang ky thiet bi/thuc the (WebSocket API,
// REST khong co), trang thai va goi dich vu (REST). Quyen: `homeassistant_api: true` cua addon -> SUPERVISOR_TOKEN
// (khong can token nguoi dung). Duong dan doi duoc qua bien moi truong de thu tich hop voi HA gia.
import WebSocket from 'ws';
import { HaDevice, HaEntity, HaState, ServiceCall, SettingsView, StatusIcons, buildSettingsView, findDeviceByMac, macFromDeviceId, statusEntityIds, statusIconsOf } from './settingsModel.js';

const API = () => process.env.HA_API_URL || 'http://supervisor/core/api';
const WS = () => process.env.HA_WS_URL || 'ws://supervisor/core/websocket';
const token = () => process.env.SUPERVISOR_TOKEN || '';

/** Mot lenh WebSocket: chi ten ("config/area_registry/list") hoac kem tham so ({type, entity_id...}). */
export type WsCommand = string | ({ type: string } & Record<string, unknown>);

/** Mot phien WebSocket ngan: xac thuc, gui cac lenh, nhan ket qua, dong. */
export async function wsCalls(cmds: WsCommand[]): Promise<unknown[]> {
  const types = cmds.map((c) => (typeof c === 'string' ? c : c.type));
  const t = token();
  if (!t) throw new Error('khong co SUPERVISOR_TOKEN');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS());
    const out: unknown[] = new Array(types.length);
    let got = 0;
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('HA WebSocket het gio')); }, 10_000);
    const fail = (e: Error) => { clearTimeout(timer); ws.terminate(); reject(e); };
    ws.on('error', fail);
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: t }));
      else if (m.type === 'auth_invalid') fail(new Error('HA tu choi xac thuc'));
      else if (m.type === 'auth_ok') cmds.forEach((c, i) => ws.send(JSON.stringify({ ...(typeof c === 'string' ? { type: c } : c), id: i + 1 })));
      else if (m.type === 'result' && typeof m.id === 'number') {
        if (!m.success) return fail(new Error(`HA ${types[m.id - 1]}: ${m.error?.message ?? 'loi'}`));
        out[m.id - 1] = m.result;
        if (++got === types.length) { clearTimeout(timer); ws.close(); resolve(out); }
      }
    });
  });
}

// So dang ky it doi: giu 5 phut (tao/xoa thuc the trong HA -> toi da 5 phut sau panel moi thay).
export interface HaArea { area_id: string; name: string; floor_id?: string | null; icon?: string | null }
let registry: { at: number; devices: HaDevice[]; entities: HaEntity[]; areas: HaArea[] } | null = null;
export async function getRegistry(): Promise<{ devices: HaDevice[]; entities: HaEntity[]; areas: HaArea[] }> {
  if (registry && Date.now() - registry.at < 5 * 60_000) return registry;
  const [devices, entities, areas] = await wsCalls(['config/device_registry/list', 'config/entity_registry/list', 'config/area_registry/list']);
  registry = { at: Date.now(), devices: devices as HaDevice[], entities: entities as HaEntity[], areas: (areas as HaArea[]) ?? [] };
  return registry;
}

/** Moi trang thai hien tai (REST /states). */
export async function getStates(): Promise<HaState[]> {
  const r = await haFetch('/states');
  if (!r.ok) throw new Error(`Home Assistant trả lỗi ${r.status}`);
  return await r.json() as HaState[];
}

export const haReady = () => !!token();

/** Tai mot duong dan cua HA (vd anh bia media_player /api/media_player_proxy/...), co xac thuc. */
export async function haGetRaw(path: string): Promise<Response> {
  const base = API().replace(/\/api$/, '');
  return fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(8000) });
}

export async function haFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
}

export type SettingsResult = { ok: true; view: SettingsView } | { ok: false; error: string };

/** Danh sach cai dat hien tai cua man hinh `deviceId` (id firmware "esp32-<mac>"). */
export async function getSettingsView(deviceId: string): Promise<SettingsResult> {
  if (!token()) return { ok: false, error: 'Addon không có quyền đọc Home Assistant.' };
  const mac = macFromDeviceId(deviceId);
  if (!mac) return { ok: false, error: `Không nhận ra màn hình "${deviceId}".` };
  try {
    const reg = await getRegistry();
    const dev = findDeviceByMac(reg.devices, mac);
    if (!dev) return { ok: false, error: 'Không tìm thấy màn hình này trong Home Assistant (đã thêm thiết bị ESPHome chưa?).' };
    const r = await haFetch('/states');
    if (!r.ok) return { ok: false, error: `Home Assistant trả lỗi ${r.status}.` };
    const states = new Map<string, HaState>((await r.json() as HaState[]).map((s) => [s.entity_id, s]));
    return { ok: true, view: buildSettingsView(dev, reg.entities, states) };
  } catch (e) {
    return { ok: false, error: `Không kết nối được Home Assistant (${(e as Error).message}).` };
  }
}

/** (08/10/2026) Pin + mang cho bieu tuong canh dong ho. null = khong doc duoc (khong co HA / chua them thiet bi). */
export async function getStatusIcons(deviceId: string): Promise<StatusIcons | null> {
  const mac = macFromDeviceId(deviceId);
  if (!token() || !mac) return null;
  const reg = await getRegistry();
  const dev = findDeviceByMac(reg.devices, mac);
  if (!dev) return null;
  const ids = statusEntityIds(reg.entities, dev.id);
  const one = async (id?: string): Promise<HaState | null> => {
    if (!id) return null;
    const r = await haFetch(`/states/${id}`);
    return r.ok ? await r.json() as HaState : null;
  };
  const [sig, kind, bat] = await Promise.all([one(ids.sig), one(ids.kind), one(ids.bat)]);
  return statusIconsOf(sig, kind, bat);
}

/**
 * (09/10/2026) TU SUA DIA CHI THIET BI ESPHOME TRONG HA: man hinh doi Cap mang <-> Wi-Fi (hai cong khac MAC -> khac IP), HA
 * van goi IP cu -> moi cam bien "unavailable" (mDNS bao IP moi luc HA con ket noi duong cu nen HA bo qua). Server biet IP
 * hien tai (ket noi WebSocket) -> chay luong "Cấu hình lại" cua tich hop ESPHome voi IP do (HA tu kiem dung MAC thiet bi).
 */
export async function healEsphomeHost(deviceId: string, ip: string): Promise<string> {
  const mac = macFromDeviceId(deviceId);
  if (!token() || !mac || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return 'bo qua';
  const reg = await getRegistry();
  const dev = findDeviceByMac(reg.devices, mac);
  if (!dev) return 'khong thay thiet bi';
  const r = await haFetch('/config/config_entries/entry?domain=esphome');
  if (!r.ok) return `HA ${r.status}`;
  const entry = (await r.json() as { entry_id: string }[]).find((e) => (dev.config_entries || []).includes(e.entry_id));
  if (!entry) return 'khong thay muc ESPHome';
  const f = await haFetch('/config/config_entries/flow', { method: 'POST', body: JSON.stringify({ handler: 'esphome', entry_id: entry.entry_id }) });
  const fj = await f.json() as { flow_id?: string; type?: string; reason?: string };
  if (!fj.flow_id || fj.type !== 'form') return `khong mo duoc (${fj.reason ?? f.status})`;
  const d = await haFetch(`/config/config_entries/flow/${fj.flow_id}`, { method: 'POST', body: JSON.stringify({ host: ip, port: 6053 }) });
  const dj = await d.json() as { type?: string; reason?: string; errors?: unknown };
  if (dj.type === 'form') await haFetch(`/config/config_entries/flow/${fj.flow_id}`, { method: 'DELETE' }).catch(() => null);
  return dj.reason ?? (dj.errors ? JSON.stringify(dj.errors) : String(dj.type));
}

export async function callService(c: ServiceCall): Promise<boolean> {
  const r = await haFetch(`/services/${c.domain}/${c.service}`, { method: 'POST', body: JSON.stringify(c.data) });
  return r.ok;
}

/** Chi dung cho thu nghiem: bo cache so dang ky. */
export function _resetRegistryCache(): void { registry = null; }
