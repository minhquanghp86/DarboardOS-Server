// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from 'vitest';
import { ChatStore, MAX_MSGS, canSee, clean, type Author } from './chat.js';

const ha: Author = { side: 'ha', id: 'u1', name: 'Quang' };
const ha2: Author = { side: 'ha', id: 'u2', name: 'Lan' };
const p4: Author = { side: 'screen', id: 'esp32-p4', name: 'P4' };
const s3: Author = { side: 'screen', id: 'esp32-s3', name: 'S3' };

describe('ChatStore', () => {
  it('man hinh chi thay cuoc tro chuyen co minh (hoac moi man hinh); HA thay het', () => {
    const st = new ChatStore();
    const a = st.create(ha, 'P4', ['esp32-p4'], false);
    const b = st.create(ha, 'Tat ca', [], true);
    expect(st.listFor(p4).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(st.listFor(s3).map((c) => c.id)).toEqual([b.id]);
    expect(st.listFor(ha2)).toHaveLength(2);
    expect(canSee(a, s3)).toBe(false);
  });

  it('man hinh tao cuoc tro chuyen: tu co mat', () => {
    const st = new ChatStore();
    const c = st.create(p4, '', ['esp32-s3'], false);
    expect(c.members.sort()).toEqual(['esp32-p4', 'esp32-s3']);
  });

  it('chua doc: dem tin cua nguoi khac; moi nguoi dung HA dung chung phia "ha"', () => {
    const st = new ChatStore();
    const c = st.create(ha, '', ['esp32-p4'], false);
    st.add(c, ha, 'xin chao', undefined, 1);
    st.add(c, ha2, 'an com chua', undefined, 2);
    expect(st.unread(c, p4)).toBe(2);
    expect(st.unread(c, ha)).toBe(0);
    st.add(c, p4, 'roi', undefined, 3);
    expect(st.unread(c, ha)).toBe(1);
    expect(st.unread(c, p4)).toBe(0);
    st.markRead(c, ha2, 99);
    expect(st.unread(c, ha)).toBe(0);
  });

  it('xoa cuoc tro chuyen va tin vuot gioi han: bao tep mo coi', () => {
    const st = new ChatStore();
    const orphans: string[] = [];
    st.onOrphans = (f) => orphans.push(...f);
    const c = st.create(ha, '', ['esp32-p4'], false);
    st.add(c, ha, '', { kind: 'image', file: 'a.jpg', thumb: 'a_t.jpg', mime: 'image/jpeg', size: 1 });
    for (let i = 0; i < MAX_MSGS; i++) st.add(c, ha, 'x' + i, undefined);
    expect(c.msgs).toHaveLength(MAX_MSGS);
    expect(orphans).toEqual(['a.jpg', 'a_t.jpg']);
    st.add(c, ha, '', { kind: 'video', file: 'b.mp4', mime: 'video/mp4', size: 1 });
    st.remove(c);
    expect(orphans).toContain('b.mp4');
    expect(st.listFor(ha)).toHaveLength(0);
  });

  it('man hinh chi xoa duoc tin cua minh; HA xoa duoc moi tin', () => {
    const st = new ChatStore();
    const c = st.create(ha, '', ['esp32-p4', 'esp32-s3'], false);
    const m1 = st.add(c, s3, 'cua S3', undefined);
    expect(() => st.delMsg(c, m1.id, p4)).toThrow();
    expect(st.delMsg(c, m1.id, ha)).toBe(true);
    const m2 = st.add(c, p4, 'cua P4', undefined);
    expect(st.delMsg(c, m2.id, p4)).toBe(true);
  });

  it('tin trong bi tu choi; chu duoc lam sach', () => {
    const st = new ChatStore();
    const c = st.create(ha, '', ['esp32-p4'], false);
    expect(() => st.add(c, ha, '   ', undefined)).toThrow();
    expect(clean('a\u0000b\n\n\n\nc', 100, true)).toBe('a b\n\nc');
    expect(clean('ten\nmoi', 100)).toBe('ten moi');
  });
});
