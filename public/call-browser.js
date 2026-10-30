// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/10/2026) TRINH DUYET = THIET BI GOI DUOC, ON DINH, RO RANG.
//
// Truoc day moi lan mo trang goi (public/call-web.html) la mot phien WS MOI voi id NGAU NHIEN do server sinh
// (`web-xxxx`), nen danh ba cua man P4 nhap nhay: dong tab / rot mang / mo them tab la mat muc cu, hien muc moi,
// trung nhieu muc. Nay trang giu MOT id ben vung trong localStorage (`rwv-browser-id`, UUID v4) va gui
// `{type:'hello', id, name, kind:'web'}` ngay khi mo WS -> server dung lai dung phien do (xem src/calls.ts webHello).
//
// Phan THUAN (khong dung DOM) de test duoc bang vitest (src/callBrowser.test.ts):
//   - label(ua): ten hien thi "<Ten may / nen tang> · <trinh duyet>", vd 'Samsung · Chrome', 'iPhone · Safari',
//     'Máy tính · trình duyệt'; khong nhan ra may nao -> 'Điện thoại · trình duyệt'.
//   - id(store): doc id da luu, chua co / hong -> sinh UUID v4 roi luu lai (store = localStorage, test truyen gia lap).
(function () {
  'use strict';

  var KEY = 'rwv-browser-id';
  // Server chi nhan 8–64 ky tu [A-Za-z0-9_-] (src/calls.ts WEB_ID_RE) — UUID v4 (36 ky tu, co dau '-') hop le.
  var ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

  /** May / nen tang, uu tien dac hieu truoc (Samsung truoc Android, iPhone truoc Safari...). */
  var BRANDS = [
    [/samsung|samsungbrowser|sm-[a-z]\d{2,4}|gt-[a-z]\d{3}|sc-[a-z]\d{2}/i, 'Samsung'],
    [/iphone/i, 'iPhone'],
    [/ipad/i, 'iPad'],
    [/pixel/i, 'Pixel'],
    [/redmi|poco|xiaomi|mi\s?1?\d\b|m2\d{3}j\d|miui/i, 'Xiaomi'],
    [/huawei|honor/i, 'Huawei'],
    [/oneplus/i, 'OnePlus'],
    [/oppo|cph\d{4}/i, 'OPPO'],
    [/vivo|v2\d{3}/i, 'vivo'],
    [/realme/i, 'realme'],
    [/nokia/i, 'Nokia'],
    [/sony|xq-[a-z]{2}\d{2,4}/i, 'Sony'],
    [/moto\s?[gez]|motorola/i, 'Motorola'],
    [/tecno/i, 'TECNO'],
    [/infinix/i, 'Infinix'],
  ];

  /** Trinh duyet, xet theo thu tu: Edge/Opera/Samsung Internet deu chua "Chrome" trong UA. */
  var ENGINES = [
    [/samsungbrowser/i, 'Samsung Internet'],
    [/edga?\/|edg\//i, 'Edge'],
    [/opr\/|opera/i, 'Opera'],
    [/coc_coc_browser/i, 'Cốc Cốc'],
    [/zalo/i, 'Zalo'],
    [/yabrowser/i, 'Yandex'],
    [/fxios|firefox|fennec/i, 'Firefox'],
    [/crios|chrome|chromium/i, 'Chrome'],
    [/safari/i, 'Safari'],
  ];

  function pick(list, s) {
    for (var i = 0; i < list.length; i++) if (list[i][0].test(s)) return list[i][1];
    return '';
  }

  var MOBILE = /android|iphone|ipad|ipod|windows phone|iemobile|mobile|tablet/i;

  /**
   * Nhan hien thi cua thiet bi dang mo trang goi (thuan, khong doc bien toan cuc).
   *   'Samsung · Chrome', 'iPhone · Safari', 'Xiaomi · Chrome' ... (nhan ra may + trinh duyet)
   *   'Điện thoại · trình duyệt' (may di dong nhung khong nhan ra) / 'Máy tính · trình duyệt' (may tinh).
   */
  function label(ua) {
    var s = String(ua == null ? '' : ua);
    if (!MOBILE.test(s)) return 'Máy tính · trình duyệt';
    var brand = pick(BRANDS, s), engine = pick(ENGINES, s);
    if (!brand || !engine) return 'Điện thoại · trình duyệt';
    return brand + ' · ' + engine;
  }

  /** UUID v4: `crypto.randomUUID()` khi co, khong thi random/getRandomValues (HTTP khong phai localhost). */
  function uuid() {
    var c = (typeof crypto !== 'undefined' && crypto) || null;
    if (c && typeof c.randomUUID === 'function') {
      try {
        var u = c.randomUUID();
        if (ID_RE.test(u)) return u;
      } catch (e) { /* trinh duyet cu: roi xuong duong du phong ben duoi */ }
    }
    var b = new Uint8Array(16), i;
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;                        // phien ban 4
    b[8] = (b[8] & 0x3f) | 0x80;                        // bien the RFC 4122
    var h = '';
    for (i = 0; i < 16; i++) h += (b[i] + 0x100).toString(16).slice(1);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /** Id ben vung cua TRINH DUYET nay: doc `rwv-browser-id`, chua co / gia tri hong -> sinh moi roi luu. */
  function id(store) {
    var s = store;
    if (s === undefined) {
      try { s = (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) { s = null; }
    }
    var cur = '';
    try { cur = String((s && s.getItem(KEY)) || ''); } catch (e) { cur = ''; }
    if (ID_RE.test(cur)) return cur;
    var made = uuid();
    // localStorage bi chan (che do rieng tu / iframe) -> van chay, chi la moi lan mo tab lai la id khac.
    try { if (s) s.setItem(KEY, made); } catch (e) { /* */ }
    return made;
  }

  // Trinh duyet: `window`; test vitest (node, src/callBrowser.test.ts): `globalThis` — cung mot doi tuong.
  var root = typeof window !== 'undefined' ? window : globalThis;
  // `label` = ten ngan gon; `browserLabel` = ten day du (tai lieu/test dung ca hai).
  root.RwvCallBrowser = { label: label, browserLabel: label, id: id, uuid: uuid, KEY: KEY };
})();
