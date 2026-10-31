// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (05/12/2026) BO DEM NHIP 20 ms/khung (src/audioPacer.ts) — kiem tra bang DONG HO GIA, khong can thiet bi:
//   - khung den thanh tung dot -> ra deu MOT khung moi 20 ms (khong bun no);
//   - hang doi co tran: khung cu nhat bi bo, do tre khong tich luy;
//   - tran bufferedAmount: socket nghen -> bo khung thay vi day them;
//   - `pace: false` (A/B, CCR_CALL_PACE=0) -> gui ngay nhu hanh vi cu;
//   - `send()` tra false -> tinh la `dropped` (truoc day khung bi bo im lang, khong ai biet).
import { describe, expect, it } from 'vitest';

import { FramePacer, FRAME_BYTES, type PacerOptions } from './audioPacer.js';

interface Harness {
  pacer: FramePacer;
  sent: { at: number; bytes: number }[];
  dropped: string[];
  advance: (ms: number) => void;
  t: () => number;
  backlog: (v: number) => void;
  sendOk: (v: boolean) => void;
}

/** Dong ho gia + hang doi hen gio gia: chay dung thu tu thoi gian, khong phu thuoc toc do may. */
function harness(opts: Partial<PacerOptions> = {}): Harness {
  let t = 0;
  let backlog = 0;
  let sendOk = true;
  const timers: { at: number; fn: () => void }[] = [];
  const sent: { at: number; bytes: number }[] = [];
  const dropped: string[] = [];
  const pacer: FramePacer = new FramePacer({
    send: (_dev, frame) => { if (sendOk) sent.push({ at: t, bytes: frame.length }); return sendOk; },
    backlog: () => backlog,
    now: () => t,
    setTimeout: (fn, ms) => { const id = { at: t + ms, fn }; timers.push(id); return id; },
    clearTimeout: (id) => { const i = timers.indexOf(id as { at: number; fn: () => void }); if (i >= 0) timers.splice(i, 1); },
    onDrop: (_dev, reason) => { dropped.push(reason); },
    ...opts,
  });
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const n = timers[0];
      if (!n || n.at > end) break;
      timers.shift();
      t = n.at;
      n.fn();
    }
    t = end;
  };
  return { pacer, sent, dropped, advance, t: () => t, backlog: (v) => { backlog = v; }, sendOk: (v) => { sendOk = v; } };
}

const frame = (fill = 1): Buffer => Buffer.alloc(FRAME_BYTES, fill);

describe('audioPacer — nhip 20 ms', () => {
  it('5 khung push MOT LAN -> gui tai 0, 20, 40, 60, 80 ms (khong bun no)', () => {
    const h = harness({ maxQueueFrames: 5 });
    for (let i = 0; i < 5; i++) h.pacer.push('p4', frame());
    h.advance(200);
    expect(h.sent.map((s) => s.at)).toEqual([0, 20, 40, 60, 80]);
    expect(h.pacer.stats('p4')).toEqual({ frames: 5, dropped: 0, queued: 0 });
  });

  it('mot goi 40 ms (1280 byte = 2 khung) -> trai thanh 0 ms va 20 ms', () => {
    const h = harness();
    h.pacer.push('p4', Buffer.alloc(2 * FRAME_BYTES, 7));
    h.advance(100);
    expect(h.sent.map((s) => s.at)).toEqual([0, 20]);
    expect(h.sent.every((s) => s.bytes === FRAME_BYTES)).toBe(true);   // LUON 640 byte/goi
  });

  it('khung den lien tuc moi 20 ms -> ra dung nhip 20 ms, khong trech', () => {
    const h = harness();
    for (let k = 0; k < 10; k++) { h.pacer.push('p4', frame()); h.advance(20); }
    h.advance(100);
    expect(h.sent.map((s) => s.at)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
    expect(h.pacer.stats('p4').dropped).toBe(0);
  });

  it('toi da 2 khung moi nhip khi bi tre (khong xa ca hang loat)', () => {
    const h = harness({ maxQueueFrames: 10 });
    for (let i = 0; i < 10; i++) h.pacer.push('p4', frame());
    h.advance(20);
    // Nhip 0 ms: 1 khung; nhip 20 ms: bu them 1 khung (toi da 2) -> khong bao gio 3+.
    const first = h.sent.filter((s) => s.at === 0).length;
    const second = h.sent.filter((s) => s.at === 20).length;
    expect(first).toBe(1);
    expect(second).toBeLessThanOrEqual(2);
  });

  it('im lang lau roi phat lai -> khung dau di NGAY, khong bu 20 khung cu', () => {
    const h = harness();
    h.pacer.push('p4', frame());
    h.advance(500);
    h.pacer.push('p4', frame());
    h.advance(100);
    expect(h.sent.map((s) => s.at)).toEqual([0, 500]);
  });
});

describe('audioPacer — tran hang doi va tran bufferedAmount', () => {
  it('hang doi toi da `maxQueueFrames` khung: khung CU NHAT bi bo, do tre khong tich luy', () => {
    const h = harness({ maxQueueFrames: 3 });
    for (let i = 0; i < 10; i++) h.pacer.push('p4', frame(i + 1));
    const st = h.pacer.stats('p4');
    expect(st.queued).toBe(3);
    expect(st.dropped).toBe(7);
    expect(h.dropped).toEqual(Array(7).fill('queue'));
  });

  it('mac dinh: hang doi 5 khung = 100 ms do tre toi da', () => {
    const h = harness();
    for (let i = 0; i < 12; i++) h.pacer.push('p4', frame());
    expect(h.pacer.stats('p4')).toMatchObject({ queued: 5, dropped: 7 });
  });

  it('socket nghen (bufferedAmount > tran) -> bo khung, khong gui them', () => {
    const h = harness({ maxBacklogBytes: 1024 });
    h.backlog(4096);
    for (let i = 0; i < 3; i++) h.pacer.push('p4', frame());
    h.advance(200);
    expect(h.sent).toEqual([]);
    expect(h.pacer.stats('p4')).toMatchObject({ frames: 0, dropped: 3 });
    // Nghen xong (bufferedAmount tut xuong) -> chay lai binh thuong
    h.backlog(0);
    h.pacer.push('p4', frame());
    h.advance(50);
    expect(h.sent.length).toBe(1);
  });

  it('`send()` tra false (khong co client / socket dong) -> tinh la dropped', () => {
    const h = harness();
    h.sendOk(false);
    h.pacer.push('p4', frame());
    h.advance(50);
    expect(h.pacer.stats('p4')).toMatchObject({ frames: 0, dropped: 1 });
    expect(h.dropped).toEqual(['send']);
  });

  it('reset() xoa hang doi + hen gio (ket thuc cuoc goi khong con khung cu)', () => {
    const h = harness();
    for (let i = 0; i < 3; i++) h.pacer.push('p4', frame());
    h.pacer.reset('p4');                               // huy TRUOC khi hen gio kip chay -> khong khung nao di
    h.advance(200);
    expect(h.sent).toEqual([]);
    expect(h.pacer.stats('p4')).toEqual({ frames: 0, dropped: 0, queued: 0 });
  });
});

describe('audioPacer — che do khong pace (A/B: CCR_CALL_PACE=0)', () => {
  it('push 3 khung -> gui NGAY ca 3 trong cung mot thoi diem (hanh vi CU)', () => {
    const h = harness({ pace: false });
    for (let i = 0; i < 3; i++) h.pacer.push('p4', frame());
    expect(h.sent.map((s) => s.at)).toEqual([0, 0, 0]);
    expect(h.pacer.stats('p4')).toMatchObject({ frames: 3, dropped: 0 });
  });
});
