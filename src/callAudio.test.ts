// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (31/10/2026) A/B XU LY AM THANH PHIA DIEN THOAI — `public/call-audio.js` (thuan, khong DOM) + phan noi trong
// `public/call-web.html` (kiem tra bang doc chuoi, nhu src/callPages.test.ts):
//   - `?raw=1` -> constraints tat ca ba (echoCancellation/noiseSuppression/autoGainControl = false);
//   - `?raw=0` -> nhu cu (bat ca ba); khong co tham so -> theo localStorage['rwv-raw-audio'];
//   - tham so tren URL duoc LUU lai (lan sau mo trang khong can them `?raw=`), cong tac trong hop thoai Cai dat
//     cung doi cung mot khoa;
//   - log ra console: `[audio] constraints=processed|raw`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import '../public/call-audio.js';

interface AudioApi {
  KEY: string;
  paramOf(search: unknown): string;
  rawFrom(search: unknown, stored: unknown): boolean;
  isProcessed(stored: unknown): boolean;
  constraints(raw: boolean): { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  logLine(raw: boolean): string;
  storeValue(processed: boolean): string;
}
const CA = (globalThis as unknown as { RwvCallAudio: AudioApi }).RwvCallAudio;
const pub = (f: string): string => fs.readFileSync(path.join(process.cwd(), 'public', f), 'utf8');
const src = (f: string): string => fs.readFileSync(path.join(process.cwd(), 'src', f), 'utf8');

describe('call-audio.js — ?raw=1 va localStorage', () => {
  it('khoa localStorage la rwv-raw-audio', () => {
    expect(CA.KEY).toBe('rwv-raw-audio');
  });

  it('?raw=1 -> RAW; ?raw=0 -> xu ly (nhu cu); tham so THANG gia tri da luu', () => {
    expect(CA.rawFrom('?raw=1', '')).toBe(true);
    expect(CA.rawFrom('?raw=0', '1')).toBe(false);
    expect(CA.rawFrom('?call=abc&raw=1&phone=p1', '0')).toBe(true);
  });

  it('khong co ?raw= -> dung gia tri da luu (lan sau van nho)', () => {
    expect(CA.rawFrom('', '1')).toBe(true);
    expect(CA.rawFrom('?call=abc', '1')).toBe(true);
    expect(CA.rawFrom('', '0')).toBe(false);
    expect(CA.rawFrom('', '')).toBe(false);          // mac dinh: XU LY (bat AEC/NS/AGC)
    expect(CA.rawFrom(undefined, undefined)).toBe(false);
  });

  it('doc duoc gia tri "true/false/on/off" (nguoi dung tu sua localStorage)', () => {
    expect(CA.rawFrom('?raw=true', '')).toBe(true);
    expect(CA.rawFrom('?raw=off', '')).toBe(false);
    expect(CA.rawFrom('', 'on')).toBe(true);
  });

  it('paramOf: "1" | "0" | "" (dung de biet co PHAI LUU lai khong)', () => {
    expect(CA.paramOf('?raw=1')).toBe('1');
    expect(CA.paramOf('?raw=0')).toBe('0');
    expect(CA.paramOf('?call=abc')).toBe('');
    expect(CA.paramOf('?raw=khong-hieu')).toBe('');
    expect(CA.paramOf(undefined)).toBe('');
  });

  it('constraints: raw -> TAT ca ba; xu ly -> BAT ca ba (nhu hanh vi cu)', () => {
    expect(CA.constraints(true)).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(CA.constraints(false)).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  });

  it('log console: [audio] constraints=processed|raw', () => {
    expect(CA.logLine(false)).toBe('[audio] constraints=processed');
    expect(CA.logLine(true)).toBe('[audio] constraints=raw');
  });

  it('cong tac (checked = dang XU LY): luu "0" khi bat, "1" khi tat', () => {
    expect(CA.storeValue(true)).toBe('0');
    expect(CA.storeValue(false)).toBe('1');
    expect(CA.isProcessed('0')).toBe(true);
    expect(CA.isProcessed('1')).toBe(false);
    expect(CA.isProcessed('')).toBe(true);            // mac dinh BAT
    expect(CA.isProcessed(null)).toBe(true);
  });
});

describe('call-web.html — noi `?raw=1` + cong tac vao getUserMedia', () => {
  const html = pub('call-web.html');

  it('nap public/call-audio.js', () => {
    expect(html).toContain('<script src="call-audio.js"></script>');
  });

  it('audioReq() lay constraints tu CA.constraints(RAW_AUDIO) — moi duong getUserMedia dung chung', () => {
    expect(html).toContain('function audioReq() { return CA.constraints(RAW_AUDIO); }');
    expect(html).toContain('CA.paramOf(location.search)');
    expect(html).toContain('CA.rawFrom(location.search, storeGet())');
    expect(html).toContain('console.log(CA.logLine(RAW_AUDIO))');
  });

  it('co cong tac trong hop thoai Cai dat, MAC DINH BAT, luu localStorage + bao tai lai trang', () => {
    expect(html).toContain('id="auProc"');
    expect(html).toContain('Xử lý âm thanh của trình duyệt (AEC/NS/AGC)');
    expect(html).toMatch(/\$\('auProc'\)\.onchange/);
    expect(html).toContain('storeSet(CA.storeValue(processed))');
    expect(html).toContain('cần tải lại trang để áp dụng');
    expect(html).toMatch(/function auSync\(\) \{ \$\('auProc'\)\.checked = CA\.isProcessed\(storeGet\(\)\); \}/);
  });

  it('co du phong khi call-audio.js khong nap duoc: van la constraints BAT ca ba (khong mat tieng)', () => {
    expect(html).toContain('var CA = window.RwvCallAudio || {');
    expect(html).toContain("logLine: function () { return '[audio] constraints=processed'; }");
  });
});

describe('src/index.ts — phuc vu call-audio.js nhu trang tinh', () => {
  it("'call-audio.js' nam trong STATIC_PAGES (khong co -> 404, trang mat constraints)", () => {
    expect(src('index.ts')).toContain("'call-audio.js'");
  });
});
