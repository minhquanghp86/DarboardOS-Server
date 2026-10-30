// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (GD3) `?call=` / `&phone=` cua call-web.html (public/call-join.js): app Android mo trang sau khi bam "Nghe" nen
// trang phai doc DUNG tham so va suy ra DUNG id may de gui {type:'join'} len server.
import { describe, expect, it } from 'vitest';
import '../public/call-join.js';

const CJ = (globalThis as unknown as { RwvCallJoin: Record<string, any> }).RwvCallJoin;

describe('call-join.js — tham so URL cua trang goi', () => {
  it('doc ?call= va &phone= (cat khoang trang hai dau)', () => {
    expect(CJ.parse('?call=abc123&phone=phone-1')).toEqual({ call: 'abc123', phone: 'phone-1' });
    expect(CJ.parse('?call=%20abc%20123%20&phone=%20p1%20')).toEqual({ call: 'abc 123', phone: 'p1' });
  });

  it('khong co ?call= -> rong (trang giu nguyen danh ba nhu cu)', () => {
    expect(CJ.parse('')).toEqual({ call: '', phone: '' });
    expect(CJ.parse('?phone=phone-1')).toEqual({ call: '', phone: 'phone-1' });
    expect(CJ.parse(undefined)).toEqual({ call: '', phone: '' });
  });

  it('?call= nhung khong co &phone= -> lay id may tu /calls/state (to = dien thoai)', () => {
    expect(CJ.phoneOf({ state: 'active', from: 'p4-bep', to: 'phone-abc', phone: '' }, '')).toBe('phone-abc');
  });

  it('sau khi join (to = phien web web-…) -> lay id may o truong phone cua server', () => {
    expect(CJ.phoneOf({ state: 'active', from: 'p4-bep', to: 'web-xyz', phone: 'phone-abc' }, '')).toBe('phone-abc');
    expect(CJ.phoneOf({ state: 'active', from: 'p4-bep', to: 'web-xyz' }, '')).toBe('');
  });

  it('&phone= tren URL thang tat ca (app da biet may nao)', () => {
    expect(CJ.phoneOf({ state: 'active', to: 'web-xyz', phone: 'phone-abc' }, 'phone-tu-url')).toBe('phone-tu-url');
    expect(CJ.phoneOf(null, 'phone-tu-url')).toBe('phone-tu-url');
    expect(CJ.phoneOf(null, '')).toBe('');
  });

  it('ten nguoi goi = ben `from` (dien thoai la ben nhan)', () => {
    expect(CJ.peerOf({ from: 'p4-bep', fromName: 'Màn hình bếp', to: 'phone-abc' })).toEqual({ peer: 'p4-bep', name: 'Màn hình bếp' });
    expect(CJ.peerOf(null)).toEqual({ peer: '', name: '' });
  });
});
