// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — so dang ky dien thoai (src/phoneStore.ts): phan luu tru thuan, khong mang/khong HTTP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PHONES, PHONE_KIND_LABEL, PhoneStore, parseRegister, phoneLabel } from './phoneStore.js';

const tmpFiles: string[] = [];
function tmpFile(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phones-')), 'rwv-phones.json');
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) { try { fs.rmSync(path.dirname(f), { recursive: true, force: true }); } catch { /* bo qua */ } }
});

describe('parseRegister', () => {
  it('body toi thieu: chi can id, ten mac dinh la nhan "Điện thoại"', () => {
    const r = parseRegister({ id: 'a1b2c3' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reg.id).toBe('a1b2c3');
    expect(r.reg.name).toBe(PHONE_KIND_LABEL);
    expect(r.reg.url).toBe('');
  });

  it('nhan id/name/url hop le', () => {
    const r = parseRegister({ id: 'phone-1', name: 'Pixel 8', url: 'https://hass.local:8123/x/call-web.html' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reg).toEqual({ id: 'phone-1', name: 'Pixel 8', url: 'https://hass.local:8123/x/call-web.html' });
  });

  it('thieu id / id co ky tu la -> tu choi', () => {
    expect(parseRegister({}).ok).toBe(false);
    expect(parseRegister({ id: '' }).ok).toBe(false);
    expect(parseRegister({ id: 'a b' }).ok).toBe(false);
    expect(parseRegister({ id: 'x'.repeat(65) }).ok).toBe(false);
    expect(parseRegister(null).ok).toBe(false);
  });

  it('url phai la http(s)', () => {
    expect(parseRegister({ id: 'p1', url: 'ftp://x/y' }).ok).toBe(false);
    expect(parseRegister({ id: 'p1', url: 'hass.local/call-web.html' }).ok).toBe(false);
    expect(parseRegister({ id: 'p1', url: 'http://10.0.0.5:18080/call-web.html' }).ok).toBe(true);
  });

  it('ten bi cat ngan va bo ky tu dieu khien', () => {
    const r = parseRegister({ id: 'p1', name: 'A\u0000B\u001f' + 'x'.repeat(80) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reg.name.length).toBeLessThanOrEqual(40);
      expect(r.reg.name).not.toMatch(/[\u0000-\u001f]/);
    }
  });
});

describe('phoneLabel', () => {
  it('co ten -> "<ten> · Điện thoại"', () => {
    expect(phoneLabel({ name: 'Pixel 8' })).toBe('Pixel 8 · Điện thoại');
  });
  it('khong co ten -> chi "Điện thoại" (khong lap nhan)', () => {
    expect(phoneLabel(null)).toBe('Điện thoại');
    expect(phoneLabel({ name: '' })).toBe('Điện thoại');
    expect(phoneLabel({ name: PHONE_KIND_LABEL })).toBe('Điện thoại');
  });
});

describe('PhoneStore', () => {
  it('dang ky roi doc lai: giu id, cap nhat ten + lastSeen', () => {
    const s = new PhoneStore(null);
    const p = s.register({ id: 'p1', name: 'Pixel', url: '' }, 1000);
    expect(p.ts).toBe(1000);
    expect(p.lastSeen).toBe(1000);
    s.register({ id: 'p1', name: 'Pixel 8', url: 'http://x/' }, 2000);
    const again = s.get('p1');
    expect(again?.name).toBe('Pixel 8');
    expect(again?.url).toBe('http://x/');
    expect(again?.ts).toBe(1000);      // lan dang ky dau duoc giu
    expect(again?.lastSeen).toBe(2000);
    expect(s.list()).toHaveLength(1);
  });

  it('dang ky trung id khong tao them muc', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'p1', name: 'A', url: '' }, 1);
    s.register({ id: 'p1', name: 'A', url: '' }, 2);
    s.register({ id: 'p1', name: 'A', url: '' }, 3);
    expect(s.list()).toHaveLength(1);
  });

  it('ghi file that va doc lai duoc (ben qua cap nhat add-on)', () => {
    const file = tmpFile();
    const s = new PhoneStore(file);
    s.register({ id: 'p1', name: 'Pixel 8', url: 'http://x/call-web.html' }, 5000);
    expect(fs.existsSync(file)).toBe(true);

    const reopened = new PhoneStore(file);
    const p = reopened.get('p1');
    expect(p?.name).toBe('Pixel 8');
    expect(p?.url).toBe('http://x/call-web.html');
    expect(p?.lastSeen).toBe(5000);
  });

  it('file hong / muc rac -> bo qua, khong nem loi', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ khong phai json');
    expect(new PhoneStore(file).list()).toEqual([]);

    fs.writeFileSync(file, JSON.stringify([{ id: 'ok-1', name: 'A' }, { id: 'co khoang trang' }, 42, null]));
    const s = new PhoneStore(file);
    expect(s.list().map((p) => p.id)).toEqual(['ok-1']);
  });

  it('chap nhan ca dang {phones:[...]}', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ phones: [{ id: 'p9', name: 'X', lastSeen: 7 }] }));
    expect(new PhoneStore(file).get('p9')?.lastSeen).toBe(7);
  });

  it('touch cap nhat lastSeen nhung chi ghi file toi da 10 s/lan', () => {
    const file = tmpFile();
    const s = new PhoneStore(file);
    s.register({ id: 'p1', name: 'A', url: '' }, 0);
    const before = fs.readFileSync(file, 'utf8');

    s.touch('p1', 2_000);                       // chua du 10 s -> khong ghi
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(s.get('p1')?.lastSeen).toBe(2_000);  // nhung trong bo nho da cap nhat

    s.touch('p1', 20_000);                      // du 10 s -> ghi
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string; lastSeen: number }[];
    expect(saved[0]?.lastSeen).toBe(20_000);
  });

  it('touch id khong ton tai: khong lam gi', () => {
    const s = new PhoneStore(null);
    expect(() => s.touch('khong-co', 1)).not.toThrow();
    expect(s.list()).toEqual([]);
  });

  it('qua MAX_PHONES: bo may LAU KHONG THAY nhat, giu may vua dang ky', () => {
    const s = new PhoneStore(null);
    for (let i = 0; i < MAX_PHONES; i++) s.register({ id: `p${i}`, name: `M${i}`, url: '' }, 1000 + i);
    s.register({ id: 'moi', name: 'Moi', url: '' }, 9000);
    const ids = s.list().map((p) => p.id);
    expect(ids).toHaveLength(MAX_PHONES);
    expect(ids).toContain('moi');
    expect(ids).not.toContain('p0');   // lastSeen nho nhat
  });

  it('danh sach sap xep theo ten (khong phu thuoc thu tu dang ky)', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'b', name: 'Bình', url: '' }, 1);
    s.register({ id: 'a', name: 'An', url: '' }, 2);
    expect(s.list().map((p) => p.name)).toEqual(['An', 'Bình']);
  });

  it('remove xoa va tra true; xoa lan 2 tra false', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'p1', name: 'A', url: '' }, 1);
    expect(s.remove('p1')).toBe(true);
    expect(s.remove('p1')).toBe(false);
    expect(s.has('p1')).toBe(false);
  });

  it('file = null (khong co /data): van dung duoc, khong ghi dia', () => {
    const s = new PhoneStore(null);
    expect(() => s.register({ id: 'p1', name: 'A', url: '' }, 1)).not.toThrow();
    expect(s.list()).toHaveLength(1);
  });
});
