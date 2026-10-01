// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/10/2026) AM THANH KIEU DIEN THOAI — ba loai am luong cua moi man hinh:
//   Media     : moi am thanh trang web/ung dung (YouTube, nhac, radio, video Thu vien/Tin nhan, tin nhan thoai...) — chinh
//               la "Am luong Video Web" cua firmware (DeviceControl Volume, thanh truot san co). "Im lang" chi tat loai nay.
//   Thong bao : chuong tin nhan / thong bao HA / Bang tin, chuong cua, loi doc TTS cua HA, tro ly giong noi.
//   Bao thuc  : bao thuc, het gio Hen gio, canh bao khan (priority critical).
//   Khong lam phien: IM LANG HOAN TOAN thong bao + bao thuc + canh bao khan (firmware tu chan, ke ca TTS HA).
// Firmware co ?snd=1 tu phat cac am nay (tep nhung) theo loai -> khong con phu thuoc luong am thanh trang web (tat media
// van nghe chuong). Firmware cu / man khong loa: giu cach cu (WebAudio trong Shell, theo am luong media).
import fs from 'node:fs';
import path from 'node:path';

/** Gia tri DeviceControl PlaySound (khop on_play_sound cua firmware). */
export enum Sound {
  Stop = 0,
  Notify = 1,
  NotifyHigh = 2,
  Critical = 3,
  Alarm = 4,
  AlarmStop = 5,
  Doorbell = 6,
  TestNotify = 7,
  TestAlarm = 8,
}

export interface SoundPrefs { alert: number; alarm: number }
export const SOUND_DEFAULTS: SoundPrefs = { alert: 60, alarm: 80 };
/** Bao thuc toi thieu 20% (khop firmware) — khong vo tinh keo ve 0 roi lo bao thuc. */
export const ALARM_MIN = 20;

/** Am cho mot thong bao (null = khong keu). Tin nhan -> chuong thuong; high -> chuong uu tien; critical -> canh bao khan. */
export function soundForNotice(n: { priority: string; app?: string }): Sound | null {
  if (n.priority === 'critical') return Sound.Critical;
  if (n.app === 'chat') return Sound.Notify;
  if (n.priority === 'high') return Sound.NotifyHigh;
  return null;  // normal: chi hien the, khong keu (nhu truoc)
}

const clamp = (v: unknown, lo: number) => Math.max(lo, Math.min(100, Math.round(Number(v))));

export class SoundPrefsStore {
  private m: Record<string, SoundPrefs> = {};
  constructor(private file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(j as Record<string, SoundPrefs>)) this.m[k] = this.norm(v);
    } catch { /* chua co */ }
  }
  private norm(v: Partial<SoundPrefs> | undefined): SoundPrefs {
    return {
      alert: Number.isFinite(Number(v?.alert)) ? clamp(v!.alert, 0) : SOUND_DEFAULTS.alert,
      alarm: Number.isFinite(Number(v?.alarm)) ? clamp(v!.alarm, ALARM_MIN) : SOUND_DEFAULTS.alarm,
    };
  }
  get(id: string): SoundPrefs { return this.m[id] ?? { ...SOUND_DEFAULTS }; }
  set(id: string, patch: Partial<SoundPrefs>): SoundPrefs {
    const v = this.norm({ ...this.get(id), ...patch });
    this.m[id] = v;
    if (this.file) fs.promises.writeFile(this.file, JSON.stringify(this.m)).catch(() => { });
    return v;
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const soundPrefs = new SoundPrefsStore(process.env.SOUND_FILE || path.join(DATA_DIR, 'rwv-sound.json'));
