// (25/09/2026) SHELL — giao dien he thong kieu dien thoai, tiem vao MOI tab cua panel (xem docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md).
//   - Dong ho giua mep tren: CHI hien thi (26/09: cham xuyen qua xuong tab HA).
//   - Thanh keo xuong: SERVER nhan dien cu chi keo tu mep tren (src/gestures.ts) roi goi __rwvShell.gesture(...).
//     Dong: cham nen mo / vuot len tren thanh.
//   - Man hinh chinh cua OS (/os/home): tien ich + luoi ung dung + dock (Home Assistant dau tien).
// Du lieu: window.__RWV_CFG (server chen khi tiem) + trang thai thiet bi server day qua __rwvShell.state().
// Shadow DOM DONG: CSS cua trang khong anh huong. Chi DOM API (Trusted Types).
import { CSS } from './styles';
import { el, mdi, pad2, setText, svgEl } from './dom';
import { App, appIcon, weatherIcon } from './icons';
import { HomeApi, mountHome } from './home';
import type { HomeLayout } from '../homeLayout';

declare global { interface Window { [k: string]: any } }

type Motion = 'full' | 'reduced' | 'minimal';
interface Cfg {
  apps: App[]; home?: HomeLayout; groups: [string, string][]; motion: Motion;
  urls: { osHome: string; ha: string; weather: string; timer: string; cams: string; scenes: string };
  bindings: { url: string; control: string };
}
interface DevState {
  b: number | null; v: number | null; on: boolean; ctl: boolean; tv: boolean; skewMs: number; tz: number;
  tg: { noSleep: boolean; muted: boolean; aec: boolean } | null;
  wx: { t: number; code: number; day: boolean; pp: number | null; name: string } | null;
  tm: { endsAt: number; label: string } | null;
  /** (26/09/2026) Tab nen dang phat (Radio/Nhac): k = khoa tab o server, l = ten ung dung. Server < 2.9.49 khong gui. */
  np?: { k: string; l: string }[];
  /** (26/09/2026 OS-5) Thong bao moi nhat truoc + Khong lam phien. Server < 2.9.53 khong gui. */
  nt?: Notice[];
  dnd?: boolean;
  /** (27/09/2026) Firmware co tro ly giong noi (nut "Tro ly"). */
  va?: boolean;
}
interface Notice { id: number; t: string; m: string; p: 'normal' | 'high' | 'critical'; ts: number; img: string | null; act: boolean }

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
  // (26/09/2026 OS-2) MOI ung dung la MOT TAB rieng o server (docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 3.1):
  // cham mot ung dung KHONG con dieu huong tab hien tai (location.href) ma xin SERVER chuyen sang dung tab do —
  // server tu tao tab neu chua co, giu am cac tab khac (radio/nhac van phat khi khong active). Nho vay quay lai
  // Home Assistant tuc thi, khong tai lai.
  function openApp(id: string): void { closeShade(false); closeRecents(); sendControl({ app: id }); }
  function openRecents(): void { closeShade(false); sendControl({ recents: 1 }); }
  function hasApp(id: string): boolean { return CFG.apps.some((a) => a.id === id); }

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
  timerChip.addEventListener('click', () => openApp('timer'));
  wxChip.addEventListener('click', () => openApp('weather'));
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
  // (26/09/2026) 'ns' (No Sleep cua firmware) doi ten thanh "Man hinh cho": BAT = khong tat den nen, ranh thi hien man
  // hinh cho (dong ho); TAT = tat den nen sau Sleep time. Cung cong tac, chi doi ten/bieu tuong cho dung y nghia.
  const tiles = [makeTile('ns', 'Màn hình chờ', 'clock', '#fbbf24'), makeTile('mu', 'Tắt tiếng', 'mute', '#f87171'), makeTile('aec', 'Khử vọng', 'mic_aec', '#34d399')];
  // (26/09/2026 OS-5) Khong lam phien: o SERVER (khong can firmware ho tro) nen hien tren moi man hinh.
  const dndTile = makeTile('dnd', 'Không làm phiền', 'bell_off', '#a78bfa');
  const tilesBox = el('div', 'tiles'); tiles.forEach((t) => tilesBox.appendChild(t.el)); tilesBox.appendChild(dndTile.el);

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
  let vaBtn: HTMLElement | null = null;
  const SC: [string, string, string | null, () => void][] = [
    ['apps', 'Ứng dụng', null, () => openApp('__system')],
    ['ha', 'Home Assistant', 'home', () => openApp('home')],
    ['cams', 'Camera', 'cams', () => openApp('cams')],
    ['scenes', 'Cảnh', 'scenes', () => openApp('scenes')],
    ['recents', 'Gần đây', null, openRecents],
    ['settings', 'Cài đặt', 'settings', () => openApp('settings')],
    ['mic', 'Trợ lý', '__va', () => { closeShade(false); sendControl({ assist: 1 }); }],
  ];
  for (const [icon, label, appId, fn] of SC) {
    // Chi hien khi ung dung THAT SU co (chua bi an o Menu panel, hoac chua co Home URL) — khong de nut chet.
    if (appId && appId !== '__va' && !hasApp(appId)) continue;
    const b = el('button', 'sc');
    if (appId === '__va') { b.style.display = 'none'; vaBtn = b; } const c = el('span', 'b'); c.appendChild(mdi(icon)); b.append(c, el('span', 'l', label));
    if (icon === 'ha') c.style.background = '#1a8fd6';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    shortcuts.appendChild(b);
  }
  // The "Dang phat" (docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 5.2): Radio/Nhac dang phat nen -> Mo lai / Dung ngay,
  // khong phai mo lai dung ung dung do moi tat duoc. Chi dung lai DOM khi danh sach DOI (moi lan ve = mot khung WiFi).
  const npBox = el('div', 'np');
  npBox.style.display = 'none';
  let npSig = '';
  function renderNowPlaying(list: { k: string; l: string }[]) {
    const sig = JSON.stringify(list);
    if (sig === npSig) return;
    npSig = sig;
    npBox.replaceChildren(...list.map((it) => {
      const row = el('div', 'np-row');
      const txt = el('div', 'np-t'); txt.append(el('span', 'np-l', it.l), el('span', 'np-s', 'Đang phát nền'));
      const open = el('button', 'np-b', 'Mở');
      open.addEventListener('click', (e) => { e.stopPropagation(); openApp(it.k); });
      const stop = el('button', 'np-b stop'); stop.setAttribute('aria-label', 'Dừng ' + it.l); stop.appendChild(mdi('stop'));
      stop.addEventListener('click', (e) => { e.stopPropagation(); row.classList.add('busy'); sendControl({ stop: it.k }); });
      row.append(mdi('music'), txt, open, stop);
      return row;
    }));
    npBox.style.display = list.length ? '' : 'none';
    if (shadeVisible > 0) setVisible(fullH(), false);  // bang dang mo: chieu cao noi dung vua doi
  }
  // Thong bao (OS-5): danh sach trong thanh keo xuong — cham = mo ung dung/URL kem theo, x = xoa, "Xoa het".
  const ntBox = el('div', 'nt'); ntBox.style.display = 'none';
  let ntSig = '';
  function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return s < 60 ? 'vừa xong' : s < 3600 ? Math.floor(s / 60) + ' phút' : s < 86400 ? Math.floor(s / 3600) + ' giờ' : Math.floor(s / 86400) + ' ngày';
  }
  function noticeIcon(n: Notice, cls: string): HTMLElement {
    const box = el('div', cls + ' ' + n.p);
    if (n.img) { const im = document.createElement('img'); im.alt = ''; im.src = n.img; im.addEventListener('error', () => { im.replaceWith(mdi('bell')); }); box.appendChild(im); }
    else box.appendChild(mdi('bell'));
    return box;
  }
  function renderNotices(list: Notice[]) {
    const sig = JSON.stringify(list.map((n) => n.id));
    pill.classList.toggle('unread', list.length > 0);
    if (sig === ntSig) { ntBox.querySelectorAll<HTMLElement>('[data-ts]').forEach((e) => setText(e, ago(Number(e.dataset.ts)))); return; }
    ntSig = sig;
    ntBox.style.display = list.length ? '' : 'none';
    const head = el('div', 'nt-head'); head.append(el('span', 'nt-h', 'Thông báo'), el('div', 'spacer'));
    const clr = el('button', 'nt-clr', 'Xoá hết'); clr.addEventListener('click', (e) => { e.stopPropagation(); sendControl({ ntClear: 1 }); });
    head.appendChild(clr);
    const rows = list.slice(0, 4).map((n) => {
      const row = el('div', 'nt-row');
      const txt = el('div', 'nt-txt'); const top = el('div', 'nt-top');
      const when = el('span', 'nt-ago', ago(n.ts)); when.dataset.ts = String(n.ts);
      top.append(el('span', 'nt-t', n.t || n.m), when);
      txt.append(top); if (n.t && n.m) txt.appendChild(el('div', 'nt-m', n.m));
      const x = el('button', 'nt-x', '✕'); x.setAttribute('aria-label', 'Xoá thông báo');
      x.addEventListener('click', (e) => { e.stopPropagation(); row.remove(); sendControl({ ntDel: n.id }); });
      row.append(noticeIcon(n, 'nt-ic'), txt, x);
      row.addEventListener('click', (e) => { e.stopPropagation(); closeShade(false); sendControl(n.act ? { ntOpen: n.id } : { ntDel: n.id }); });
      return row;
    });
    ntBox.replaceChildren(head, ...rows);
    if (shadeVisible > 0) setVisible(fullH(), false);
  }
  inner.append(info, ctl, npBox, ntBox, shortcuts);

  // Chieu cao, keo, mo/dong. Muc 'full' (P4): keo theo ngon; 'reduced'/'minimal' (S3): nhay thang.
  let shadeVisible = 0;
  const fullH = () => inner.offsetHeight;
  function setVisible(px: number, animate: boolean) {
    // Khong cao hon man hinh: noi dung nhieu hon (vd nhieu the Dang phat tren S3 480x272) thi cuon trong bang.
    const h = Math.min(fullH(), window.innerHeight);
    shade.classList.toggle('scroll', fullH() > h);
    shadeVisible = Math.max(0, Math.min(h, px));
    const anim = animate && CFG.motion === 'full';
    shade.classList.toggle('anim', anim); scrim.classList.toggle('anim', anim);
    shade.style.height = shadeVisible + 'px';
    scrim.style.opacity = String(h ? (shadeVisible / h) * 0.55 : 0);
    scrim.classList.toggle('on', shadeVisible > 0);
    pillChev.style.transform = shadeVisible > 0 ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)';
  }
  function openShade(animate: boolean) { hideToast(); tick(); setVisible(fullH(), animate); }
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
  let homeApi: HomeApi | null = null;
  function launch(app: App) {
    if (app.action === 'url') { closeShade(false); openUrlBox(); return; }
    openApp(app.id);
  }
  function startHome() {
    homeApi = mountHome({
      apps: CFG.apps, home: CFG.home, groups: CFG.groups, motion: CFG.motion, root, shadow,
      launch, openApp, openRecents, send: sendControl, clockEls, dateEls,
    });
    ({ box: homeWx, ico: homeWxIco, t: homeWxT, s: homeWxS } = homeApi.wx);
  }
  const isHome = (() => { try { return new URL(CFG.urls.osHome).pathname === location.pathname && location.port === new URL(CFG.urls.osHome).port; } catch { return false; } })();
  if (isHome) startHome();
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

  // ── Gan day (OS-3): the anh chup tung ung dung dang mo — cham de chuyen, x / vuot len de dong ──
  interface RecentCard { k: string; l: string; t: string | null; p: boolean; a: boolean }
  let recentsEl: HTMLElement | null = null;
  function closeRecents(): void { recentsEl?.remove(); recentsEl = null; }
  function appFor(c: RecentCard): App {
    return CFG.apps.find((a) => a.id === c.k)
      || { id: c.k, label: c.l, kind: c.k === 'browser' ? 'browser' : 'generic', color: '#475569', group: '' };
  }
  function renderRecents(list: RecentCard[], open: boolean): void {
    window.__rwvLastRecents = list;
    if (!open && !recentsEl) return;           // cap nhat sau khi dong mot the, nhung nguoi dung da thoat Gan day
    const fresh = !recentsEl;
    if (!recentsEl) {
      recentsEl = el('div', 'recents');
      recentsEl.addEventListener('click', (e) => { if (e.target === recentsEl || (e.target as Element).classList?.contains('rc-row')) closeRecents(); });
      root.appendChild(recentsEl);
    }
    recentsEl.classList.toggle('anim', fresh && CFG.motion === 'full');
    const head = el('div', 'rc-head'); head.append(el('span', 't', 'Gần đây'), el('div', 'spacer'));
    if (list.some((c) => !c.p && !c.a)) {
      const all = el('button', 'rc-all', 'Đóng tất cả');
      all.addEventListener('click', (e) => { e.stopPropagation(); sendControl({ closeAll: 1 }); });
      head.appendChild(all);
    }
    const row = el('div', 'rc-row');
    const ar = String(window.innerWidth / Math.max(1, window.innerHeight));
    for (const c of list) {
      const card = el('div', 'rc'); if (c.a) card.classList.add('cur');
      card.style.setProperty('--ar', ar);
      const top = el('div', 'rc-top'); top.append(appIcon(appFor(c), 'app-ic'), el('span', 'rc-l', c.l));
      const canClose = !c.p && !c.a;
      if (canClose) {
        const x = el('button', 'rc-x', '✕'); x.setAttribute('aria-label', 'Đóng ' + c.l);
        x.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
        top.appendChild(x);
      }
      const img = el('div', 'rc-img');
      if (c.t) {
        const im = document.createElement('img'); im.alt = ''; im.src = c.t;
        im.addEventListener('error', () => { im.remove(); img.appendChild(appIcon(appFor(c), 'rc-ph')); });
        img.appendChild(im);
      } else img.appendChild(appIcon(appFor(c), 'rc-ph'));
      card.append(top, img);
      function dismiss() {
        card.classList.add('gone');
        sendControl({ close: c.k });
      }
      // Vuot len tren the de dong (P4 keo theo ngon); cham = chuyen sang ung dung do.
      let sy = 0, dy = 0, drag = false;
      card.addEventListener('pointerdown', (e) => { sy = e.clientY; dy = 0; drag = true; });
      card.addEventListener('pointermove', (e) => {
        if (!drag) return; dy = e.clientY - sy;
        if (canClose && dy < -10 && CFG.motion === 'full') card.style.transform = `translateY(${dy}px)`;
      });
      const end = () => {
        if (!drag) return; drag = false;
        if (canClose && dy < -70) { dismiss(); return; }
        card.style.transform = '';
      };
      card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Math.abs(dy) > 12) return;
        if (c.a) closeRecents(); else openApp(c.k);
      });
      row.appendChild(card);
    }
    if (!list.length) row.appendChild(el('div', 'rc-empty', 'Không có ứng dụng nào đang mở'));
    recentsEl.replaceChildren(head, row);
    // Cuon cho the TRUOC (ung dung dung ngay truoc) vao giua — dung thao tac chuyen qua lai nhanh nhat.
    if (fresh && row.scrollWidth > row.clientWidth + 8) {
      const second = row.children[1] as HTMLElement | undefined;
      second?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }

  // ── Quay lai (OS-3): bong bong mui ten o mep khi vuot tu mep trai/phai (server nhan dien, src/gestures.ts) ──
  // Doi mau nhan khi da qua nguong = tha tay la Quay lai. Muc 'full' (P4) bong bong chay theo ngon tay; S3 chi ve lai
  // khi trang thai "da qua nguong" doi (moi khung ve lai la bang thong WiFi).
  const backEl = el('div', 'backbub'); backEl.appendChild(mdi('back'));
  root.appendChild(backEl);
  function backGesture(phase: 'start' | 'move' | 'end', side: 'left' | 'right', d: number, y: number): void {
    if (phase === 'end') { backEl.classList.remove('on', 'armed'); backEl.style.transform = ''; return; }
    const thr = Math.max(60, Math.round(window.innerWidth * 0.08));
    const armed = d >= thr;
    if (phase === 'move' && CFG.motion !== 'full' && armed === backEl.classList.contains('armed')) return;
    backEl.classList.add('on');
    backEl.classList.toggle('armed', armed);
    backEl.classList.toggle('right', side === 'right');
    backEl.style.top = Math.max(8, Math.min(window.innerHeight - 60, y - 26)) + 'px';
    const off = (CFG.motion === 'full' ? Math.min(d, thr) : thr) * 0.5;
    backEl.style.transform = `translateX(${side === 'left' ? off : -off}px)`;
  }

  // ── Vuot len tu mep duoi: thanh chi bao + goi y (tha = Man hinh chinh, giu = Gan day) — nhu dien thoai ──
  const homeBar = el('div', 'homebar'); const homeHint = el('div', 'hb-t'); homeBar.append(homeHint, el('div', 'hb-pill'));
  root.appendChild(homeBar);
  function homeDrag(phase: 'start' | 'move' | 'end', d: number): void {
    if (phase === 'end') { homeBar.classList.remove('on'); homeBar.style.transform = ''; return; }
    const thrRecents = Math.max(90, Math.round(window.innerHeight * 0.15));
    const hint = d >= thrRecents ? 'Giữ: Gần đây · Thả: Màn hình chính' : d > 50 ? 'Thả: Màn hình chính' : '';
    const changed = homeHint.textContent !== hint || !homeBar.classList.contains('on');
    if (!changed && CFG.motion !== 'full') return;          // S3: chi ve lai khi goi y doi
    setText(homeHint, hint);
    homeBar.classList.add('on');
    homeBar.classList.toggle('armed', d >= thrRecents);
    const lift = CFG.motion === 'full' ? Math.min(d, thrRecents * 1.3) * 0.5 : 0;
    homeBar.style.transform = `translateX(-50%) translateY(${-lift}px)`;
  }

  // ── Man hinh cho (OS-5): server bat sau mot luc khong cham (src/screensaver.ts). Dong ho lon + ngay am duong + thoi
  // tiet tren nen den; dich cho moi phut (chong luu anh), tong am toi tu 22h-6h. Cham = tat (cham do KHONG toi trang). ──
  let saverEl: HTMLElement | null = null, svBox: HTMLElement, svClock: HTMLElement, svDate: HTMLElement, svWx: HTMLElement;
  let svShiftMin = -1, svWxSig = '';
  // (27/09/2026) Nen anh gia dinh (server gui URL moi phut, null = chi dong ho — ban dem / khong co anh). Hai lop
  // chong mo cheo; anh tai xong moi hien (mang cham thi giu anh cu).
  let svPh: HTMLElement[] = [], svTop = 0;
  function saverPhoto(url: string | null): void {
    if (!saverEl) return;
    if (!url || saverEl.classList.contains('night')) { saverEl.classList.remove('photo'); svPh.forEach((p) => p.classList.remove('show')); return; }
    const img = new Image();
    img.onload = () => {
      if (!saverEl) return;
      const next = svPh[1 - svTop];
      next.style.backgroundImage = `url("${url}")`;
      next.classList.add('show'); svPh[svTop].classList.remove('show'); svTop = 1 - svTop;
      saverEl.classList.add('photo');
    };
    img.src = url;
  }
  function screensaver(on: boolean): void {
    if (!on) { saverEl?.remove(); saverEl = null; return; }
    if (saverEl || !deviceNow()) return;
    closeShade(false); closeRecents();
    saverEl = el('div', 'saver'); svBox = el('div', 'sv-box');
    svClock = el('div', 'sv-clock'); svDate = el('div', 'sv-date'); svWx = el('div', 'sv-wx');
    svBox.append(svClock, svDate, svWx);
    svPh = [el('div', 'sv-ph'), el('div', 'sv-ph')]; svTop = 0;
    saverEl.append(svPh[0], svPh[1], svBox);
    if (CFG.motion === 'full') saverEl.classList.add('anim');
    // Tat o 'click' (khong phai pointerdown): neu go lop phu ngay luc cham xuong thi 'click' sau do roi xuong trang.
    saverEl.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    saverEl.addEventListener('click', (e) => { e.stopPropagation(); screensaver(false); sendControl({ wake: 1 }); });
    root.appendChild(saverEl);
    svShiftMin = -1; svWxSig = '';
    updateSaver();
  }
  function updateSaver(): void {
    const t = deviceNow();
    if (!saverEl || !t) return;
    const h = t.getUTCHours(), m = t.getUTCMinutes();
    setText(svClock, pad2(h) + ':' + pad2(m));
    setText(svDate, dateText(t));
    saverEl.classList.toggle('night', h >= 22 || h < 6);
    const w = st?.wx;
    const sig = w ? `${w.code}|${w.day}|${w.t}|${w.name}` : '';
    if (sig !== svWxSig) {
      svWxSig = sig;
      svWx.replaceChildren(...(w ? [weatherIcon(w.code, w.day), el('span', '', `${w.t}° · ${w.name}`)] : []));
    }
    if (m !== svShiftMin) {  // moi phut mot vi tri moi — cung khung voi luc doi so phut, khong ton them khung nao
      svShiftMin = m;
      // Dang khung anh: dong ho o goc duoi trai -> chi dich vao trong (khong ra ngoai mep).
      const ph = saverEl.classList.contains('photo');
      const dx = ph ? Math.random() * 4 : (Math.random() * 2 - 1) * 7, dy = ph ? -Math.random() * 4 : (Math.random() * 2 - 1) * 9;
      svBox.style.transform = `translate(${dx.toFixed(1)}vw, ${dy.toFixed(1)}vh)`;
    }
  }

  // ── The thong bao noi (OS-5): truot xuong tu mep tren; tu an (normal 8 s, high 20 s), critical giu toi khi cham ──
  let toastEl: HTMLElement | null = null, toastTimer: number | undefined;
  function hideToast() { clearTimeout(toastTimer); toastEl?.remove(); toastEl = null; }
  function chime(strong: boolean) {
    try {
      const ctx = new AudioContext();
      const notes = strong ? [880, 660, 880, 660] : [880, 660];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + i * 0.22;
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.21);
      });
      setTimeout(() => { try { ctx.close(); } catch { /* */ } }, 1500);
    } catch { /* khong co am thanh */ }
  }
  function notify(n: Notice, sound: boolean): void {
    window.__rwvLastNotice = n;
    hideToast(); screensaver(false);
    const t = el('div', 'toast ' + n.p); if (CFG.motion === 'full') t.classList.add('anim');
    const txt = el('div', 'to-txt'); txt.append(el('div', 'to-t', n.t || n.m));
    if (n.t && n.m) txt.appendChild(el('div', 'to-m', n.m));
    const x = el('button', 'to-x', '✕'); x.setAttribute('aria-label', 'Đóng');
    x.addEventListener('click', (e) => { e.stopPropagation(); hideToast(); });
    t.append(noticeIcon(n, 'to-ic'), txt, x);
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    t.addEventListener('click', (e) => { e.stopPropagation(); hideToast(); if (n.act) sendControl({ ntOpen: n.id }); });
    root.appendChild(t); toastEl = t;
    if (n.p !== 'critical') toastTimer = window.setTimeout(hideToast, n.p === 'high' ? 20000 : 8000);
    if (sound) chime(n.p === 'critical');
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
    updateSaver();
    if (shadeVisible > 0 && st?.nt) renderNotices(st.nt);  // cap nhat "x phut" khi bang dang mo
  }
  setInterval(tick, 1000);

  function applyState(s: DevState) {
    st = s;
    if (vaBtn) vaBtn.style.display = s.va ? '' : 'none';
    window.__rwvLastState = s;
    // Khong lam phien la cua server -> hang o nhanh luon hien; o/thanh truot cua THIET BI chi khi firmware ho tro.
    sliders.style.display = s.ctl ? '' : 'none';
    tiles.forEach((t) => { t.el.style.display = s.ctl && s.tg ? '' : 'none'; });
    dndTile.el.style.display = s.dnd == null ? 'none' : '';
    if (s.dnd != null) dndTile.set(s.dnd);
    renderNotices(s.nt || []);
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
    renderNowPlaying(s.np || []);
    tick();
    try { window.dispatchEvent(new CustomEvent('rwv-state', { detail: s })); } catch { /* */ }
  }

  // ── (27/09/2026) The TRO LY GIONG NOI: firmware bao trang thai (remote_webview.voice_state) -> server -> day.
  //    Dang nghe / dang xu ly (kem cau ban vua noi) / tra loi (kem cau tra loi) / loi. Cham the: dung (dang nghe)
  //    hoac dong. Xong: an sau vai giay (du doc cau tra loi).
  const VOICE_LABEL = ['Trợ lý', 'Đang nghe…', 'Đang xử lý…', 'Trợ lý', 'Không thực hiện được'];
  let vcEl: HTMLElement | null = null, vcIc: HTMLElement, vcL: HTMLElement, vcQ: HTMLElement, vcA: HTMLElement;
  let vcTimer: number | undefined, vcState = 0, vcAsked = '';
  function voiceHide() { clearTimeout(vcTimer); vcEl?.remove(); vcEl = null; vcAsked = ''; }
  function voice(v: { s: number; t: string }): void {
    clearTimeout(vcTimer);
    if (v.s === 0) {  // xong: giu cau tra loi mot luc roi an
      if (vcEl) vcTimer = window.setTimeout(voiceHide, vcA?.textContent ? 6000 : 1200);
      return;
    }
    if (!vcEl) {
      screensaver(false);
      vcEl = el('div', 'vc' + (CFG.motion === 'full' ? ' anim' : ''));
      vcIc = el('div', 'vc-ic'); vcIc.appendChild(mdi('mic'));
      const col = el('div', 'vc-t');
      vcL = el('div', 'vc-l'); vcQ = el('div', 'vc-q'); vcA = el('div', 'vc-a');
      col.append(vcL, vcQ, vcA);
      vcEl.append(vcIc, col);
      vcEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (vcState === 1 || vcState === 2) sendControl({ assist: 0 });
        voiceHide();
      });
      root.appendChild(vcEl);
    }
    vcState = v.s;
    vcEl.dataset.s = String(v.s);
    setText(vcL, VOICE_LABEL[v.s] || '');
    if (v.s === 1) { vcAsked = ''; setText(vcQ, ''); setText(vcA, ''); }
    if (v.s === 2 && v.t) vcAsked = v.t;
    setText(vcQ, vcAsked ? '“' + vcAsked + '”' : '');
    if (v.s === 3 || v.s === 4) setText(vcA, v.t || '');
    // Loi: tu an sau 8 s neu firmware khong bao "xong"
    if (v.s === 4) vcTimer = window.setTimeout(voiceHide, 8000);
    window.__rwvLastVoice = { s: v.s, l: vcL.textContent, q: vcQ.textContent, a: vcA.textContent };
  }

  // ── API cho server ──────────────────────────────────────────────────
  let gStartVisible = 0, gLastY = 0;
  window.__rwvShell = {
    state: applyState,
    /** Cu chi keo tu mep tren do server nhan dien: y = vi tri ngon tay (px trang). */
    gesture(phase: 'start' | 'move' | 'end', y: number) {
      const h = fullH();
      if (phase === 'start') { hideToast(); tick(); gStartVisible = shadeVisible; gLastY = y; if (CFG.motion !== 'full') { openShade(false); } return; }
      if (phase === 'move') { gLastY = y; if (CFG.motion === 'full') setVisible(Math.max(gStartVisible, y), false); return; }
      // end: qua 1/3 chieu cao thi mo han, khong thi dong
      if (CFG.motion !== 'full') return;
      if (Math.max(gStartVisible, gLastY) > h / 3) openShade(true); else closeShade(true);
    },
    open() { openShade(true); },
    recents: renderRecents,
    back: backGesture,
    homeDrag,
    screensaver,
    notify,
    close() { closeShade(true); },
    isOpen() { return shadeVisible > 0; },
    alarm,
    voice,
    saverPhoto,
    /** (27/09/2026 OS-3) Bo cuc man hinh chinh vua doi (tu panel khac). */
    layout(l: HomeLayout) { homeApi?.setLayout(l); },
    homeInfo() { return homeApi?.info() ?? null; },
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
