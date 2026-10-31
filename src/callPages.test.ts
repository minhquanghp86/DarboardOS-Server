// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (02/12/2026) TAB "Nhật ký" / "Thiết bị" + NUT "Xoá nhật ký" — kiem tra TINH (khong can DOM/trinh duyet):
//   - public/call.html (man P4) va public/call-web.html (trinh duyet / dien thoai) deu truyen adapter `log`
//     (GET /calls/log?self=) va `clearLog` (POST /calls/log/clear?self=) cho CallUI.mount;
//   - public/call-ui.js ve 2 tab khi co `log`, va nut "Xoá nhật ký" o tieu de tab chi hien khi co `clearLog`,
//     co `confirm()` truoc khi goi API roi tai lai danh sach;
//   - public/call-ui.css co kieu cho tieu de + nut do.
// Hanh vi HTTP that cua API xoa nhat ky duoc kiem o src/calls.log.test.ts, phan luu tru o src/callLog.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pub = (f: string): string => fs.readFileSync(path.join(process.cwd(), 'public', f), 'utf8');

describe('call.html (man P4) — 2 tab + xoa nhat ky', () => {
  const html = pub('call.html');

  it('co adapter `log` goi GET /calls/log?self=<id man>&limit=50', () => {
    expect(html).toMatch(/log:\s*function\s*\(\)/);
    expect(html).toContain("'/calls/log?self=' + enc(DEV) + '&limit=50'");
  });

  it('co adapter `clearLog` goi POST /calls/log/clear?self=<id man>', () => {
    expect(html).toMatch(/clearLog:\s*function\s*\(\)/);
    expect(html).toContain("'/calls/log/clear?self=' + enc(DEV)");
  });

  it('mo dau bang tab "Thiết bị" (giu nguyen thao tac cu: mo la goi duoc ngay)', () => {
    expect(html).toMatch(/tab:\s*'devices'/);
  });

  it('giu nguyen luong goi cua man (POST /calls/start, accept, hangup)', () => {
    expect(html).toContain("'/calls/start?from=' + enc(DEV) + '&to=' + enc(to)");
    expect(html).toContain("'/calls/accept?call=' + enc(call) + '&dev=' + enc(DEV)");
    expect(html).toContain("'/calls/hangup?call=' + enc(call)");
  });
});

describe('call-web.html (Dashboard / dien thoai) — xoa nhat ky', () => {
  const html = pub('call-web.html');

  it('co adapter `clearLog` goi POST /calls/log/clear?self=<id phien cua minh>', () => {
    expect(html).toMatch(/clearLog:\s*function\s*\(\)/);
    expect(html).toContain("BASE + 'calls/log/clear?self=' + encodeURIComponent(me)");
  });

  it('chua biet `me` (chua co hello) -> KHONG goi API (tranh xoa nhat ky moi thiet bi)', () => {
    expect(html).toMatch(/if\s*\(!me\)\s*return\s*Promise\.reject/);
  });

  it('van giu adapter `log` cua tab Nhat ky', () => {
    expect(html).toContain("BASE + 'calls/log?self=' + encodeURIComponent(me) + '&limit=50'");
  });
});

describe('call-ui.js / call-ui.css — thanh tab + nut xoa', () => {
  const js = pub('call-ui.js');

  it('co 2 tab "Nhật ký" | "Thiết bị" khi trang co adapter.log', () => {
    expect(js).toMatch(/\[\['log', 'Nhật ký'\], \['devices', 'Thiết bị'\]\]/);
    expect(js).toContain("typeof A.log === 'function'");
  });

  it('nut "Xoá nhật ký" o tieu de tab: confirm() -> A.clearLog() -> renderLog() lai', () => {
    expect(js).toMatch(/function logHeader\(\)/);
    expect(js).toContain("window.confirm(");
    expect(js).toContain('A.clearLog()');
    expect(js).toMatch(/logSig = ''/);
    expect(js).toContain("'Xoá nhật ký'");
  });

  it('CSS co .lth (tieu de + nut cung dong) va .lclr (nut nho goc phai)', () => {
    const css = pub('call-ui.css');
    expect(css).toMatch(/\.call \.loglist \.lth \{[^}]*display: flex/);
    expect(css).toMatch(/\.call \.loglist \.lclr \{/);
  });
});

// (03/12/2026) SUA LOI "NHAT KY CHI HIEN CHIEU GOI DI" — phan HIEN THI: muc `in` phai khac muc `out` (mui ten,
// nhan trang thai, mau). Server tinh `dir` theo dung thiet bi dang hoi (src/callLog.ts); client chi ve theo `dir`.
describe('call-ui.js — hien thi dung CHIEU (in ↙ / out ↖)', () => {
  const js = pub('call-ui.js');

  it('muc "gọi đi" (out) dung mui ten ↖, "gọi đến" (in) dung ↙', () => {
    expect(js).toContain("svg(isOut ? 'arrow-top-left' : 'arrow-bottom-left')");
    expect(pub('icons.js')).toContain('"arrow-top-left"');
  });

  it('lop mau theo chieu: out = xanh duong, in = xanh la, in + nho = do', () => {
    expect(js).toMatch(/var cls = isOut \? 'out' : \(answered \? 'in' : 'missed'\)/);
    expect(pub('call-ui.css')).toMatch(/\.li\.out \{[^}]*#38bdf8/);
    expect(pub('call-ui.css')).toMatch(/\.li\.missed \{[^}]*#ff453a/);
  });

  it('nhan trang thai theo chieu: in + nho = "Nhỡ", in + answered = thoi luong, tu choi khac nhau 2 ben', () => {
    expect(js).toContain("if (it.state === 'missed') return 'Nhỡ'");
    expect(js).toContain("if (it.state === 'answered') return dur(it.durationMs || (it.endedAt - it.startedAt))");
    expect(js).toContain("if (it.state === 'declined') return it.dir === 'in' ? 'Đã từ chối' : 'Từ chối'");
  });

  it('moi dong co `data-dir` + title "Gọi đi"/"Gọi đến" (doc duoc bang trinh doc man hinh)', () => {
    expect(js).toContain("row.setAttribute('data-dir', isOut ? 'out' : 'in')");
    expect(js).toContain("(isOut ? 'Gọi đi' : 'Gọi đến')");
  });
});
