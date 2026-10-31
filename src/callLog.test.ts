// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (01/12/2026) So nhat ky cuoc goi (src/callLog.ts) — phan THUAN luu tru, khong mang:
//   - anh xa LY DO KET THUC -> trang thai (Từ chối / Không trả lời / Đã kết thúc / Mất kết nối);
//   - (03/12/2026) MOT cuoc goi = MOT BAN GHI (`from`/`to`), API `list(self)` PROJECT thanh muc cua dung thiet bi
//     (`dir` theo `self`, `peer` = ben kia) — khong con 2 muc de lech/nhan doi;
//   - `durationMs` CHI khi `state === 'answered'` (missed/declined = 0);
//   - `alias()`: id may dien thoai <-> id phien web cua cung mot thiet bi (loi "chi hien chieu goi di");
//   - chi tra muc DA KET THUC, moi nhat truoc, loc theo `self`;
//   - GIOI HAN 200 cuoc goi gan nhat (file /data/rwv-call-log.json);
//   - ghi ra file roi nap lai duoc; DOC DUOC ca file dinh dang CU (2 muc/cuoc) de nang cap khong mat lich su.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CallLog, MAX_ITEMS, outcomeOf, type CallSide } from './callLog.js';

const PANEL: CallSide = { id: 'p4-bep', kind: 'panel', name: 'Màn hình bếp' };
const WEB: CallSide = { id: 'web-abcdef12', kind: 'web', name: 'Samsung · Chrome' };
const PHONE: CallSide = { id: 'phone-abc123', kind: 'phone', name: 'Pixel 8 · Điện thoại' };
const PAGE = 'web-phone-page';                          // phien web cua trang call-web.html?call= cua PHONE

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

describe('mot cuoc goi = MOT ban ghi, project theo self', () => {
  it('nghe roi ket thuc: ben goi out + ben nhan in, cung thoi luong', () => {
    const log = new CallLog(null);
    log.open('c1', PANEL, PHONE, 1_000);

    // Dang do chuong -> chua co gi trong nhat ky (trang da tu hien cuoc goi dang chay).
    expect(log.list(PANEL.id)).toHaveLength(0);

    log.answered('c1', 2_000);
    log.finish('c1', 'Đã kết thúc', PANEL.id, 44_500);

    const mine = log.list(PANEL.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({
      id: 'c1', self: PANEL.id, dir: 'out', peerId: PHONE.id, peerName: 'Pixel 8 · Điện thoại', peerKind: 'phone',
      startedAt: 2_000, endedAt: 44_500, durationMs: 42_500, state: 'answered', byMe: true, ts: 1_000,
    });

    const theirs = log.list(PHONE.id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({
      id: 'c1', self: PHONE.id, dir: 'in', peerId: PANEL.id, peerName: 'Màn hình bếp', peerKind: 'panel',
      startedAt: 2_000, endedAt: 44_500, durationMs: 42_500, state: 'answered', byMe: false,
    });

    // MOT cuoc goi chi chiem MOT cho (truoc day la 2 muc).
    expect(log.size()).toBe(1);
  });

  it('tu choi truoc khi nghe: byMe chi o ben bam tu choi, durationMs = 0', () => {
    const log = new CallLog(null);
    log.open('c2', WEB, PHONE, 1_000);
    log.finish('c2', 'Từ chối', PHONE.id, 3_000);

    expect(log.list(WEB.id)[0]).toMatchObject({ dir: 'out', state: 'declined', byMe: false, startedAt: 0, durationMs: 0 });
    expect(log.list(PHONE.id)[0]).toMatchObject({ dir: 'in', state: 'declined', byMe: true, durationMs: 0 });
  });

  it('het gio (khong ai bam) -> missed, durationMs 0, byMe false o CA HAI ben', () => {
    const log = new CallLog(null);
    log.open('c3', PANEL, WEB);
    log.finish('c3', 'Không trả lời');
    expect(log.list(PANEL.id)[0]).toMatchObject({ dir: 'out', state: 'missed', byMe: false, durationMs: 0 });
    expect(log.list(WEB.id)[0]).toMatchObject({ dir: 'in', state: 'missed', byMe: false, durationMs: 0 });
  });

  it('durationMs = 0 khi KHONG phai answered (da nghe nhung mat ket noi)', () => {
    const log = new CallLog(null);
    log.open('c4', WEB, PANEL, 1_000);
    log.answered('c4', 2_000);
    log.finish('c4', 'Mất kết nối', '', 9_000);
    expect(log.list(WEB.id)[0]).toMatchObject({ state: 'failed', startedAt: 2_000, endedAt: 9_000, durationMs: 0 });
  });

  it('alias(): id may va id phien web cua no = CUNG mot thiet bi', () => {
    const log = new CallLog(null);
    log.open('c5', PANEL, PHONE, 1_000);
    log.answered('c5', 2_000);
    // Trang call-web.html?call=...&phone=... cua may join -> id phien web
    expect(log.alias('c5', PHONE.id, PAGE)).toBe(true);
    log.finish('c5', 'Đã kết thúc', PAGE, 12_000);         // may cup bang trang web cua no

    // Hoi bang id PHIEN WEB -> van thay muc "gọi đến" (truoc day rong => loi "chi hien chieu goi di").
    const viaPage = log.list(PAGE);
    expect(viaPage).toHaveLength(1);
    expect(viaPage[0]).toMatchObject({ id: 'c5', self: PAGE, dir: 'in', peerId: PANEL.id, peerKind: 'panel', state: 'answered', durationMs: 10_000 });
    // `byMe` dung du `by` la id phien web (server doi ve id may).
    expect(viaPage[0].byMe).toBe(true);
    expect(log.list(PHONE.id)[0]).toMatchObject({ dir: 'in', byMe: true, durationMs: 10_000 });
    expect(log.list(PANEL.id)[0]).toMatchObject({ dir: 'out', byMe: false });
    // alias cua cuoc goi khong ton tai -> false (khong tao rac)
    expect(log.alias('khong-co', PHONE.id, PAGE)).toBe(false);
  });

  it('alias() cung chieu nguoc lai: hoi bang id MAY khi ban ghi dang giu id phien web', () => {
    const log = new CallLog(null);
    log.open('c6', { id: PAGE, kind: 'web', name: 'Pixel 8 · Chrome' }, PANEL, 1_000);
    log.answered('c6', 2_000);
    log.alias('c6', PAGE, PHONE.id);
    log.finish('c6', 'Đã kết thúc', '', 5_000);
    expect(log.list(PHONE.id)[0]).toMatchObject({ id: 'c6', dir: 'out', peerId: PANEL.id, durationMs: 3_000 });
    expect(log.list(PAGE)[0]).toMatchObject({ id: 'c6', dir: 'out' });
  });

  it('list(self, limit, also): id may do trang web TU KHAI luc hoi cung khop (may tu choi tu app, khong join)', () => {
    const log = new CallLog(null);
    log.open('c7', PANEL, PHONE, 1_000);
    log.finish('c7', 'Từ chối', PHONE.id, 3_000);
    // Chua biet id may <-> phien web -> trang khong thay gi.
    expect(log.list(PAGE)).toHaveLength(0);
    // Trang khai `phone` luc mo WS (hello.phone) -> server truyen vao `also` khi hoi.
    const got = log.list(PAGE, 50, [PHONE.id]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: 'c7', self: PAGE, dir: 'in', peerId: PANEL.id, state: 'declined', byMe: true });
    // `self` rong = moi cuoc goi mot lan (khong dung `also`).
    expect(log.list('', 50, [PHONE.id]).map((i) => i.id)).toEqual(['c7']);
    // clear() voi cung `also` -> xoa duoc cuoc goi cua may
    expect(log.clear(PAGE, [PHONE.id])).toBe(1);
    expect(log.list(PHONE.id)).toHaveLength(0);
  });

  it('moi nhat truoc + loc theo self + ton trong limit + self rong = moi cuoc goi MOT lan', () => {
    const log = new CallLog(null);
    for (let i = 0; i < 3; i++) {
      log.open('c' + i, WEB, PANEL, 1_000 + i);
      log.finish('c' + i, 'Đã kết thúc');
    }
    expect(log.list(WEB.id).map((i) => i.id)).toEqual(['c2', 'c1', 'c0']);
    expect(log.list(WEB.id, 2).map((i) => i.id)).toEqual(['c2', 'c1']);
    expect(log.list(PANEL.id).map((i) => i.id)).toEqual(['c2', 'c1', 'c0']);
    expect(log.list(PANEL.id)[0]).toMatchObject({ dir: 'in' });
    expect(log.list().map((i) => i.id)).toEqual(['c2', 'c1', 'c0']);   // self rong: 3 cuoc goi, khong nhan doi
    expect(log.list('may-khong-lien-quan')).toHaveLength(0);
  });
});

describe('clear() — xoa nhat ky (POST /calls/log/clear?self=)', () => {
  it('self=<id>: xoa cac CUOC GOI LIEN QUAN (minh hoac ben kia), giu cuoc khac', () => {
    const log = new CallLog(null);
    log.open('c1', WEB, PANEL); log.finish('c1', 'Đã kết thúc');
    log.open('c2', WEB, PHONE); log.finish('c2', 'Từ chối');
    log.open('c3', PANEL, PHONE); log.finish('c3', 'Đã kết thúc');
    expect(log.size()).toBe(3);

    expect(log.clear(WEB.id)).toBe(2);                    // c1 + c2 (deu lien quan toi WEB)
    expect(log.list(WEB.id)).toHaveLength(0);
    expect(log.list(PANEL.id).map((i) => i.id)).toEqual(['c3']);
    expect(log.list(PHONE.id).map((i) => i.id)).toEqual(['c3']);
    expect(log.clear(WEB.id)).toBe(0);                    // khong con gi -> 0 (idempotent)
  });

  it('self rong: xoa TOAN BO', () => {
    const log = new CallLog(null);
    log.open('c1', WEB, PANEL); log.finish('c1', 'Đã kết thúc');
    log.open('c2', PANEL, PHONE); log.finish('c2', 'Đã kết thúc');
    expect(log.clear('')).toBe(2);
    expect(log.size()).toBe(0);
    expect(log.list()).toHaveLength(0);
  });

  it('xoa bang id THAY THE (phien web cua dien thoai) cung xoa cuoc goi cua may', () => {
    const log = new CallLog(null);
    log.open('c1', PANEL, PHONE); log.alias('c1', PHONE.id, PAGE); log.finish('c1', 'Không trả lời');
    expect(log.clear(PAGE)).toBe(1);
    expect(log.list(PHONE.id)).toHaveLength(0);
  });

  it('xoa ca cuoc goi dang do chuong (chua ket thuc) va ghi lai file', () => {
    const file = tmpFile();
    const log = new CallLog(file);
    log.open('c1', WEB, PANEL);
    log.finish('c1', 'Đã kết thúc');
    log.open('c2', WEB, PANEL);                            // dang do chuong
    expect(log.clear(WEB.id)).toBe(2);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([]);
    expect(new CallLog(file).size()).toBe(0);
  });
});

describe('gioi han 200 cuoc goi gan nhat', () => {
  it('300 cuoc goi -> chi giu 200 cuoc MOI NHAT', () => {
    const log = new CallLog(null);
    for (let i = 0; i < 300; i++) {
      log.open('c' + i, WEB, PANEL, 1_000 + i);
      log.finish('c' + i, 'Đã kết thúc');
    }
    expect(log.size()).toBe(MAX_ITEMS);
    expect(MAX_ITEMS).toBe(200);
    // Muc moi nhat con, muc cu nhat da bi day ra.
    expect(log.list(WEB.id)[0].id).toBe('c299');
    expect(log.list(WEB.id).some((i) => i.id === 'c0')).toBe(false);
  });
});

describe('ghi / nap file (/data/rwv-call-log.json)', () => {
  it('ghi file roi nap lai: giu nguyen ban ghi (ke ca alias) va bo cuoc dang do chuong', () => {
    const file = tmpFile();
    const log = new CallLog(file);
    log.open('c1', PANEL, WEB, 10);
    log.answered('c1', 20);
    log.alias('c1', WEB.id, PHONE.id);
    log.finish('c1', 'Đã kết thúc', WEB.id, 1_020);
    log.open('c2', PANEL, PHONE, 2_000);                    // con dang do chuong -> khong duoc ghi thanh muc "xong"

    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as any[];
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.filter((i) => i.id === 'c1')).toHaveLength(1);        // MOT ban ghi / cuoc goi
    expect(raw.filter((i) => i.id === 'c1')[0].from).toMatchObject({ id: PANEL.id, kind: 'panel' });
    expect(raw.filter((i) => i.id === 'c2')).toHaveLength(1);

    const again = new CallLog(file);
    expect(again.list().map((i) => i.id)).toEqual(['c1']);           // cuoc dang do chuong KHONG tra ra
    expect(again.list(WEB.id)[0]).toMatchObject({ durationMs: 1_000, state: 'answered', byMe: true });
    // alias duoc giu qua lan nap sau
    expect(again.list(PHONE.id)[0]).toMatchObject({ id: 'c1', dir: 'in' });
  });

  it('DOC DUOC file dinh dang CU (2 muc/cuoc) -> gop thanh 1 ban ghi, khong mat lich su', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify([
      { id: 'c1', self: PANEL.id, dir: 'out', peerId: PHONE.id, peerName: 'Pixel 8 · Điện thoại', peerKind: 'phone',
        startedAt: 2_000, endedAt: 44_500, durationMs: 42_500, state: 'answered', byMe: true, ts: 1_000 },
      { id: 'c1', self: PHONE.id, dir: 'in', peerId: PANEL.id, peerName: 'Màn hình bếp', peerKind: 'panel',
        startedAt: 2_000, endedAt: 44_500, durationMs: 42_500, state: 'answered', byMe: false, ts: 1_000 },
      { id: 'c2', self: PANEL.id, dir: 'out', peerId: WEB.id, peerName: 'Samsung · Chrome', peerKind: 'web',
        startedAt: 0, endedAt: 50_000, durationMs: 0, state: 'missed', byMe: false, ts: 2_000 },
    ]));

    const log = new CallLog(file);
    expect(log.size()).toBe(2);                                       // 2 cuoc goi (truoc day 3 muc)
    expect(log.list(PANEL.id).map((i) => i.id)).toEqual(['c2', 'c1']);
    expect(log.list(PANEL.id)[1]).toMatchObject({
      id: 'c1', dir: 'out', peerId: PHONE.id, peerName: 'Pixel 8 · Điện thoại', peerKind: 'phone',
      state: 'answered', durationMs: 42_500, byMe: true,
    });
    expect(log.list(PHONE.id)[0]).toMatchObject({ id: 'c1', dir: 'in', peerId: PANEL.id, peerKind: 'panel', byMe: false });
    // Muc chi co MOT ben (ban ghi cua ben kia da bi xoa) van dung duoc: ben con lai + peer suy ra.
    expect(log.list(WEB.id)[0]).toMatchObject({ id: 'c2', dir: 'in', peerId: PANEL.id, state: 'missed' });
    expect(log.list(PANEL.id)[0]).toMatchObject({ id: 'c2', dir: 'out', peerKind: 'web' });
  });
});
