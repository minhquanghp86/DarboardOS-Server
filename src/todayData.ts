// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) Gom du lieu cho trang "Hom nay" + loi chao buoi sang: thoi tiet (weatherMini), lich hom nay (moi
// calendar.* cua HA qua REST), viec chua xong (todo.*, WebSocket), ghi chu bang tin; va doc loi chao qua loa cua panel
// (tts.speak toi media_player cua chinh thiet bi ESPHome, tim theo MAC nhu ung dung Cai dat).
import { board } from './board.js';
import { callService, getRegistry, getStates, haFetch, haReady, wsCalls } from './haSettings.js';
import { buildTodoLists, todoItemsOf } from './homeModel.js';
import { findDeviceByMac, macFromDeviceId } from './settingsModel.js';
import { BriefingInput, TodayEvent, briefingText, deviceClock, greeting } from './today.js';
import { getWeatherMini } from './weatherMini.js';

export interface TodayView extends BriefingInput { date: string; briefing: string }

async function events(tzMin: number): Promise<TodayEvent[]> {
  const r = await haFetch('/calendars');
  if (!r.ok) return [];
  const cals = await r.json() as { entity_id: string }[];
  const { date } = deviceClock(Date.now(), tzMin);
  const sign = tzMin >= 0 ? '+' : '-', hh = String(Math.floor(Math.abs(tzMin) / 60)).padStart(2, '0'), mm = String(Math.abs(tzMin) % 60).padStart(2, '0');
  const start = `${date}T00:00:00${sign}${hh}:${mm}`, end = `${date}T23:59:59${sign}${hh}:${mm}`;
  const out: TodayEvent[] = [];
  for (const c of cals.slice(0, 8)) {
    try {
      const e = await haFetch(`/calendars/${encodeURIComponent(c.entity_id)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      if (!e.ok) continue;
      for (const ev of await e.json() as any[]) {
        const s = ev?.start?.dateTime ?? ev?.start?.date;
        if (typeof ev?.summary === 'string' && typeof s === 'string') out.push({ title: ev.summary.slice(0, 80), start: s, allDay: !ev.start.dateTime });
      }
    } catch { /* lich loi: bo qua */ }
  }
  return out.sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.start.localeCompare(b.start)).slice(0, 12);
}

async function todos(): Promise<string[]> {
  const lists = buildTodoLists(await getStates()).filter((l) => l.open > 0).slice(0, 3);
  if (!lists.length) return [];
  const res = await wsCalls(lists.map((l) => ({ type: 'todo/item/list', entity_id: l.id })));
  return res.flatMap((r) => todoItemsOf(r).filter((i) => !i.done).map((i) => i.summary)).slice(0, 12);
}

export async function getToday(tzMin: number): Promise<TodayView> {
  const { minute, date } = deviceClock(Date.now(), tzMin);
  const w = getWeatherMini();
  const ha = haReady();
  const [ev, td] = await Promise.all([ha ? events(tzMin).catch(() => []) : [], ha ? todos().catch(() => []) : []]);
  const b: BriefingInput = {
    greet: greeting(Math.floor(minute / 60)),
    wx: w ? { t: w.t, code: w.code, pp: w.pp, name: w.name } : null,
    events: ev, todos: td,
    notes: board.list().slice(0, 5).map((n) => n.text),
  };
  return { ...b, date, briefing: briefingText(b) };
}

/**
 * Doc `message` qua loa cua CHINH man hinh (thiet bi ESPHome tim theo MAC trong id "esp32-<mac>"): tts.speak voi dich
 * vu TTS dau tien cua HA (uu tien Piper). Tra ve ly do neu khong doc duoc.
 */
export async function speakOnPanel(deviceId: string, message: string): Promise<string | null> {
  if (!haReady()) return 'addon khong co quyen HA';
  const mac = macFromDeviceId(deviceId);
  if (!mac) return 'id thiet bi khong co MAC';
  const reg = await getRegistry();
  const dev = findDeviceByMac(reg.devices, mac);
  if (!dev) return 'khong thay thiet bi trong HA';
  const mp = reg.entities.find((e) => e.device_id === dev.id && e.entity_id.startsWith('media_player.') && !e.disabled_by)?.entity_id;
  if (!mp) return 'thiet bi khong co media_player';
  const tts = (await getStates()).map((s) => s.entity_id).filter((id) => id.startsWith('tts.'));
  const engine = tts.find((id) => /piper/i.test(id)) ?? tts[0];
  if (!engine) return 'HA chua co dich vu TTS (vd Piper)';
  const ok = await callService({ domain: 'tts', service: 'speak', data: { entity_id: engine, media_player_entity_id: mp, message } }).catch(() => false);
  return ok ? null : 'goi tts.speak that bai';
}
