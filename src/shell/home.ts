// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026 OS-3) MAN HINH CHINH cua OS (/os/home): tien ich + luoi ung dung chia trang + dock, va CHE DO SAP XEP
// kieu may tinh bang:
//   - Cham giu mot ung dung ~0,5 s -> vao che do sap xep va nhac ung dung len luon (keo theo ngon).
//   - Keo sang canh ung dung khac -> doi cho; tha vao GIUA ung dung khac -> gop thanh thu muc (tha vao thu muc -> them).
//   - Keo xuong dock (toi da 5) / ra khoi dock; giu sat mep trai/phai -> sang trang.
//   - Cham thu muc -> mo; trong che do sap xep keo ung dung ra ngoai khung thu muc -> lay ra; cham chip -> doi ten.
//   - "Xong" hoac cham cho trong -> thoat. Moi lan tha: gui bo cuc cho server luu (dung chung ca 3 panel).
// Khong co hieu ung chay lien tuc (rung icon kieu iOS) — moi khung dong la bang thong WiFi toi panel.
import { el, setText } from './dom';
import { App, appIcon } from './icons';
import { DOCK_MAX, FOLDER_MAX, HomeFolder, HomeItem, HomeLayout, isFolder, resolveLayout } from '../homeLayout';

type Motion = 'full' | 'reduced' | 'minimal';
export interface HomeCtx {
  apps: App[];
  home?: HomeLayout;
  groups: [string, string][];
  motion: Motion;
  root: HTMLElement;
  shadow: ShadowRoot;
  launch(app: App): void;
  openApp(id: string): void;
  send(obj: unknown): void;
  clockEls: Element[];
  dateEls: Element[];
}
export interface HomeApi {
  wx: { box: HTMLElement; ico: HTMLElement; t: HTMLElement; s: HTMLElement };
  setLayout(l: HomeLayout): void;
  /** Cho thu tich hop (Shadow DOM dong): trang thai + vi tri tung o. */
  info(): { fit: number[]; editing: boolean; folder: string | null; page: number; rows: number; cols: number; layout: HomeLayout; tiles: Record<string, number[]> };
}

const LONG_PRESS_MS = 480;
const EDIT_PRESS_MS = 200;   // trong che do sap xep: nhac len nhanh hon
const MOVE_SLOP = 10;
const EDGE_PX = 34, EDGE_MS = 650;
const FOLDER_NAMES = ['Thư mục', 'Nhà', 'Giải trí', 'Tiện ích', 'Camera', 'Media', 'Hay dùng'];

const keyOf = (it: HomeItem): string => (isFolder(it) ? it.f : it);

export function mountHome(ctx: HomeCtx): HomeApi {
  const byId = new Map(ctx.apps.map((a) => [a.id, a]));
  const appIds = ctx.apps.map((a) => a.id);
  let layout: HomeLayout = resolveLayout(ctx.home ?? null, appIds);

  const home = el('div', 'home');
  // ── Tien ich: dong ho lon + thoi tiet ──
  const widgets = el('div', 'widgets');
  const wc = el('div', 'w-clock'); const hc = el('div', 'clock'); const hd = el('div', 'date');
  wc.append(hc, hd); ctx.clockEls.push(hc); ctx.dateEls.push(hd);
  const wxBox = el('button', 'w-wx'); const wxIco = el('span'); const col = el('div'); const wxT = el('div', 't'); const wxS = el('div', 's');
  col.append(wxT, wxS); wxBox.append(wxIco, col);
  wxBox.addEventListener('click', () => { if (!editing) ctx.openApp('weather'); });
  // Thanh che do sap xep (thay cho tien ich khi dang sap)
  const editBar = el('div', 'editbar');
  const ebHint = el('div', 'eb-t', 'Kéo để sắp xếp · thả vào giữa ứng dụng khác để tạo thư mục');
  const ebReset = el('button', 'eb-b', 'Đặt lại');
  const ebDone = el('button', 'eb-b pri', 'Xong');
  editBar.append(ebHint, ebReset, ebDone);
  widgets.append(wc, el('div', 'spacer'), wxBox);

  const pager = el('div', 'pager'); const pages = el('div', 'pages'); pager.appendChild(pages);
  const dots = el('div', 'dots');
  const dock = el('div', 'dock');
  home.append(widgets, pager, dots, dock, editBar);
  ctx.root.insertBefore(home, ctx.root.firstChild);
  document.title = 'Ứng dụng';

  // Luoi: so cot/hang theo kich thuoc man hinh
  const W = window.innerWidth, H = window.innerHeight;
  const cols = W >= 900 ? 7 : W >= 600 ? 5 : 4;
  // So hang: DO sau lan ve dau (chieu cao vung luoi / chieu cao mot o) — 1024x600 duoc 3 hang, 480x480 duoc 3-4,
  // 480x272 duoc 1. Uoc luong ban dau theo chieu cao man hinh.
  let rows = H >= 420 ? 2 : 1;
  let per = cols * rows;
  pager.style.setProperty('--cols', String(cols));

  let editing = false;
  let cur = 0, nPages = 1;
  let openFolderId: string | null = null;
  let fpop: HTMLElement | null = null;
  let resetArmed = 0;

  // ── Ve ──────────────────────────────────────────────────────────────
  function tileFor(it: HomeItem): HTMLElement | null {
    const b = el('div', 'app');
    b.dataset.k = keyOf(it);
    if (isFolder(it)) {
      b.classList.add('folder');
      const box = el('div', 'app-ic fold');
      it.a.slice(0, 4).forEach((id) => { const a = byId.get(id); if (a) box.appendChild(appIcon(a, 'mini')); });
      b.append(box, el('span', 'l', it.n));
    } else {
      const a = byId.get(it);
      if (!a) return null;
      b.setAttribute('data-app', a.kind);
      b.append(appIcon(a), el('span', 'l', a.label));
    }
    if (drag && drag.k === keyOf(it)) b.classList.add('ghost');
    if (drag && drag.mergeK === keyOf(it)) b.classList.add('merge');
    return b;
  }

  function render(): void {
    home.classList.toggle('editing', editing);
    const n = layout.items.length;
    // Dang sap: luon co them mot trang trong o cuoi neu trang cuoi da day (de keo sang trang moi)
    nPages = Math.max(1, Math.ceil(n / per) + (editing && n > 0 && n % per === 0 ? 1 : 0));
    const frag: HTMLElement[] = [];
    for (let p = 0; p < nPages; p++) {
      const page = el('div', 'page');
      page.style.setProperty('--cols', String(cols));
      page.dataset.p = String(p);
      layout.items.slice(p * per, (p + 1) * per).forEach((it) => { const t = tileFor(it); if (t) page.appendChild(t); });
      frag.push(page);
    }
    pages.replaceChildren(...frag);
    dots.replaceChildren();
    for (let p = 0; p < nPages && nPages > 1; p++) dots.appendChild(el('i'));
    const dockTiles = layout.dock.map((id) => tileFor(id)).filter((x): x is HTMLElement => !!x);
    // (01/10/2026) Bo nut "Gan day" co dinh cuoi dock (nguoi dung yeu cau) — van mo bang vuot len giu / thanh keo xuong.
    dock.replaceChildren(...dockTiles);
    showPage(cur, false);
    if (openFolderId) renderFolder();
    fitRows();
  }

  let fitted = false;
  function fitRows(): void {
    if (fitted) return;
    const page = pages.firstElementChild as HTMLElement | null;
    const tile = page?.querySelector('.app') as HTMLElement | null;
    if (!page || !tile || !page.clientHeight || !tile.offsetHeight) return;
    fitted = true;
    const cs = getComputedStyle(page);
    const gap = parseFloat(cs.rowGap) || 0, padTop = parseFloat(cs.paddingTop) || 0;
    const fit = Math.max(1, Math.min(6, Math.floor((page.clientHeight - padTop + gap) / (tile.offsetHeight + gap))));
    if (fit !== rows) { rows = fit; per = cols * rows; render(); }
  }

  function showPage(i: number, animate: boolean): void {
    cur = Math.max(0, Math.min(nPages - 1, i));
    pages.classList.toggle('anim', animate && ctx.motion !== 'minimal');
    pages.style.transform = `translateX(${-cur * 100}%)`;
    Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === cur));
  }

  // ── Thu muc ─────────────────────────────────────────────────────────
  const folderById = (f: string): HomeFolder | undefined => layout.items.find((x): x is HomeFolder => isFolder(x) && x.f === f);
  function renderFolder(): void {
    const f = openFolderId ? folderById(openFolderId) : undefined;
    if (!f) { closeFolder(); return; }
    if (!fpop) {
      fpop = el('div', 'fpop');
      home.appendChild(fpop);
    }
    const panel = el('div', 'fpanel');
    panel.appendChild(el('div', 'f-name', f.n));
    if (editing) {
      const chips = el('div', 'f-chips');
      for (const name of FOLDER_NAMES) {
        const c = el('button', 'fchip' + (name === f.n ? ' on' : ''), name);
        c.dataset.name = name;
        chips.appendChild(c);
      }
      panel.appendChild(chips);
    }
    const grid = el('div', 'f-grid');
    grid.style.setProperty('--cols', String(Math.min(cols, 4)));
    f.a.forEach((id) => {
      const t = tileFor(id);
      if (t) { t.dataset.in = f.f; grid.appendChild(t); }
    });
    panel.appendChild(grid);
    fpop.replaceChildren(panel);
  }
  function openFolder(f: string): void { openFolderId = f; renderFolder(); }
  function closeFolder(): void { openFolderId = null; fpop?.remove(); fpop = null; }

  // ── Che do sap xep ──────────────────────────────────────────────────
  function enterEdit(): void { if (!editing) { editing = true; resetArmed = 0; render(); } }
  function exitEdit(): void {
    if (!editing) return;
    editing = false; setText(ebReset, 'Đặt lại'); resetArmed = 0;
    render();
  }
  function save(): void { ctx.send({ home: layout }); }
  function normalize(): void { layout = resolveLayout(layout, appIds); }

  /** Bo item `k` khoi noi dang o (dock / luoi / thu muc). Tra ve item. */
  function detach(k: string): HomeItem | null {
    const di = layout.dock.indexOf(k);
    if (di >= 0) { layout.dock.splice(di, 1); return k; }
    const ii = layout.items.findIndex((x) => keyOf(x) === k);
    if (ii >= 0) return layout.items.splice(ii, 1)[0];
    for (const x of layout.items) {
      if (isFolder(x)) { const j = x.a.indexOf(k); if (j >= 0) { x.a.splice(j, 1); return k; } }
    }
    return null;
  }
  function where(k: string): { list: 'dock' | 'items'; i: number } | null {
    const di = layout.dock.indexOf(k);
    if (di >= 0) return { list: 'dock', i: di };
    const ii = layout.items.findIndex((x) => keyOf(x) === k);
    return ii >= 0 ? { list: 'items', i: ii } : null;
  }

  // ── Keo tha ─────────────────────────────────────────────────────────
  interface Drag { k: string; item: HomeItem; fl: HTMLElement; ox: number; oy: number; mergeK: string | null; edgeAt: number; inFolder: string | null }
  let drag: Drag | null = null;

  function startDrag(tile: HTMLElement, x: number, y: number): void {
    const k = tile.dataset.k!;
    const r = tile.getBoundingClientRect();
    const fl = tile.cloneNode(true) as HTMLElement;
    fl.className = 'app drag';
    fl.style.width = r.width + 'px';
    const ox = x - r.left, oy = y - r.top;
    fl.style.transform = `translate(${x - ox}px, ${y - oy}px) scale(1.08)`;
    home.appendChild(fl);
    const inFolder = tile.dataset.in || null;
    const item = layout.items.find((it) => keyOf(it) === k) ?? k;
    drag = { k, item, fl, ox, oy, mergeK: null, edgeAt: 0, inFolder };
    render();
  }

  function hitTile(x: number, y: number): { tile: HTMLElement | null; hit: Element | null } {
    const hit = ctx.shadow.elementFromPoint(x, y);
    const tile = (hit?.closest('.app[data-k]') as HTMLElement | null) ?? null;
    return { tile, hit };
  }

  function moveDrag(x: number, y: number): void {
    const d = drag!;
    d.fl.style.transform = `translate(${x - d.ox}px, ${y - d.oy}px) scale(1.08)`;
    const { tile, hit } = hitTile(x, y);

    // Trong thu muc: doi cho ben trong; keo ra ngoai khung -> lay ra luoi, ngay sau thu muc
    if (d.inFolder) {
      const f = folderById(d.inFolder);
      const inPanel = !!hit?.closest('.fpanel');
      if (f && inPanel) {
        if (tile && tile.dataset.in === f.f && tile.dataset.k !== d.k) {
          const from = f.a.indexOf(d.k), to = f.a.indexOf(tile.dataset.k!);
          if (from >= 0 && to >= 0) { f.a.splice(from, 1); f.a.splice(to, 0, d.k); renderFolder(); }
        }
        return;
      }
      if (f) {
        const at = layout.items.indexOf(f);
        f.a.splice(f.a.indexOf(d.k), 1);
        layout.items.splice(at + 1, 0, d.k);
      }
      d.inFolder = null;
      closeFolder();
      render();
      return;
    }

    // Giu sat mep -> sang trang
    const edge = x < EDGE_PX ? -1 : x > window.innerWidth - EDGE_PX ? 1 : 0;
    if (edge && !hit?.closest('.dock')) {
      const now = Date.now();
      if (!d.edgeAt) d.edgeAt = now;
      else if (now - d.edgeAt > EDGE_MS && cur + edge >= 0 && cur + edge < nPages) { d.edgeAt = now; showPage(cur + edge, true); }
    } else d.edgeAt = 0;

    const inDock = !!hit?.closest('.dock');
    const prevMerge = d.mergeK;
    let changed = false;
    if (tile && tile.dataset.k && tile.dataset.k !== d.k) {
      const tk = tile.dataset.k;
      const r = tile.getBoundingClientRect();
      const rx = (x - r.left) / r.width, ry = (y - r.top) / r.height;
      const canMerge = !inDock && !isFolder(d.item) && where(tk)?.list === 'items';
      if (canMerge && rx > 0.26 && rx < 0.74 && ry > 0.05 && ry < 0.8) {
        d.mergeK = tk;
      } else {
        d.mergeK = null;
        const dst = where(tk), me = where(d.k);
        const want = rx >= 0.5 ? 1 : -1;
        const already = !!dst && !!me && dst.list === me.list && me.i === dst.i + want;
        if (dst && !already && !(dst.list === 'dock' && (isFolder(d.item) || (layout.dock.length >= DOCK_MAX && !layout.dock.includes(d.k))))) {
          detach(d.k);
          const again = where(tk)!;
          const list = again.list === 'dock' ? layout.dock : layout.items;
          (list as HomeItem[]).splice(again.i + (rx >= 0.5 ? 1 : 0), 0, d.item);
          changed = true;
        }
      }
    } else if (!tile) {
      d.mergeK = null;
      if (inDock && !isFolder(d.item) && !layout.dock.includes(d.k) && layout.dock.length < DOCK_MAX) {
        detach(d.k); layout.dock.push(d.k); changed = true;
      } else if (hit?.closest('.page')) {
        // Cho trong cua trang dang xem: ve cuoi trang do
        const end = Math.min(layout.items.length, (cur + 1) * per);
        const w = where(d.k);
        const onThisPage = w?.list === 'items' && w.i >= cur * per && w.i < end;
        if (!onThisPage) {
          detach(d.k);
          layout.items.splice(Math.min(layout.items.length, (cur + 1) * per - 1), 0, d.item);
          changed = true;
        }
      }
    }
    if (changed || prevMerge !== d.mergeK) render();
  }

  function endDrag(): void {
    const d = drag!;
    drag = null;
    d.fl.remove();
    if (d.mergeK) {
      const target = layout.items.find((x) => keyOf(x) === d.mergeK);
      if (target && typeof d.item === 'string') {
        if (isFolder(target)) {
          if (target.a.length < FOLDER_MAX) { detach(d.k); target.a.push(d.item); }
        } else {
          const ta = byId.get(target), da = byId.get(d.item);
          const name = ta && da && ta.group === da.group ? (ctx.groups.find((g) => g[0] === ta.group)?.[1] ?? 'Thư mục') : 'Thư mục';
          detach(d.k);
          const at = layout.items.indexOf(target);
          layout.items.splice(at, 1, { f: 'f_' + Math.random().toString(36).slice(2, 10), n: name, a: [target, d.item] });
        }
      }
    }
    normalize();
    render();
    save();
  }

  // ── Su kien cham (mot bo cho ca man hinh chinh) ─────────────────────
  interface Press { x: number; y: number; tile: HTMLElement | null; target: Element; swiping: boolean; timer: number }
  let press: Press | null = null;
  home.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const target = e.target as Element;
    const tile = target.closest('.app[data-k]') as HTMLElement | null;
    press = { x: e.clientX, y: e.clientY, tile, target, swiping: false, timer: 0 };
    if (tile) {
      const p = press;
      p.timer = window.setTimeout(() => {
        if (press !== p || p.swiping) return;
        enterEdit();
        const fresh = tile.isConnected ? tile : (ctx.shadow.querySelector(`.app[data-k="${tile.dataset.k}"]`) as HTMLElement | null);
        if (fresh) startDrag(fresh, p.x, p.y);
      }, editing ? EDIT_PRESS_MS : LONG_PRESS_MS);
    }
  });
  home.addEventListener('pointermove', (e) => {
    if (drag) { moveDrag(e.clientX, e.clientY); return; }
    if (!press) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!press.swiping && Math.hypot(dx, dy) > MOVE_SLOP) {
      clearTimeout(press.timer);
      // Dang sap: keo ung dung la nhac len ngay (khong can giu)
      if (editing && press.tile && !openFolderId) { startDrag(press.tile, press.x, press.y); moveDrag(e.clientX, e.clientY); press = null; return; }
      if (editing && press.tile && openFolderId && press.tile.dataset.in) { startDrag(press.tile, press.x, press.y); moveDrag(e.clientX, e.clientY); press = null; return; }
      if (openFolderId) return;
      press.swiping = Math.abs(dx) > Math.abs(dy) && !!press.target.closest('.pager');
    }
    // (26/10/2026) LUON cap nhat vi tri khi dang keo, khong phu thuoc ctx.motion. Truoc day chi chay khi
    // motion === 'full'; panel S3 dat motion thap -> khong ve theo tay, chi nhay khi nha (do that: khung chi
    // doi sau khi nha tay o 480x480 / 480x272).
    if (press.swiping) {
      pages.classList.remove('anim');
      pages.style.transform = `translateX(calc(${-cur * 100}% + ${dx}px))`;
    }
  });
  const up = (e: PointerEvent) => {
    if (drag) { endDrag(); press = null; return; }
    const p = press; press = null;
    if (!p) return;
    clearTimeout(p.timer);
    const dx = e.clientX - p.x;
    if (p.swiping) { showPage(cur + (dx < -50 ? 1 : dx > 50 ? -1 : 0), true); return; }
    if (Math.hypot(dx, e.clientY - p.y) > MOVE_SLOP * 2) return;
    tap(p.target, p.tile);
  };
  home.addEventListener('pointerup', up);
  home.addEventListener('pointercancel', () => { if (drag) endDrag(); press = null; });

  function tap(target: Element, tile: HTMLElement | null): void {
    // Chip doi ten thu muc
    const chip = target.closest('.fchip') as HTMLElement | null;
    if (chip && openFolderId) {
      const f = folderById(openFolderId);
      if (f && chip.dataset.name) { f.n = chip.dataset.name; render(); save(); }
      return;
    }
    if (target.closest('.eb-b')) return;  // nut cua thanh sap xep: xu ly bang click rieng
    if (tile?.dataset.k) {
      const k = tile.dataset.k;
      const f = folderById(k);
      if (f) { openFolder(f.f); return; }
      if (!editing) { const a = byId.get(k); if (a) { closeFolder(); ctx.launch(a); } }
      return;
    }
    // Cho trong
    if (openFolderId && !target.closest('.fpanel')) { closeFolder(); return; }
    if (editing && !target.closest('.fpanel') && !target.closest('.w-wx')) exitEdit();
  }
  ebDone.addEventListener('click', (e) => { e.stopPropagation(); closeFolder(); exitEdit(); });
  ebReset.addEventListener('click', (e) => {
    e.stopPropagation();
    // Cham 2 lan trong 3 s moi dat lai (tranh bam nham)
    if (Date.now() - resetArmed > 3000) { resetArmed = Date.now(); setText(ebReset, 'Chạm lần nữa'); return; }
    resetArmed = 0; setText(ebReset, 'Đặt lại');
    layout = resolveLayout(null, appIds);
    closeFolder();
    render();
    ctx.send({ home: null });
  });

  render();
  // Do lai so hang khi vung luoi co kich thuoc that (Shell gan vao trang sau mot khung) hoac doi kich thuoc.
  try {
    let lastH = 0;
    new ResizeObserver(() => {
      const h = pager.clientHeight;
      if (h && Math.abs(h - lastH) > 4) { lastH = h; fitted = false; fitRows(); }
    }).observe(pager);
  } catch { /* trinh duyet cu: giu uoc luong */ }
  return {
    wx: { box: wxBox, ico: wxIco, t: wxT, s: wxS },
    setLayout(l: HomeLayout) {
      if (drag) return;  // dang keo: bo cuc cua minh se ghi de ngay khi tha
      layout = resolveLayout(l, appIds);
      render();
    },
    info() {
      const tiles: Record<string, number[]> = {};
      ctx.shadow.querySelectorAll<HTMLElement>('.app[data-k]').forEach((t) => {
        const r = t.getBoundingClientRect();
        const pg = (t.closest('.page') as HTMLElement | null)?.dataset.p;
        if (r.width > 0 && (pg == null || pg === String(cur)) && !t.classList.contains('drag')) tiles[t.dataset.k!] = [r.left, r.top, r.width, r.height];
      });
      const pg0 = pages.firstElementChild as HTMLElement | null, t0 = pg0?.querySelector('.app') as HTMLElement | null;
      return { fit: [pg0?.clientHeight ?? 0, t0?.offsetHeight ?? 0, pg0 ? parseFloat(getComputedStyle(pg0).rowGap) : 0], editing, folder: openFolderId, page: cur, rows, cols, layout: JSON.parse(JSON.stringify(layout)), tiles };
    },
  };
}
