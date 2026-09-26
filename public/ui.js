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
  window.RwvUI = { state: state };
})();
