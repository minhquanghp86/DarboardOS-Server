// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (13/10/2026) BO SUNG cho trang he thong: cac trang nay con duoc mo trong TAB TRINH DUYET qua duong dan ingress
// (/api/hassio_ingress/<token>/<ten trang>). Khi do MOI duong dan tuyet doi ('/api/...', '/frigate/...', '/ui.css'...)
// deu tro SAI GOC -> trang trang hoac khong tai duoc du lieu. Ho tro:
//   - window.rwvRel(u): gan goc cua trang vao duong dan bat dau bang '/'
//   - boc window.fetch: tu dong gan goc cho moi loi goi fetch('...')
// Tren PANEL (goc '/') ket qua KHONG DOI. Khong lap lai neu duong dan da co tien to trang (rel() cua iptv.html).
(function () {
  var B = location.pathname.replace(/[^/]*$/, '');
  function rwvRel(u) {
    if (typeof u !== 'string' || u.charAt(0) !== '/' || u.charAt(1) === '/') return u;
    if (B !== '/' && u.indexOf(B) === 0) return u;
    return B + u.slice(1);
  }
  window.rwvRel = rwvRel;
  var of = window.fetch;
  if (typeof of === 'function') {
    window.fetch = function (u, o) { try { return of.call(this, rwvRel(u), o); } catch (e) { return of.call(this, u, o); } };
  }
})();
// (26/09/2026) Tien ich dung chung cho trang he thong (xem ui.css). Chi DOM API (mot so trang co Trusted Types).
(function () {
  var ICONS = {
    offline: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z',
    empty: 'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2m0 16H5V5h14v14M7 7h10v2H7V7m0 4h10v2H7v-2m0 4h7v2H7v-2z',
    loading: 'M12 4V2A10 10 0 002 12h2a8 8 0 018-8z'
  };
  /** Dung khoi trang thai vao `box`: {kind:'err'|'empty'|'loading', title, text, retry:function} */
  function state(box, o) {
    var wrap = document.createElement('div');
    wrap.className = 'rwv-state' + (o.kind === 'err' ? ' err' : '');
    var ic = document.createElement('div'); ic.className = 'ic';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[o.kind === 'err' ? 'offline' : o.kind] || ICONS.empty); svg.appendChild(p); ic.appendChild(svg);
    var t = document.createElement('div'); t.className = 't'; t.textContent = o.title || '';
    wrap.append(ic, t);
    if (o.text) { var s = document.createElement('div'); s.className = 's'; s.textContent = o.text; wrap.appendChild(s); }
    if (o.retry) {
      var b = document.createElement('button'); b.className = 'rwv-btn primary'; b.textContent = o.retryLabel || 'Thử lại';
      b.addEventListener('click', function () { o.retry(); }); wrap.appendChild(b);
    }
    box.replaceChildren(wrap);
    return wrap;
  }
  /**
   * (14/10/2026) AM LUONG THIET BI (loa cua man hinh) cho trinh phat video / IPTV. Am thanh trang KHONG ra loa truc tiep
   * (server tat tieng Chromium, phat PCM qua WebSocket) nen video.volume vo tac dung — chinh nhu thanh truot am luong
   * cua Shell: __rwvControl({f:'v', v}). Muc hien tai: su kien 'rwv-state' (s.v; null = man khong loa, vd S3).
   * render(ok, v): ok = dieu khien duoc (an nut khi false: man khong loa, hoac trang mo trong tab trinh duyet).
   */
  function volume(render) {
    var cur = null, ok = false, holdAt = 0, sendT = 0;
    function apply(s) {
      if (!s) return;
      ok = !!s.ctl && s.v != null && typeof window.__rwvControl === 'function';
      // Vua bam: bo qua gia tri cu dang tren duong ve (thiet bi bao lai sau ~1 s) de con so khong nhay lui.
      if (s.v != null && Date.now() - holdAt > 1500) cur = s.v;
      render(ok, cur);
    }
    window.addEventListener('rwv-state', function (e) { apply(e.detail); });
    if (window.__rwvLastState) apply(window.__rwvLastState); else render(false, null);
    return {
      step: function (d) {
        if (!ok || cur == null) return;
        cur = Math.max(0, Math.min(100, Math.round(cur / 5) * 5 + d)); holdAt = Date.now();
        render(ok, cur);
        clearTimeout(sendT);
        sendT = setTimeout(function () { try { window.__rwvControl(JSON.stringify({ f: 'v', v: cur })); } catch (e) { /* */ } }, 120);
      }
    };
  }
  window.RwvUI = { state: state, volume: volume };
})();
