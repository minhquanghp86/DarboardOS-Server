// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/10/2026) `public/call-browser.js` — phan THUAN cua trang goi trong trinh duyet:
//   - browserLabel(ua): nhan hien thi "<Tên máy> · <trình duyệt>" de danh ba cua man P4 doc duoc ngay
//     ('Samsung · Chrome', 'iPhone · Safari', 'Máy tính · trình duyệt', khong nhan ra -> 'Điện thoại · trình duyệt').
//   - id(store): id BEN VUNG (localStorage['rwv-browser-id'], UUID v4) — mo lai tab / rot mang van cung mot thiet bi.
import { describe, expect, it } from 'vitest';
import '../public/call-browser.js';

interface BrowserApi {
  label(ua: unknown): string;
  browserLabel(ua: unknown): string;
  id(store?: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null): string;
  uuid(): string;
  KEY: string;
}
const CB = (globalThis as unknown as { RwvCallBrowser: BrowserApi }).RwvCallBrowser;

// UA that (rut gon) cua cac may thuong gap.
const UA = {
  samsungChrome: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  xiaomi: 'Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  iPadDeskMode: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  la: 'Mozilla/5.0 (Linux; Android 9; Something) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36',
  lac: 'curl/8.4.0',
};

describe('call-browser.js — nhan hien thi thiet bi (browserLabel)', () => {
  it('dien thoai Samsung + Chrome -> "Samsung · Chrome"', () => {
    expect(CB.label(UA.samsungChrome)).toBe('Samsung · Chrome');
  });

  it('trinh duyet co san cua Samsung -> "Samsung · Samsung Internet" (khong phai Chrome)', () => {
    expect(CB.label(UA.samsungInternet)).toBe('Samsung · Samsung Internet');
  });

  it('iPhone -> "iPhone · Safari"', () => {
    expect(CB.label(UA.iphone)).toBe('iPhone · Safari');
  });

  it('iPad -> "iPad · Safari"', () => {
    expect(CB.label(UA.iPadDeskMode)).toBe('iPad · Safari');
  });

  it('may Android khac nhan ra hang (Xiaomi) -> "Xiaomi · Chrome"', () => {
    expect(CB.label(UA.xiaomi)).toBe('Xiaomi · Chrome');
  });

  it('may tinh -> "Máy tính · trình duyệt"', () => {
    expect(CB.label(UA.windows)).toBe('Máy tính · trình duyệt');
  });

  it('UA la / thieu -> "Điện thoại · trình duyệt" (di dong) va "Máy tính · trình duyệt" (may tinh)', () => {
    expect(CB.label(UA.la)).toBe('Điện thoại · trình duyệt');
    expect(CB.label('')).toBe('Máy tính · trình duyệt');
    expect(CB.label(undefined)).toBe('Máy tính · trình duyệt');
    expect(CB.label(null)).toBe('Máy tính · trình duyệt');
    // UA la nhung KHONG phai di dong -> may tinh (khong doan bua ten may).
    expect(CB.label(UA.lac)).toBe('Máy tính · trình duyệt');
  });

  it('ten hien thi dung dang "<Tên máy> · <trình duyệt>" (co dau phan cach)', () => {
    expect(CB.label(UA.samsungChrome)).toContain(' · ');
    expect(CB.label(UA.samsungChrome).split(' · ')).toHaveLength(2);
    expect(CB.browserLabel(UA.samsungChrome)).toBe(CB.label(UA.samsungChrome));   // cung mot ham thuan
  });
});

describe('call-browser.js — id ben vung cua trinh duyet', () => {
  /** localStorage gia lap (Map) + dem so lan ghi. */
  function store(init?: Record<string, string>) {
    const m = new Map<string, string>(Object.entries(init || {}));
    return {
      m,
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v); },
    };
  }

  it('chua co id -> sinh UUID v4 roi LUU vao store', () => {
    const s = store();
    const id = CB.id(s);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(s.m.get(CB.KEY)).toBe(id);
    expect(CB.KEY).toBe('rwv-browser-id');
  });

  it('mo lai tab (doc lai tu store) -> CUNG mot id (khong sinh id moi)', () => {
    const s = store();
    const first = CB.id(s);
    expect(CB.id(s)).toBe(first);
    expect(CB.id(s)).toBe(first);
  });

  it('id da luu hong / qua ngan / ky tu la -> thay bang id moi hop le', () => {
    for (const bad of ['', 'abc', 'id co dau cach', 'x'.repeat(65), '<script>']) {
      const s = store({ [CB.KEY]: bad });
      const id = CB.id(s);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    }
  });

  it('id do client khac gui (dung dinh dang server) duoc giu nguyen', () => {
    const s = store({ [CB.KEY]: 'browser-0123456789_abc' });
    expect(CB.id(s)).toBe('browser-0123456789_abc');
  });

  it('localStorage bi chan (nem loi) van tra id de trang chay duoc', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(CB.id(broken)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(CB.id(null)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('uuid() luon dung dinh dang ma server chap nhan (8–64 ky tu [A-Za-z0-9_-])', () => {
    for (let i = 0; i < 20; i++) expect(CB.uuid()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(new Set(Array.from({ length: 20 }, () => CB.uuid())).size).toBe(20);
  });
});
