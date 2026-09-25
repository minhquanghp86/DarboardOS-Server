// (25/09/2026) SHELL — giao dien he thong kieu dien thoai, tiem vao MOI tab cua panel (xem docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md).
//   - Nut dong ho giua mep tren (nhu cu).
//   - Thanh keo xuong: SERVER nhan dien cu chi keo tu mep tren (src/gestures.ts) roi goi __rwvShell.gesture(...);
//     cham nut dong ho cung mo. Dong: cham nen mo / vuot len tren thanh.
//   - Man hinh chinh cua OS (/os/home): tien ich + luoi ung dung + dock (Home Assistant dau tien).
// Du lieu: window.__RWV_CFG (server chen khi tiem) + trang thai thiet bi server day qua __rwvShell.state().
// Shadow DOM DONG: CSS cua trang khong anh huong. Chi DOM API (Trusted Types).
import { CSS } from './styles';
import { el, mdi, pad2, setText, svgEl } from './dom';
import { App, appIcon, weatherIcon } from './icons';

declare global { interface Window { [k: string]: any } }

type Motion = 'full' | 'reduced' | 'minimal';
interface Cfg {
  apps: App[]; groups: [string, string][]; motion: Motion;
  urls: { osHome: string; ha: string; weather: string; timer: string; cams: string; scenes: string };
  bindings: { url: string; control: string };
}
interface DevState {
  b: number | null; v: number | null; on: boolean; ctl: boolean; tv: boolean; skewMs: number; tz: number;
  tg: { noSleep: boolean; muted: boolean; aec: boolean } | null;
  wx: { t: number; code: number; day: boolean; pp: number | null; name: string } | null;
  tm: { endsAt: number; label: string } | null;
}

(function () {
  if (window.__rwvShell) return;
  const CFG: Cfg = window.__RWV_CFG;
  if (!CFG) return;
  const Z = '2147483647';
  const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

  function sendControl(obj: unknown): void {
    const fn = window[CFG.bindings.control];
    if (typeof fn === 'function') { try { fn(JSON.stringify(obj)); } catch { /* bo qua */ } }
  }
  function go(url: string): void { closeShade(false); location.href = url; }

  // ── Khung Shadow DOM ──────────────────────────────────────────────────
  const host = document.createElement('rwv-shell');
  host.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none;display:block`;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
  const root = el('div', 'root');
  shadow.appendChild(root);

  // ── Trang thai + dong ho ─────────────────────────────────────────────
  let st: DevState | null = null;
  const clockEls: Element[] = [];
  const dateEls: Element[] = [];
  function deviceNow(): Date | null {
    if (!st || !st.tv) return null;
    return new Date(Date.now() + st.skewMs + st.tz * 60000);  // doc bang getUTC* = gio THIET BI
  }
  function dateText(t: Date): string {
    const dd = t.getUTCDate(), mm = t.getUTCMonth() + 1;
    let s = WD[t.getUTCDay()] + ', ' + pad2(dd) + '/' + pad2(mm);
    const L = window.RwvLunar;
    if (L) { const l = L.solar2lunar(dd, mm, t.getUTCFullYear(), 7); s += ' · ' + l.day + '/' + l.month + (l.leap ? ' nhuận' : '') + ' âm lịch'; }
    return s;
  }

  // ── Nut dong ho ──────────────────────────────────────────────────────
  // (26/09/2026) CHI HIEN THI gio, KHONG nhan cham: nut nam de len dai tab cua HA -> bam tab hay bi bat nham thanh mo
  // thanh trang thai (nguoi dung bao). Thanh trang thai chi mo bang cu chi vuot tu mep tren (server, src/gestures.ts).
  const pill = el('div', 'pill');
  pill.setAttribute('aria-hidden', 'true');
  const drop = svgEl('svg', { class: 'drop', viewBox: '0 0 104 22', width: '104', height: '22' });
  drop.appendChild(svgEl('path', { d: 'M0 0H104C91 0 86 4 79 11C72 18 64 22 52 22C40 22 32 18 25 11C18 4 13 0 0 0Z', fill: 'rgba(20,20,20,0.6)' }));
  const pillT = el('span', 't');
  const pillChev = mdi('chevdown', 'chev');
  pill.append(drop, pillT, pillChev);

  // ── Thanh keo xuong ──────────────────────────────────────────────────
  const scrim = el('div', 'scrim');
  const shade = el('div', 'shade');
  const inner = el('div', 'shade-in');
  const handle = el('div', 'handle');
  shade.append(inner, handle);

  // Hang thong tin
  const info = el('div', 'info');
  const infoL = el('div');
  const sClock = el('div', 'clock'); const sDate = el('div', 'date');
  infoL.append(sClock, sDate); clockEls.push(sClock); dateEls.push(sDate);
  const timerChip = el('button', 'chip timer'); timerChip.append(mdi('timer'), el('span'));
  const wxChip = el('button', 'chip'); const wxIcoBox = el('span'); const wxTxt = el('span');
  wxChip.append(wxIcoBox, wxTxt);
  timerChip.addEventListener('click', () => go(CFG.urls.timer));
  wxChip.addEventListener('click', () => go(CFG.urls.weather));
  info.append(infoL, el('div', 'spacer'), timerChip, wxChip);

  // O bat/tat nhanh
  interface Tile { el: HTMLElement; on: boolean; at: number; set(on: boolean): void }
  function makeTile(field: string, label: string, icon: string, color: string): Tile {
    const b = el('button', 'tile'); b.append(mdi(icon), el('span', '', label));
    const t: Tile = {
      el: b, on: false, at: 0,
      set(on: boolean) { if (Date.now() - t.at < 1500) return; show(on); },
    };
    function show(on: boolean) { t.on = on; b.classList.toggle('on', on); b.style.background = on ? color : ''; b.setAttribute('aria-pressed', String(on)); }
    b.addEventListener('click', (e) => { e.stopPropagation(); show(!t.on); t.at = Date.now(); sendControl({ f: field, v: t.on ? 1 : 0 }); });
    return t;
  }
  const tiles = [makeTile('ns', 'Luôn sáng', 'eye', '#fbbf24'), makeTile('mu', 'Tắt tiếng', 'mute', '#f87171'), makeTile('aec', 'Khử vọng', 'mic_aec', '#34d399')];
  const tilesBox = el('div', 'tiles'); tiles.forEach((t) => tilesBox.appendChild(t.el));

  // Thanh truot
  interface Slider { el: HTMLElement; set(v: number | null): void }
  function makeSlider(field: string, icon: string, color: string): Slider {
    const track = el('div', 'slider'); const fill = el('div', 'fill'); fill.style.background = color;
    const pct = el('div', 'pct');
    track.append(fill, mdi(icon), pct);
    let value = 0, dragging = false, releasedAt = 0, lastSent = 0, timer: number | undefined;
    const show = (v: number) => { value = v; fill.style.width = v + '%'; pct.textContent = v + '%'; };
    const fromX = (x: number) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(100, Math.round((x - r.left) / r.width * 100))); };
    const send = (final: boolean) => {
      const now = Date.now(); clearTimeout(timer);
      if (final || now - lastSent >= 150) { lastSent = now; sendControl({ f: field, v: value }); }
      else timer = window.setTimeout(() => send(true), 150 - (now - lastSent));
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); dragging = true;
      try { track.setPointerCapture(e.pointerId); } catch { /* */ }
      show(fromX(e.clientX)); send(false);
    });
    track.addEventListener('pointermove', (e) => { if (dragging) { show(fromX(e.clientX)); send(false); } });
    const end = () => { if (!dragging) return; dragging = false; releasedAt = Date.now(); send(true); };
    track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
    return { el: track, set(v) { if (v == null || dragging || Date.now() - releasedAt < 1500) return; show(v); } };
  }
  const bri = makeSlider('b', 'sun', '#f59e0b');
  const vol = makeSlider('v', 'vol', '#3b82f6');
  const sliders = el('div', 'sliders'); sliders.append(bri.el, vol.el);
  const ctl = el('div', 'ctl'); ctl.append(tilesBox, sliders);

  // Hang bieu tuong mo trang toan man hinh (chi hien muc DA CO — khong de nut chet)
  const shortcuts = el('div', 'shortcuts');
  const SC: [string, string, () => void][] = [
    ['apps', 'Ứng dụng', () => go(CFG.urls.osHome)],
    ['ha', 'Home Assistant', () => { if (CFG.urls.ha) go(CFG.urls.ha); }],
    ['cams', 'Camera', () => go(CFG.urls.cams)],
    ['scenes', 'Cảnh', () => go(CFG.urls.scenes)],
  ];
  for (const [icon, label, fn] of SC) {
    if (icon === 'ha' && !CFG.urls.ha) continue;
    const b = el('button', 'sc'); const c = el('span', 'b'); c.appendChild(mdi(icon)); b.append(c, el('span', 'l', label));
    if (icon === 'ha') c.style.background = '#1a8fd6';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    shortcuts.appendChild(b);
  }
  inner.append(info, ctl, shortcuts);

  // Chieu cao, keo, mo/dong. Muc 'full' (P4): keo theo ngon; 'reduced'/'minimal' (S3): nhay thang.
  let shadeVisible = 0;
  const fullH = () => inner.offsetHeight;
  function setVisible(px: number, animate: boolean) {
    const h = fullH();
    shadeVisible = Math.max(0, Math.min(h, px));
    const anim = animate && CFG.motion === 'full';
    shade.classList.toggle('anim', anim); scrim.classList.toggle('anim', anim);
    shade.style.height = shadeVisible + 'px';
    scrim.style.opacity = String(h ? (shadeVisible / h) * 0.55 : 0);
    scrim.classList.toggle('on', shadeVisible > 0);
    pillChev.style.transform = shadeVisible > 0 ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)';
  }
  function openShade(animate: boolean) { tick(); setVisible(fullH(), animate); }
  function closeShade(animate: boolean) { setVisible(0, animate); }
  scrim.addEventListener('click', (e) => { e.stopPropagation(); closeShade(true); });
  // Vuot len tren nen thanh (khong tren nut/thanh truot) -> dong
  let pDown: { y: number; t: number } | null = null;
  shade.addEventListener('pointerdown', (e) => { if (e.target === inner || e.target === shade || e.target === handle || (e.target as Element).closest?.('.info')) pDown = { y: e.clientY, t: Date.now() }; });
  shade.addEventListener('pointerup', (e) => {
    if (pDown && pDown.y - e.clientY > 40) closeShade(true);
    pDown = null;
  });
  handle.addEventListener('click', () => closeShade(true));

  // ── Man hinh chinh cua OS ───────────────────────────────────────────
  let homeWx: HTMLElement | null = null, homeWxIco: HTMLElement | null = null, homeWxT: HTMLElement | null = null, homeWxS: HTMLElement | null = null;
  function launch(app: App) {
    if (app.action === 'url') { closeShade(false); openUrlBox(); return; }
    if (app.url) go(app.url);
  }
  function appButton(app: App): HTMLElement {
    const b = el('button', 'app'); b.setAttribute('data-app', app.kind);
    b.append(appIcon(app), el('span', 'l', app.label));
    b.addEventListener('click', (e) => { e.stopPropagation(); if (!swiped) launch(app); });
    return b;
  }
  let swiped = false;
  function mountHome() {
    const home = el('div', 'home');
    // Tien ich: dong ho lon + thoi tiet
    const widgets = el('div', 'widgets');
    const wc = el('div', 'w-clock'); const hc = el('div', 'clock'); const hd = el('div', 'date');
    wc.append(hc, hd); clockEls.push(hc); dateEls.push(hd);
    homeWx = el('button', 'w-wx'); homeWxIco = el('span'); const col = el('div'); homeWxT = el('div', 't'); homeWxS = el('div', 's');
    col.append(homeWxT, homeWxS); homeWx.append(homeWxIco, col);
    homeWx.addEventListener('click', () => go(CFG.urls.weather));
    widgets.append(wc, el('div', 'spacer'), homeWx);
    // Dock: Home Assistant truoc, roi toi da 4 ung dung hay dung
    const DOCK_KINDS = ['cams', 'youtube', 'weather', 'radio'];
    const ha = CFG.apps.find((a) => a.id === 'home');
    const dockApps = [...(ha ? [ha] : []), ...DOCK_KINDS.map((k) => CFG.apps.find((a) => a.id === k)).filter((a): a is App => !!a)];
    const gridApps = CFG.apps.filter((a) => !dockApps.includes(a));
    // Luoi chia trang: so cot/hang theo kich thuoc man hinh
    const W = window.innerWidth, H = window.innerHeight;
    const cols = W >= 900 ? 7 : W >= 600 ? 5 : 4;
    const rows = H >= 560 ? 2 : H >= 420 ? 2 : 1;
    const per = cols * rows;
    const pager = el('div', 'pager'); const pages = el('div', 'pages');
    pager.style.setProperty('--cols', String(cols));
    const nPages = Math.max(1, Math.ceil(gridApps.length / per));
    for (let p = 0; p < nPages; p++) {
      const page = el('div', 'page');
      page.style.setProperty('--cols', String(cols));
      gridApps.slice(p * per, (p + 1) * per).forEach((a) => page.appendChild(appButton(a)));
      pages.appendChild(page);
    }
    pager.appendChild(pages);
    const dots = el('div', 'dots');
    for (let p = 0; p < nPages && nPages > 1; p++) dots.appendChild(el('i'));
    let cur = 0;
    const showPage = (i: number, animate: boolean) => {
      cur = Math.max(0, Math.min(nPages - 1, i));
      pages.classList.toggle('anim', animate && CFG.motion !== 'minimal');
      pages.style.transform = `translateX(${-cur * 100}%)`;
      Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === cur));
    };
    // Vuot ngang doi trang (P4 keo theo ngon)
    let sx = 0, sy = 0, dragging = false;
    pager.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; dragging = true; swiped = false; });
    pager.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - sy)) {
        swiped = true;
        if (CFG.motion === 'full') { pages.classList.remove('anim'); pages.style.transform = `translateX(calc(${-cur * 100}% + ${dx}px))`; }
      }
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return; dragging = false;
      const dx = e.clientX - sx;
      if (swiped) showPage(cur + (dx < -50 ? 1 : dx > 50 ? -1 : 0), true);
      setTimeout(() => { swiped = false; }, 50);
    };
    pager.addEventListener('pointerup', end); pager.addEventListener('pointercancel', end);
    showPage(0, false);
    const dock = el('div', 'dock'); dockApps.forEach((a) => dock.appendChild(appButton(a)));
    home.append(widgets, pager, dots, dock);
    root.insertBefore(home, root.firstChild);
    document.title = 'Ứng dụng';
  }
  const isHome = (() => { try { return new URL(CFG.urls.osHome).pathname === location.pathname && location.port === new URL(CFG.urls.osHome).port; } catch { return false; } })();
  if (isHome) mountHome();
  root.append(scrim, shade, pill);

  // ── O nhap dia chi (ung dung Trinh duyet) — DOM THUONG (khong Shadow) de ban phim ao nhan focus ──
  let urlBox: HTMLDivElement | null = null, urlInput: HTMLInputElement | null = null;
  function normalizeUrl(raw: string): string {
    const t = (raw || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/]+:\d+(\/|$)/.test(t)) return '';
    if (/\s/.test(t) || (t.indexOf('.') < 0 && !/^localhost(:\d+)?(\/|$)/i.test(t))) return 'https://www.google.com/search?q=' + encodeURIComponent(t);
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(t)) return 'http://' + t;
    return 'https://' + t;
  }
  function openUrlBox() {
    if (!urlBox) {
      urlBox = document.createElement('div');
      urlBox.id = '__rwv_url_box';
      urlBox.style.cssText = `position:fixed;top:8px;left:50%;transform:translateX(-50%);width:min(640px,calc(100vw - 16px));box-sizing:border-box;display:none;align-items:center;gap:8px;padding:6px;border-radius:10px;background:rgba(30,30,30,0.95);box-shadow:0 2px 10px rgba(0,0,0,0.4);z-index:${Z}`;
      urlInput = document.createElement('input');
      urlInput.type = 'url'; urlInput.autocomplete = 'off'; urlInput.spellcheck = false;
      urlInput.placeholder = 'Nhập địa chỉ web rồi bấm Enter';
      urlInput.style.cssText = 'flex:1;min-width:0;height:36px;box-sizing:border-box;padding:0 10px;border:none;border-radius:8px;outline:none;font:16px sans-serif;color:#111;background:#fff';
      const mk = (text: string, bg: string, fn: () => void) => {
        const b = document.createElement('div'); b.textContent = text;
        b.style.cssText = `flex:none;display:flex;align-items:center;justify-content:center;min-width:44px;padding:0 14px;height:36px;border-radius:8px;cursor:pointer;font:15px sans-serif;color:#fff;background:${bg}`;
        // pointerdown: ban phim ao dang hien se "nuot" click ngay sau khi an (xem lich su launcher)
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
        return b;
      };
      const submit = () => {
        const url = normalizeUrl(urlInput!.value);
        if (!url) { urlInput!.style.outline = '2px solid #e55'; return; }
        urlBox!.style.display = 'none';
        const fn = window[CFG.bindings.url];
        if (typeof fn === 'function') { try { fn(url); return; } catch { /* */ } }
        location.href = url;
      };
      urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') urlBox!.style.display = 'none'; });
      urlBox.append(urlInput, mk('Mở', '#2a7de1', submit), mk('✕', 'rgba(255,255,255,0.15)', () => { urlBox!.style.display = 'none'; }));
      (document.body || document.documentElement).appendChild(urlBox);
    }
    urlInput!.value = ''; urlInput!.style.outline = 'none';
    urlBox.style.display = 'flex';
    setTimeout(() => urlInput!.focus(), 30);
  }

  // ── Bao thuc (het hen gio) ──────────────────────────────────────────
  function alarm(label: string) {
    shadow.querySelector('.alarm')?.remove();
    const ov = el('div', 'alarm');
    ov.append(mdi('timer'), el('div', 't1', 'Hết giờ!'), el('div', 't2', label || 'Hẹn giờ đã kết thúc'), el('div', 'btn', 'Tắt'));
    let ctx: AudioContext | null = null, beep: number | undefined;
    const stopAt = Date.now() + 120000;
    const stop = () => { clearInterval(beep); try { ctx?.close(); } catch { /* */ } ov.remove(); };
    try {
      ctx = new AudioContext();
      beep = window.setInterval(() => {
        if (Date.now() > stopAt) { stop(); return; }
        for (const dt of [0, 0.25, 0.5]) {
          const o = ctx!.createOscillator(), g = ctx!.createGain();
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, ctx!.currentTime + dt);
          g.gain.exponentialRampToValueAtTime(0.5, ctx!.currentTime + dt + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx!.currentTime + dt + 0.18);
          o.connect(g); g.connect(ctx!.destination); o.start(ctx!.currentTime + dt); o.stop(ctx!.currentTime + dt + 0.2);
        }
      }, 1500);
    } catch { /* khong co am thanh */ }
    ov.addEventListener('click', (e) => { e.stopPropagation(); stop(); });
    root.appendChild(ov);
  }

  // ── Cap nhat moi giay (chi doi DOM khi gia tri doi — moi lan ve lai la mot khung truyen qua WiFi) ──
  function tick() {
    const t = deviceNow();
    if (t) {
      const hm = pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes());
      setText(pillT, hm); pillChev.style.display = 'none';
      clockEls.forEach((e) => setText(e, hm));
      const dt = dateText(t); dateEls.forEach((e) => setText(e, dt));
    } else { setText(pillT, ''); pillChev.style.display = ''; }
    const tm = st?.tm;
    if (tm && tm.endsAt > Date.now()) {
      const rem = Math.ceil((tm.endsAt - Date.now()) / 1000), h = Math.floor(rem / 3600), m = Math.floor(rem % 3600 / 60), s = rem % 60;
      setText(timerChip.lastChild as Element, (h ? h + ':' + pad2(m) : String(m)) + ':' + pad2(s));
      timerChip.classList.add('show');
    } else timerChip.classList.remove('show');
  }
  setInterval(tick, 1000);

  function applyState(s: DevState) {
    st = s;
    window.__rwvLastState = s;
    ctl.style.display = s.ctl ? '' : 'none';
    tilesBox.style.display = s.ctl && s.tg ? '' : 'none';
    bri.set(s.b); vol.set(s.v);
    if (s.tg) { tiles[0].set(s.tg.noSleep); tiles[1].set(s.tg.muted); tiles[2].set(s.tg.aec); }
    if (s.wx) {
      wxIcoBox.replaceChildren(weatherIcon(s.wx.code, s.wx.day));
      setText(wxTxt, s.wx.t + '°' + (s.wx.pp != null && s.wx.pp >= 30 ? '  ☂ ' + s.wx.pp + '%' : ''));
      wxChip.classList.add('show');
      if (homeWx) {
        homeWxIco!.replaceChildren(weatherIcon(s.wx.code, s.wx.day));
        setText(homeWxT!, s.wx.t + '°');
        setText(homeWxS!, s.wx.name + (s.wx.pp != null ? ' · mưa ' + s.wx.pp + '%' : ''));
        homeWx.classList.add('show');
      }
    }
    tick();
    try { window.dispatchEvent(new CustomEvent('rwv-state', { detail: s })); } catch { /* */ }
  }

  // ── API cho server ──────────────────────────────────────────────────
  let gStartVisible = 0, gLastY = 0;
  window.__rwvShell = {
    state: applyState,
    /** Cu chi keo tu mep tren do server nhan dien: y = vi tri ngon tay (px trang). */
    gesture(phase: 'start' | 'move' | 'end', y: number) {
      const h = fullH();
      if (phase === 'start') { tick(); gStartVisible = shadeVisible; gLastY = y; if (CFG.motion !== 'full') { openShade(false); } return; }
      if (phase === 'move') { gLastY = y; if (CFG.motion === 'full') setVisible(Math.max(gStartVisible, y), false); return; }
      // end: qua 1/3 chieu cao thi mo han, khong thi dong
      if (CFG.motion !== 'full') return;
      if (Math.max(gStartVisible, gLastY) > h / 3) openShade(true); else closeShade(true);
    },
    open() { openShade(true); },
    close() { closeShade(true); },
    isOpen() { return shadeVisible > 0; },
    alarm,
  };
  window.__rwvDeviceState = applyState;   // ten cu (server < 2.9.45 goi ten nay)
  window.__rwvAlarm = alarm;

  function mount() {
    if (!document.documentElement) { requestAnimationFrame(mount); return; }
    document.documentElement.appendChild(host);
    setVisible(0, false);
    sendControl({ hello: 1 });  // xin server trang thai thiet bi
  }
  mount();
})();
