// (09/10/2026) THANH CONG CU KIEU CHROME cho tab trinh duyet (ung dung "Chrome"; server danh dau tab bang window.__RWV_BROWSER):
// lui / toi / tai lai / o dia chi (hien trang dang xem; cham de go dia chi hoac tu khoa -> tim Google) / trang chu / thu gon.
// O DAY man hinh (nhu che do "thanh dia chi duoi" cua Chrome Android) — mep tren da co dong ho. DOM THUONG (khong Shadow)
// de ban phim ao (KIOSK_KEYBOARD_SCRIPT) nhan o nhap; KHONG innerHTML (Trusted Types cua mot so trang chan lang lang).
import { chromeLogo } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';
const P = {
  back: 'M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z',
  fwd: 'M4,11V13H16L10.5,18.5L11.92,19.92L19.84,12L11.92,4.08L10.5,5.5L16,11H4Z',
  reload: 'M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z',
  home: 'M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z',
  down: 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
  lock: 'M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z',
  close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
};
export const BROWSER_HOME = 'https://www.google.com/';
const KEY = '__rwv_bb_min';

/** Dia chi / tu khoa nguoi dung go -> URL ('' = khong hop le). Khong co dau cham / co khoang trang -> tim Google. */
export function toBrowserUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/]+:\d+(\/|$)/.test(t)) return '';   // javascript:, file:, ... khong mo
  if (/\s/.test(t) || (t.indexOf('.') < 0 && !/^localhost(:\d+)?(\/|$)/i.test(t))) return 'https://www.google.com/search?q=' + encodeURIComponent(t);
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(t)) return 'http://' + t;
  return 'https://' + t;
}
/** Chu hien trong o dia chi: ten mien + duong dan (bo https://, bo "/" cuoi). */
export function shortUrl(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return href;
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return u.hostname.replace(/^www\./, '') + rest;
  } catch { return href; }
}

function icon(d: string, color = '#e8eaed', size = 22): SVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', String(size)); s.setAttribute('height', String(size)); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', color);
  s.appendChild(p);
  return s;
}

/**
 * Goi tu Shell luc trang MOI bat dau tai (script tiem truoc HTML) — luc do document.documentElement / body co the CHUA co:
 * cho toi khi co roi moi ve. Loi bat ky o day KHONG duoc lam chet Shell (do that 09/10: thanh gan ngay -> TypeError ->
 * Shell khong chay tren google.com, mat ca dong ho).
 */
export function mountBrowserBar(z: string): void {
  const go = () => {
    if (!document.documentElement || !document.body) { requestAnimationFrame(go); return; }
    try { mountNow(z); } catch (e) { console.warn('[rwv] thanh Chrome:', e); }
  };
  go();
}

function mountNow(z: string): void {
  if (document.getElementById('__rwv_bb')) return;
  const h = Math.round(Math.max(44, Math.min(56, Math.min(innerWidth, innerHeight) * 0.085)));
  const bar = document.createElement('div');
  bar.id = '__rwv_bb';
  bar.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${h}px;box-sizing:border-box;display:flex;align-items:center;gap:2px;` +
    `padding:0 6px;background:#202124;border-top:1px solid #3c4043;z-index:${z};font:15px/1 system-ui,Roboto,'Noto Sans',sans-serif;` +
    `color:#e8eaed;-webkit-user-select:none;user-select:none;touch-action:manipulation`;
  const btn = (d: string, label: string, fn: () => void) => {
    const b = document.createElement('div');
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', label); b.title = label;
    b.style.cssText = `flex:none;width:${h - 8}px;height:${h - 8}px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer`;
    b.appendChild(icon(d));
    // pointerdown: ban phim ao vua an se "nuot" click ke tiep (xem o nhap dia chi cu cua launcher)
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.style.background = '#3c4043'; fn(); setTimeout(() => { b.style.background = ''; }, 180); });
    return b;
  };
  // O dia chi: che do XEM (chu rut gon + o khoa) <-> che do GO (input day du)
  const addr = document.createElement('div');
  addr.style.cssText = `flex:1;min-width:0;height:${h - 14}px;margin:0 6px;border-radius:${h}px;background:#303134;display:flex;align-items:center;gap:6px;padding:0 14px;cursor:text`;
  const lockEl = icon(P.lock, '#9aa0a6', 15);
  const txt = document.createElement('span');
  txt.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const input = document.createElement('input');
  input.type = 'url'; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('autocapitalize', 'off');
  input.placeholder = 'Tìm trên Google hoặc nhập địa chỉ web';
  input.style.cssText = 'flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;color:#e8eaed;font:inherit;display:none';
  const clr = icon(P.close, '#9aa0a6', 18);
  clr.style.display = 'none'; clr.style.flex = 'none'; clr.style.cursor = 'pointer';
  addr.append(lockEl, txt, input, clr);
  let editing = false, shown = '';
  const refresh = () => {
    if (editing) return;
    const href = location.href;
    if (href === shown) return;
    shown = href;
    txt.textContent = shortUrl(href);
    lockEl.style.display = location.protocol === 'https:' ? '' : 'none';
  };
  const edit = (on: boolean) => {
    editing = on;
    txt.style.display = on ? 'none' : ''; lockEl.style.display = on ? 'none' : (location.protocol === 'https:' ? '' : 'none');
    input.style.display = on ? '' : 'none'; clr.style.display = on ? '' : 'none';
    if (on) { input.value = location.href; setTimeout(() => { input.focus(); input.select(); }, 30); } else { input.blur(); shown = ''; refresh(); }
  };
  addr.addEventListener('pointerdown', (e) => { if (!editing) { e.preventDefault(); edit(true); } });
  clr.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.value = ''; input.focus(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const url = toBrowserUrl(input.value);
      if (!url) { addr.style.outline = '2px solid #f28b82'; return; }
      addr.style.outline = 'none'; edit(false); location.href = url;
    } else if (e.key === 'Escape') edit(false);
  });
  input.addEventListener('blur', () => { setTimeout(() => { if (editing && document.activeElement !== input) edit(false); }, 250); });

  // Thu gon: chi con nut tron logo Chrome o goc duoi trai — cham de hien lai thanh.
  const chip = document.createElement('div');
  chip.setAttribute('role', 'button'); chip.setAttribute('aria-label', 'Hiện thanh Chrome');
  chip.style.cssText = `position:fixed;left:10px;bottom:10px;width:${h - 4}px;height:${h - 4}px;border-radius:50%;background:#fff;` +
    `box-shadow:0 2px 8px rgba(0,0,0,0.45);display:none;align-items:center;justify-content:center;z-index:${z};cursor:pointer`;
  chip.appendChild(chromeLogo('72%'));
  const setMin = (m: boolean) => {
    bar.style.display = m ? 'none' : 'flex'; chip.style.display = m ? 'flex' : 'none';
    try { sessionStorage.setItem(KEY, m ? '1' : ''); } catch { /* khong co sessionStorage */ }
  };
  chip.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); setMin(false); });

  bar.append(
    btn(P.back, 'Quay lại', () => history.back()),
    btn(P.fwd, 'Tiến', () => history.forward()),
    btn(P.reload, 'Tải lại', () => location.reload()),
    addr,
    btn(P.home, 'Trang chủ', () => { location.href = BROWSER_HOME; }),
    btn(P.down, 'Thu gọn thanh', () => setMin(true)),
  );
  const host = document.documentElement;
  host.append(bar, chip);
  let min = false;
  try { min = sessionStorage.getItem(KEY) === '1'; } catch { /* */ }
  setMin(min);
  refresh();
  // Trang mot-trang (SPA) doi dia chi khong tai lai: doc lai moi giay, chi ve khi doi (moi lan doi DOM = mot khung gui di).
  setInterval(refresh, 1000);
  addEventListener('popstate', refresh); addEventListener('hashchange', refresh);
}
