// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) "HOM NAY" + CHAO BUOI SANG — phan THUAN: loi chao theo gio, mo ta thoi tiet, cua so buoi sang, cau doc
// tom tat (TTS). Du lieu that (lich, viec, thoi tiet, ghi chu) do src/homeApi.ts gom lai.

export function greeting(hour: number): string {
  if (hour >= 4 && hour < 11) return 'Chào buổi sáng';
  if (hour >= 11 && hour < 14) return 'Chào buổi trưa';
  if (hour >= 14 && hour < 18) return 'Chào buổi chiều';
  if (hour >= 18 && hour < 22) return 'Chào buổi tối';
  return 'Chúc ngủ ngon';
}

/** Ma thoi tiet WMO -> loi mo ta tieng Viet ngan. */
export function wxText(code: number): string {
  if (code === 0) return 'trời quang';
  if (code <= 2) return 'ít mây';
  if (code === 3) return 'nhiều mây';
  if (code === 45 || code === 48) return 'có sương mù';
  if (code >= 51 && code <= 57) return 'mưa phùn';
  if (code >= 61 && code <= 67) return code >= 65 ? 'mưa to' : 'có mưa';
  if (code >= 80 && code <= 82) return 'mưa rào';
  if (code >= 95) return 'có dông';
  return 'thời tiết thay đổi';
}

/** "06:00-09:30" -> [360, 570] (phut trong ngay); sai dinh dang -> null. */
export function parseWindow(s: string): [number, number] | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(s || '');
  if (!m) return null;
  const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
  return a < b && b <= 24 * 60 ? [a, b] : null;
}

/** Gio phut tai thiet bi (UTC + mui gio thiet bi). */
export function deviceClock(nowMs: number, tzOffsetMin: number): { minute: number; date: string } {
  const d = new Date(nowMs + tzOffsetMin * 60_000);
  return { minute: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}

/** Co chao buoi sang khong: trong khung gio va hom nay chua chao man hinh nay. */
export function shouldGreet(o: { minute: number; date: string; window: [number, number] | null; lastDate: string | null }): boolean {
  return !!o.window && o.minute >= o.window[0] && o.minute < o.window[1] && o.lastDate !== o.date;
}

export interface TodayEvent { title: string; start: string; allDay: boolean }
export interface BriefingInput {
  greet: string;
  wx: { t: number; code: number; pp: number | null; name: string } | null;
  events: TodayEvent[];
  todos: string[];
  notes: string[];
}

/** Gio "HH:MM" cua su kien (khong ca ngay). */
export function eventTime(e: TodayEvent): string {
  if (e.allDay) return '';
  const m = /T(\d{2}):(\d{2})/.exec(e.start);
  return m ? `${m[1]}:${m[2]}` : '';
}

/** Cau doc tom tat (TTS): ngan, tu nhien, bo phan khong co du lieu. */
export function briefingText(b: BriefingInput): string {
  const parts: string[] = [b.greet + '.'];
  if (b.wx) {
    let s = `Hôm nay ${b.wx.name ? 'ở ' + b.wx.name + ' ' : ''}${wxText(b.wx.code)}, ${Math.round(b.wx.t)} độ`;
    if (b.wx.pp != null && b.wx.pp >= 40) s += `, khả năng mưa ${b.wx.pp} phần trăm, nhớ mang áo mưa`;
    parts.push(s + '.');
  }
  if (b.events.length) {
    const ev = b.events.slice(0, 3).map((e) => (eventTime(e) ? `${e.title} lúc ${eventTime(e).replace(':', ' giờ ')}` : e.title));
    parts.push(`Lịch hôm nay: ${ev.join('; ')}.`);
  }
  if (b.todos.length) parts.push(`Có ${b.todos.length} việc cần làm, gồm ${b.todos.slice(0, 3).join(', ')}.`);
  if (b.notes.length) parts.push(`Ghi chú: ${b.notes[0]}.`);
  return parts.join(' ');
}
