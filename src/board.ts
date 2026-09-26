// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) BANG TIN GIA DINH: ghi chu ngan dung chung moi man hinh ("Con nho mang ao mua", "Me ve muon").
// Viet tren panel (ung dung Bang tin) hoac gui tu Home Assistant / dien thoai (POST /board, nhu /notify). Luu
// /data/rwv-board.json (ben qua cap nhat addon). Toi da 30 ghi chu; ghi chu ghim khong bi day ra.
import fs from 'node:fs';
import path from 'node:path';

export const BOARD_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;
export type BoardColor = typeof BOARD_COLORS[number];
export interface BoardNote { id: number; text: string; by: string; color: BoardColor; ts: number; pin: boolean }
export const BOARD_MAX = 30;

export function parseNote(body: any): { ok: true; note: Omit<BoardNote, 'id' | 'ts' | 'pin'> & { pin?: boolean } } | { ok: false; error: string } {
  const text = typeof body?.text === 'string' ? body.text.replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, 280) : '';
  if (!text) return { ok: false, error: 'can text' };
  const by = typeof body?.by === 'string' ? body.by.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) : '';
  const color: BoardColor = BOARD_COLORS.includes(body?.color) ? body.color : 'yellow';
  return { ok: true, note: { text, by, color, pin: body?.pin === true } };
}

export class BoardStore {
  private notes: BoardNote[] = [];
  private nextId = 1;
  constructor(private file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(j)) this.notes = j.filter((n) => n && typeof n.id === 'number' && typeof n.text === 'string');
      this.nextId = Math.max(0, ...this.notes.map((n) => n.id)) + 1;
    } catch { /* chua co file */ }
  }
  list(): BoardNote[] {
    return [...this.notes].sort((a, b) => Number(b.pin) - Number(a.pin) || b.ts - a.ts);
  }
  add(n: Omit<BoardNote, 'id' | 'ts' | 'pin'> & { pin?: boolean }, now = Date.now()): BoardNote {
    const note: BoardNote = { id: this.nextId++, text: n.text, by: n.by, color: n.color, pin: !!n.pin, ts: now };
    this.notes.push(note);
    // Qua gioi han: bo ghi chu cu nhat KHONG ghim
    while (this.notes.length > BOARD_MAX) {
      const old = this.notes.filter((x) => !x.pin).sort((a, b) => a.ts - b.ts)[0];
      if (!old) break;
      this.notes = this.notes.filter((x) => x !== old);
    }
    this.save();
    return note;
  }
  remove(id: number): boolean {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.notes.length !== before) this.save();
    return this.notes.length !== before;
  }
  pin(id: number, on: boolean): boolean {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return false;
    n.pin = on; this.save();
    return true;
  }
  private save(): void {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.notes)); } catch { /* bo qua */ }
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
export const board = new BoardStore(process.env.BOARD_FILE || path.join(DATA_DIR, 'rwv-board.json'));
