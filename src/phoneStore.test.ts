// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (10/11/2026) GD2 — so dang ky dien thoai (src/phoneStore.ts): phan luu tru thuan, khong mang/khong HTTP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PHONES, PHONE_KIND_LABEL, PhoneStore, hashDeviceKey, parseId, parseRegister, phoneLabel } from './phoneStore.js';

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
    expect(r.reg.deviceKey).toBe('');     // may khong gui deviceKey (ban app cu)
    expect(r.reg.model).toBe('');
  });

  it('nhan id/name/url hop le', () => {
    const r = parseRegister({ id: 'phone-1', name: 'Pixel 8', url: 'https://hass.local:8123/x/call-web.html' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reg).toEqual({ id: 'phone-1', name: 'Pixel 8', url: 'https://hass.local:8123/x/call-web.html', model: '', deviceKey: '' });
    }
  });

  it('nhan deviceKey + model; deviceKey duoc BAM truoc khi luu (khong luu ANDROID_ID tho)', () => {
    const r = parseRegister({ id: 'p1', name: 'Xiaomi', deviceKey: '9774d56d682e549c', model: '2201116SG' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reg.deviceKey).toBe('9774d56d682e549c');     // reg giu khoa THO; PhoneStore.register() bam
    expect(r.reg.model).toBe('2201116SG');

    const hashed = hashDeviceKey(r.reg.deviceKey);
    expect(hashed).toMatch(/^[0-9a-f]{16}$/);
    expect(hashed).not.toBe('9774d56d682e549c');
    expect(hashDeviceKey('  ')).toBe('');
    expect(hashDeviceKey(null)).toBe('');
    expect(hashDeviceKey('a')).not.toBe(hashDeviceKey('b'));
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

describe('parseId (/app/rename, /app/remove)', () => {
  it('chi can id hop le', () => {
    expect(parseId({ id: 'p1' })).toEqual({ ok: true, id: 'p1' });
    expect(parseId({ id: ' p1 ' })).toEqual({ ok: true, id: 'p1' });
    expect(parseId({}).ok).toBe(false);
    expect(parseId({ id: '  ' }).ok).toBe(false);
    expect(parseId({ id: 'co khoang trang' }).ok).toBe(false);
    expect(parseId(null).ok).toBe(false);
  });
});

describe('PhoneStore — GOP ban ghi trung theo deviceKey (cai lai app = id moi)', () => {
  const k = '9774d56d682e549c';               // ANDROID_ID THO (nhu app gui len)
  const hk = hashDeviceKey(k);                // dang luu trong file

  it('id moi cung deviceKey -> GOP vao ban ghi CU NHAT, tra id cu', () => {
    const s = new PhoneStore(null);
    const first = s.register({ id: 'may-cu', name: 'Xiaomi', url: 'http://x/1', deviceKey: k, model: '2201116SG' }, 1000);
    expect(first.id).toBe('may-cu');

    // Cai lai app: id moi, cung may (ANDROID_ID khong doi).
    const merged = s.register({ id: 'may-moi', name: 'Xiaomi 2', url: 'http://x/2', deviceKey: k, model: '2201116SG' }, 5000);
    expect(merged.id).toBe('may-cu');          // giu ban ghi cu nhat
    expect(merged.name).toBe('Xiaomi 2');      // nhung cap nhat ten/url/model
    expect(merged.url).toBe('http://x/2');
    expect(merged.ts).toBe(1000);              // lan dang ky dau giu nguyen
    expect(merged.lastSeen).toBe(5000);
    expect(s.list()).toHaveLength(1);
    expect(s.has('may-moi')).toBe(false);
  });

  it('nhieu ban ghi trung -> gop het ve ban ghi CU NHAT', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'a', name: 'A', url: '', deviceKey: k }, 1000);
    s.register({ id: 'c', name: 'C', url: '', deviceKey: k }, 2000);
    s.register({ id: 'b', name: 'B', url: '', deviceKey: k }, 3000);
    expect(s.list()).toHaveLength(1);
    expect(s.get('a')?.ts).toBe(1000);         // "a" dang ky som nhat -> duoc giu
    expect(s.get('a')?.name).toBe('B');        // ten/url cua lan dang ky cuoi
  });

  it('deviceKey khac nhau -> KHONG gop (2 may that)', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'p1', name: 'A', url: '', deviceKey: 'may-1' }, 1);
    s.register({ id: 'p2', name: 'B', url: '', deviceKey: 'may-2' }, 2);
    expect(s.list()).toHaveLength(2);
  });

  it('khong co deviceKey -> dedupe theo id nhu cu (khong xoa nham)', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'p1', name: 'A', url: '' }, 1);
    s.register({ id: 'p2', name: 'B', url: '' }, 2);
    s.register({ id: 'p1', name: 'A2', url: '' }, 3);
    expect(s.list().map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(s.get('p1')?.name).toBe('A2');
  });

  it('ban ghi CU (khong deviceKey) dung id vua dang ky -> gop vao, khong de 2 ban ghi', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify([{ id: 'cu', name: 'Xiaomi', url: '', lastSeen: 5, ts: 5 }]));
    const s = new PhoneStore(file);
    s.register({ id: 'cu', name: 'Xiaomi', url: '', deviceKey: k }, 900);
    expect(s.list()).toHaveLength(1);
    expect(s.get('cu')?.deviceKey).toBe(hk);
  });

  it('giu deviceKey/model khi lan sau app khong gui (ban app cu)', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'p1', name: 'A', url: '', deviceKey: k, model: '2201116SG' }, 1);
    s.register({ id: 'p1', name: 'A', url: '' }, 2);
    expect(s.get('p1')?.deviceKey).toBe(hk);
    expect(s.get('p1')?.model).toBe('2201116SG');
  });
});

describe('PhoneStore — rename / remove (ghi file ngay)', () => {
  it('rename doi ten, tra ban ghi, ghi file ngay', () => {
    const file = tmpFile();
    const s = new PhoneStore(file);
    s.register({ id: 'p1', name: 'Xiaomi', url: '' }, 1);
    const p = s.rename('p1', 'Điện thoại bếp');
    expect(p?.name).toBe('Điện thoại bếp');
    expect(p?.id).toBe('p1');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string; name: string }[];
    expect(saved.find((x) => x.id === 'p1')?.name).toBe('Điện thoại bếp');
  });

  it('rename ten rong -> quay ve nhan "Điện thoại"', () => {
    const s = new PhoneStore(null);
    s.register({ id: 'p1', name: 'Xiaomi', url: '' }, 1);
    expect(s.rename('p1', '   ')?.name).toBe(PHONE_KIND_LABEL);
  });

  it('rename id khong ton tai -> undefined', () => {
    const s = new PhoneStore(null);
    expect(s.rename('khong-co', 'X')).toBeUndefined();
  });

  it('rename/remove khi file chua ton tai: tao file, khong nem loi', () => {
    const file = tmpFile();
    const s = new PhoneStore(file);
    s.register({ id: 'p1', name: 'A', url: '' }, 1);
    fs.rmSync(file);                      // file bi xoa tay
    expect(() => s.rename('p1', 'B')).not.toThrow();
    expect(fs.existsSync(file)).toBe(true);
    expect(() => s.remove('p1')).not.toThrow();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('remove ghi file ngay', () => {
    const file = tmpFile();
    const s = new PhoneStore(file);
    s.register({ id: 'p1', name: 'A', url: '' }, 1);
    s.register({ id: 'p2', name: 'B', url: '' }, 2);
    expect(s.remove('p1')).toBe(true);
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string }[]).map((x) => x.id)).toEqual(['p2']);
  });
});

describe('PhoneStore — doc file: tu don ban ghi trung + ban ghi mo coi', () => {
  const k = hashDeviceKey('9774d56d682e549c');   // file luu khoa DA BAM

  it('trung deviceKey -> giu ban ghi co lastSeen MOI NHAT va ghi lai file', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify([
      { id: 'cu', name: 'Xiaomi', url: '', deviceKey: k, lastSeen: 100, ts: 100 },
      { id: 'moi', name: 'Xiaomi', url: '', deviceKey: k, lastSeen: 900, ts: 800 },
      { id: 'may-khac', name: 'Pixel', url: '', deviceKey: hashDeviceKey('khac'), lastSeen: 400, ts: 400 },
    ]));
    const s = new PhoneStore(file);
    expect(s.list().map((p) => p.id).sort()).toEqual(['may-khac', 'moi']);

    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string }[];
    expect(saved.map((x) => x.id).sort()).toEqual(['may-khac', 'moi']);
  });

  it('ban ghi mo coi (id hong) -> bo, va ghi lai file da don', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify([{ id: 'ok-1', name: 'A', lastSeen: 1 }, { id: 'x y' }, { name: 'khong id' }]));
    const s = new PhoneStore(file);
    expect(s.list().map((p) => p.id)).toEqual(['ok-1']);
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[]).length).toBe(1);
  });

  it('tuong thich ban cu: file khong co deviceKey/model van doc binh thuong, khong bi ghi lai', () => {
    const file = tmpFile();
    const old = [
      { id: 'test-abc', name: 'Test', url: '', lastSeen: 10, ts: 10 },
      { id: '29465a67-b42f-4cf5-b37a-b2bffd58cadb', name: 'Xiaomi 2201116SG', url: 'http://x/', lastSeen: 20, ts: 20 },
    ];
    fs.writeFileSync(file, JSON.stringify(old));
    const before = fs.readFileSync(file, 'utf8');
    const s = new PhoneStore(file);
    expect(s.list().map((p) => p.id).sort()).toEqual(['29465a67-b42f-4cf5-b37a-b2bffd58cadb', 'test-abc']);
    expect(s.get('test-abc')?.deviceKey).toBe('');
    expect(s.get('test-abc')?.model).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);   // khong co gi phai don -> khong ghi
  });
});
