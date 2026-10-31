// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (31/10/2026) A/B XU LY AM THANH PHIA DIEN THOAI (WebRTC) cho trang call-web.html.
//
// Vi sao: P4 "khong nhay" (tieng tu dien thoai nho) — server da co AGC/limiter (src/audioAgc.ts) va log muc that
// (`[audio] dev=… in=… out=…`, src/audioMeter.ts). Nhung neu chinh DIEN THOAI da lam nat tin hieu truoc khi gui
// (AEC + NS + AGC cua WebRTC: noi xa bi coi la "on" nen bi triet, giong noi bi nen), thi server co keo len bao nhieu
// cung khong cuu duoc. Can TAT duoc xu ly cua trinh duyet de so sanh tren cung mot cuoc goi:
//   call-web.html?raw=1   -> echoCancellation:false, noiseSuppression:false, autoGainControl:false
//   call-web.html?raw=0   -> nhu cu (bat ca ba)
// Lua chon duoc LUU vao localStorage['rwv-raw-audio'] ('1' = raw, '0' = xu ly) nen lan sau khong can them tham so.
//
// Phan THUAN (khong DOM, khong getUserMedia) de test duoc bang vitest: src/callAudio.test.ts.
(function () {
  'use strict';

  /** Khoa localStorage giu lua chon raw (dung chung voi cong tac trong hop thoai Cai dat). */
  var KEY = 'rwv-raw-audio';
  var ON = ['1', 'true', 'on', 'yes'];
  var OFF = ['0', 'false', 'off', 'no'];

  /** '1' | '0' | '' — chuan hoa mot gia tri bat/tat (khong hieu -> ''). */
  function flag(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return '';
    if (ON.indexOf(s) >= 0) return '1';
    if (OFF.indexOf(s) >= 0) return '0';
    return '';
  }

  /** Gia tri `?raw=` tren URL: '1' (raw) | '0' (xu ly) | '' (khong co). */
  function paramOf(search) {
    var q = null;
    try { q = new URLSearchParams(String(search == null ? '' : search)); } catch (e) { q = null; }
    var v = '';
    try { v = q ? q.get('raw') : ''; } catch (e) { v = ''; }
    return flag(v);
  }

  /** true = RAW (tat xu ly cua trinh duyet). URL thang localStorage; khong co gi -> xu ly (nhu cu). */
  function rawFrom(search, stored) {
    var p = paramOf(search);
    if (p) return p === '1';
    return flag(stored) === '1';
  }

  /** true = dang XU LY (cong tac trong Cai dat BAT — mac dinh, nhu hanh vi cu). */
  function isProcessed(stored) { return flag(stored) !== '1'; }

  /** Constraints cho getUserMedia({audio: …}). */
  function constraints(raw) {
    var on = !raw;
    return { echoCancellation: on, noiseSuppression: on, autoGainControl: on };
  }

  /** Dong log ra console de biet trang dang o che do nao (xem cung dinh dang o src/audioMeter.ts). */
  function logLine(raw) { return '[audio] constraints=' + (raw ? 'raw' : 'processed'); }

  /** Gia tri can luu vao localStorage khi nguoi dung bat/tat cong tac (`checked` = dang xu ly). */
  function storeValue(processed) { return processed ? '0' : '1'; }

  // Trinh duyet: `window`; test vitest (node, src/callAudio.test.ts): `globalThis` — cung mot doi tuong.
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.RwvCallAudio = {
    KEY: KEY,
    paramOf: paramOf,
    rawFrom: rawFrom,
    isProcessed: isProcessed,
    constraints: constraints,
    logLine: logLine,
    storeValue: storeValue,
  };
})();
