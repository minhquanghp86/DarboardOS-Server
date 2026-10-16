// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { NoticeStore, parseNotify, shouldPopup, shouldWake } from "./notifications.js";

const G = "http://127.0.0.1:1984";

describe("POST /notify", () => {
  it("chuan hoa: mac dinh normal + moi man hinh; camera -> anh go2rtc", () => {
    const r = parseNotify({ title: " Chuông cửa ", message: "Có người ở cổng", priority: "critical", camera: "cong", app: "cams" }, G);
    expect(r).toEqual({ ok: true, device: "all", notice: {
      title: "Chuông cửa", message: "Có người ở cổng", priority: "critical", app: "cams",
      image: "http://127.0.0.1:1984/api/frame.jpeg?src=cong" } });
    const n = parseNotify({ message: "x", priority: "khac", device: "esp32-80f1" }, G);
    expect(n.ok && n.notice.priority).toBe("normal");
    expect(n.ok && n.device).toBe("esp32-80f1");
  });
  it("tu choi: rong, url khong phai http, ten camera la", () => {
    expect(parseNotify({}, G).ok).toBe(false);
    expect(parseNotify({ title: "a", url: "javascript:alert(1)" }, G).ok).toBe(false);
    expect(parseNotify({ title: "a", camera: "../x" }, G).ok).toBe(false);
  });
  it("cat do dai", () => {
    const r = parseNotify({ title: "t".repeat(500), message: "m".repeat(900) }, G);
    expect(r.ok && [r.notice.title.length, r.notice.message.length]).toEqual([80, 300]);
  });
});

describe("Khong lam phien", () => {
  it("chi 'critical' xuyen qua Khong lam phien; 'high' danh thuc khi khong bat", () => {
    expect(shouldPopup({ priority: "normal" }, true)).toBe(false);
    expect(shouldPopup({ priority: "critical" }, true)).toBe(true);
    expect(shouldWake({ priority: "high" }, false)).toBe(true);
    expect(shouldWake({ priority: "high" }, true)).toBe(false);
    expect(shouldWake({ priority: "normal" }, false)).toBe(false);
    expect(shouldWake({ priority: "critical" }, true)).toBe(true);
  });
});

describe("lich su thong bao", () => {
  it("moi nhat truoc, gioi han, xoa", () => {
    const s = new NoticeStore(3);
    for (let i = 1; i <= 4; i++) s.add({ title: `t${i}`, message: "", priority: "normal" }, i);
    expect(s.list().map((n) => n.title)).toEqual(["t4", "t3", "t2"]);
    s.remove(s.list()[0].id);
    expect(s.size).toBe(2);
    s.clear();
    expect(s.size).toBe(0);
  });
});

describe('NoticeStore — da xem rieng tung man hinh (01/10/2026)', () => {
  it('mo thanh keo xuong chi danh dau thong bao thuong; tin nhan van chua xem', () => {
    const s = new NoticeStore();
    s.add({ title: 'Cua mo', message: '', priority: 'high' });
    s.add({ title: 'Quang · Gia dinh', message: 'an com', priority: 'high', app: 'chat', arg: 'c1' });
    expect(s.unseen('nt')).toBe(1); expect(s.unseen('chat')).toBe(1);
    expect(s.markSeen('nt')).toBe(true);
    expect(s.unseen('nt')).toBe(0); expect(s.unseen('chat')).toBe(1);
    expect(s.size).toBe(2);  // da xem van con trong danh sach
    expect(s.markSeen('nt')).toBe(false);
  });
  it('tin moi cung cuoc tro chuyen thay the bao cu (khong chat dong)', () => {
    const s = new NoticeStore();
    s.add({ title: 'A', message: '1', priority: 'high', app: 'chat', arg: 'c1' });
    s.add({ title: 'A', message: '2 tin mới · 2', priority: 'high', app: 'chat', arg: 'c1' });
    s.add({ title: 'B', message: 'x', priority: 'high', app: 'chat', arg: 'c2' });
    expect(s.list().map((n) => n.message)).toEqual(['x', '2 tin mới · 2']);
    expect(s.removeWhere((n) => n.arg === 'c1')).toBe(true);
    expect(s.size).toBe(1);
  });
  it('luu / nap giu trang thai da xem va id tiep theo', () => {
    const a = new NoticeStore(); let saved = 0; a.onChange = () => saved++;
    a.add({ title: 'x', message: '', priority: 'normal' }); a.markSeen();
    const b = new NoticeStore(); b.restore(JSON.parse(JSON.stringify(a.dump())));
    expect(b.list()[0].seen).toBe(true);
    expect(b.add({ title: 'y', message: '', priority: 'normal' }).id).toBe(2);
    expect(saved).toBe(2);
  });
});
