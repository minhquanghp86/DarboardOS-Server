// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-5) THONG BAO tu Home Assistant (chuong cua, canh bao, nhac viec...) toi panel.
// HA goi POST /notify (rest_command, xem DOCS.md) -> server luu lich su theo TUNG man hinh va hien the noi tren Shell.
// Muc uu tien:
//   normal   — the noi tu an (8 s); KHONG hien khi Khong lam phien (van vao lich su).
//   high     — bat sang man hinh + chuong ngan, the giu 20 s; KHONG hien khi Khong lam phien.
//   critical — (chuong cua, bao chay...) bat sang + chuong, the giu toi khi cham, hien CA KHI Khong lam phien.

export type Priority = 'normal' | 'high' | 'critical';

export interface Notice {
  id: number;
  title: string;
  message: string;
  priority: Priority;
  /** Thoi diem nhan (ms epoch). */
  ts: number;
  /** Cham vao the: mo ung dung trong menu (vd 'cams') ... */
  app?: string;
  /** ... hoac mo URL nay. */
  url?: string;
  /** Anh kem theo (vd anh chup camera cong qua go2rtc). */
  image?: string;
  /** (02/10/2026) Tham so cho ung dung `app` khi cham (vd id cuoc tro chuyen cua Tin nhan). */
  arg?: string;
}

export interface NotifyRequest {
  title?: unknown; message?: unknown; priority?: unknown; device?: unknown; app?: unknown; url?: unknown;
  image?: unknown; camera?: unknown; arg?: unknown;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Kiem tra/chuan hoa yeu cau tu HA. Tra ve loi (chuoi) neu khong hop le. `go2rtc` = dia chi go2rtc de dung anh tu ten
 * luong camera (truong `camera`).
 */
export function parseNotify(body: NotifyRequest, go2rtc: string):
  { ok: true; device: string; notice: Omit<Notice, 'id' | 'ts'> } | { ok: false; error: string } {
  const title = str(body.title, 80), message = str(body.message, 300);
  if (!title && !message) return { ok: false, error: 'can title hoac message' };
  const pr = str(body.priority, 10);
  const priority: Priority = pr === 'high' || pr === 'critical' ? pr : 'normal';
  const url = str(body.url, 1024);
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: 'url phai la http(s)' };
  let image = str(body.image, 1024);
  if (image && !/^https?:\/\//i.test(image)) return { ok: false, error: 'image phai la http(s)' };
  const camera = str(body.camera, 64);
  if (!image && camera) {
    if (!/^[\w.-]+$/.test(camera)) return { ok: false, error: 'ten camera khong hop le' };
    image = `${go2rtc.replace(/\/$/, '')}/api/frame.jpeg?src=${encodeURIComponent(camera)}`;
  }
  const app = str(body.app, 40);
  const arg = app ? str(body.arg, 64) : '';
  return {
    ok: true,
    device: str(body.device, 64) || 'all',
    notice: { title, message, priority, ...(app ? { app } : {}), ...(arg ? { arg } : {}), ...(url ? { url } : {}), ...(image ? { image } : {}) },
  };
}

/** Co hien the noi khong (luon vao lich su du hien hay khong). */
export function shouldPopup(n: Pick<Notice, 'priority'>, dnd: boolean): boolean {
  return !dnd || n.priority === 'critical';
}

/** Co bat sang man hinh (va keu chuong) khong. */
export function shouldWake(n: Pick<Notice, 'priority'>, dnd: boolean): boolean {
  return n.priority === 'critical' || (n.priority === 'high' && !dnd);
}

/** Lich su thong bao cua MOT man hinh: toi da `max` muc, moi nhat truoc. */
export class NoticeStore {
  private items: Notice[] = [];
  private nextId = 1;
  constructor(private max = 30) { }

  add(n: Omit<Notice, 'id' | 'ts'>, now = Date.now()): Notice {
    const full: Notice = { ...n, id: this.nextId++, ts: now };
    this.items.unshift(full);
    if (this.items.length > this.max) this.items.length = this.max;
    return full;
  }
  get(id: number): Notice | undefined { return this.items.find((n) => n.id === id); }
  remove(id: number): void { this.items = this.items.filter((n) => n.id !== id); }
  clear(): void { this.items = []; }
  /** `limit` muc moi nhat — gui xuong Shell (giu goi trang thai nho). */
  list(limit = 10): Notice[] { return this.items.slice(0, limit); }
  get size(): number { return this.items.length; }
}
