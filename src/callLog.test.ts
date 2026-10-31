// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/12/2026) So nhat ky cuoc goi (src/callLog.ts) — phan THUAN luu tru, khong mang:
//   - anh xa LY DO KET THUC -> trang thai (Từ chối / Không trả lời / Đã kết thúc / Mất kết nối);
//   - mot cuoc goi = 2 muc (dir in/out theo tung ben), `byMe` dung ben cup may;
//   - chi tra muc DA KET THUC, moi nhat truoc, loc theo `self`;
//   - GIOI HAN 200 muc gan nhat (file /data/rwv-call-log.json);
//   - ghi ra file roi nap lai duoc (giu nguyen du lieu qua lan khoi dong sau).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CallLog, MAX_ITEMS, outcomeOf, type CallSide } from './callLog.js';

const PANEL: CallSide = { id: 'p4-bep', kind: 'panel', name: 'Màn hình bếp' };
const WEB: CallSide = { id: 'web-abcdef12', kind: 'web', name: 'Samsung · Chrome' };
const PHONE: CallSide = { id: 'phone-abc123', kind: 'phone', name: 'Pixel 8 · Điện thoại' };

let dirs: string[] = [];
function tmpFile(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-calllog-'));
  dirs.push(d);
  return path.join(d, 'rwv-call-log.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('outcomeOf — ly do ket thuc -> trang thai nhat ky', () => {
  it('Từ chối -> declined', () => {
    expect(outcomeOf('Từ chối', false)).toBe('declined');
  });
  it('Không trả lời (het RING_S) -> missed', () => {
    expect(outcomeOf('Không trả lời', false)).toBe('missed');
  });
  it('Đã kết thúc -> answered khi da nghe, cancelled khi chua kip nghe', () => {
    expect(outcomeOf('Đã kết thúc', true)).toBe('answered');
    expect(outcomeOf('Đã kết thúc', false)).toBe('cancelled');
  });
  it('Mất kết nối -> failed (ke ca khi da nghe)', () => {
    expect(outcomeOf('Mất kết nối', false)).toBe('failed');
    expect(outcomeOf('Mất kết nối', true)).toBe('failed');
  });
  it('Máy bận. / Không liên lạc được. -> failed', () => {
    expect(outcomeOf('Máy bận.', false)).toBe('failed');
    expect(outcomeOf('Không liên lạc được.', false)).toBe('failed');
  });
});

describe('mot cuoc goi = hai muc (dir theo tung ben)', () => {
  it('start() tao muc out/in; accept() ghi startedAt; finish() ghi thoi luong + ai cup', () => {
    const log = new CallLog(null);
    log.open('c1', PANEL, PHONE, 1_000);

    // Dang do chuong -> chua co gi trong nhat ky (trang da tu hien cuoc goi dang chay).
    expect(log.list(PANEL.id)).toHaveLength(0);

    log.answered('c1', 2_000);
    log.finish('c1', 'Đã kết thúc', PANEL.id, 44_500);

    const mine = log.list(PANEL.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: 'c1', self: PANEL.id, dir: 'out', peerId: PHONE.id, peerName: 'Pixel 8 · Điện thoại', peerKind: 'phone',
      startedAt: 2_000, endedAt: 44_500, durationMs: 42_500, state: 'answered', byMe: true,
    });

    const theirs = log.list(PHONE.id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({
      id: 'c1', self: PHONE.id, dir: 'in', peerId: PANEL.id, peerName: 'Màn hình bếp', peerKind: 'panel',
      durationMs: 42_500, state: 'answered', byMe: false,
    });
    expect(log.size()).toBe(2);
  });

  it('tu choi truoc khi nghe: byMe = ben bam tu choi, durationMs = 0', () => {
    const log = new CallLog(null);
    log.open('c2', WEB, PHONE, 1_000);
    log.finish('c2', 'Từ chối', PHONE.id, 3_000);

    expect(log.list(WEB.id)[0]).toMatchObject({ dir: 'out', state: 'declined', byMe: false, startedAt: 0, durationMs: 0 });
    expect(log.list(PHONE.id)[0]).toMatchObject({ dir: 'in', state: 'declined', byMe: true });
  });

  it('het gio (khong ai bam) -> byMe false o CA HAI muc', () => {
    const log = new CallLog(null);
    log.open('c3', PANEL, WEB);
    log.finish('c3', 'Không trả lời');
    expect(log.list(PANEL.id)[0]).toMatchObject({ state: 'missed', byMe: false });
    expect(log.list(WEB.id)[0]).toMatchObject({ state: 'missed', byMe: false });
  });

  it('moi nhat truoc + loc theo self + ton trong limit', () => {
    const log = new CallLog(null);
    for (let i = 0; i < 3; i++) {
      log.open('c' + i, WEB, PANEL);
      log.finish('c' + i, 'Đã kết thúc');
    }
    expect(log.list(WEB.id).map((i) => i.id)).toEqual(['c2', 'c1', 'c0']);
    expect(log.list(WEB.id, 2).map((i) => i.id)).toEqual(['c2', 'c1']);
    expect(log.list()).toHaveLength(6);                    // self rong = tat ca muc da ket thuc
  });
});

describe('gioi han 200 muc gan nhat', () => {
  it('400 muc (200 cuoc goi) -> chi giu 200 muc MOI NHAT', () => {
    const log = new CallLog(null);
    for (let i = 0; i < 200; i++) {
      log.open('c' + i, WEB, PANEL);
      log.finish('c' + i, 'Đã kết thúc');
    }
    expect(log.size()).toBe(MAX_ITEMS);
    expect(MAX_ITEMS).toBe(200);
    // Muc moi nhat con, muc cu nhat da bi day ra.
    expect(log.list(WEB.id)[0].id).toBe('c199');
    expect(log.list(WEB.id).some((i) => i.id === 'c0')).toBe(false);
  });
});

describe('ghi / nap file (/data/rwv-call-log.json)', () => {
  it('ghi file roi nap lai: giu nguyen muc va bo muc dang do chuong', () => {
    const file = tmpFile();
    const log = new CallLog(file);
    log.open('c1', PANEL, WEB, 10);
    log.answered('c1', 20);
    log.finish('c1', 'Đã kết thúc', WEB.id, 1_020);
    log.open('c2', PANEL, PHONE, 2_000);                    // con dang do chuong -> khong duoc ghi thanh muc "xong"

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.filter((i: any) => i.id === 'c1')).toHaveLength(2);
    expect(raw.filter((i: any) => i.id === 'c2')).toHaveLength(2);   // muc tam co trong file...

    const again = new CallLog(file);
    expect(again.list().map((i) => i.id)).toEqual(['c1', 'c1']);     // ...nhung KHONG tra ra sau khi nap
    expect(again.list(WEB.id)[0]).toMatchObject({ durationMs: 1_000, state: 'answered', byMe: true });
  });
});
