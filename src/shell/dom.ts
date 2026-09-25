// (25/09/2026) Tien ich DOM cho Shell. CHI dung DOM API (khong innerHTML): mot so trang co Trusted Types CSP
// (vd accounts.google.com) nem loi khi gan chuoi HTML.
import { MDI } from './mdi';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/** Bieu tuong MDI (to mau bang currentColor). */
export function mdi(name: keyof typeof MDI | string, cls = 'ic'): SVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' });
  const d = (MDI as Record<string, string>)[name];
  if (d) s.appendChild(svgEl('path', { d, fill: 'currentColor' }));
  return s;
}

export function setText(e: Element, s: string): void { if (e.textContent !== s) e.textContent = s; }

export function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
