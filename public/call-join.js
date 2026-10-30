// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (GD3) Phan THUAN (khong dung DOM/mang) cua trang call-web.html khi app Android mo trang sau khi bam "Nghe":
//   call-web.html?call=<id>[&phone=<id>]
// Tach rieng de test duoc bang vitest (src/callJoin.test.ts) — hanh vi that:
//   - `?call=` (bat buoc) = cuoc goi can vao; thieu -> trang hien danh ba nhu cu.
//   - `&phone=` (tuy chon) = id may trong /app/list; thieu thi lay tu /calls/state?call= (xem phoneOf).
// Vi sao can `phone` o phia server: join() chi cho phien web cua DUNG may do vao cuoc goi (src/calls.ts).
(function () {
  'use strict';

  /** "?call=abc&phone=p1" -> { call: 'abc', phone: 'p1' } (cat khoang trang, thieu -> ''). */
  function parse(search) {
    var q = null;
    try { q = new URLSearchParams(String(search == null ? '' : search)); } catch (e) { q = null; }
    function get(k) {
      try { return String((q && q.get(k)) || '').trim(); } catch (e) { return ''; }
    }
    return { call: get('call'), phone: get('phone') };
  }

  /**
   * Id DIEN THOAI tu ket qua GET /calls/state?call= (hoac tu ?phone= neu app da truyen).
   * Truoc khi trang join: `to` chinh la may -> dung luon. Sau khi join, server doi `to` thanh phien web
   * (id bat dau bang 'web-') nen phai lay `phone` ma server tra ve.
   */
  function phoneOf(state, given) {
    var g = String(given == null ? '' : given).trim();
    if (g) return g;
    if (!state) return '';
    var p = String(state.phone == null ? '' : state.phone).trim();
    if (p) return p;
    var to = String(state.to == null ? '' : state.to).trim();
    return to && to.indexOf('web-') !== 0 ? to : '';
  }

  /** Nguoi GOI (man P4) tu /calls/state: dien thoai la ben NHAN cuoc goi -> `from` / `fromName`. */
  function peerOf(state) {
    if (!state) return { peer: '', name: '' };
    return { peer: String(state.from == null ? '' : state.from), name: String(state.fromName == null ? '' : state.fromName) };
  }

  // Trinh duyet: `window`; test vitest (node, src/callJoin.test.ts): `globalThis` — cung mot doi tuong.
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.RwvCallJoin = { parse: parse, phoneOf: phoneOf, peerOf: peerOf };
})();
