// (25/09/2026) Bieu tuong ung dung (o mau bo goc + hinh trang). Hinh ve tay giu nguyen tu launcher cu; 'ha' = logo Home
// Assistant (MDI); 'mdi' = duong ve do server chen (bieu tuong nguoi dung chon o Menu panel).
import { MDI } from './mdi';
import { el, svgEl } from './dom';

export interface App {
  id: string; label: string; kind: string; color: string; group: string; url?: string; action?: 'url'; path?: string;
}

export function appIcon(app: App, cls = 'app-ic'): HTMLElement {
  const box = el('div', cls);
  box.style.background = app.color;
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: '60%', height: '60%' });
  const line = (tag: string, attrs: Record<string, string>) => {
    const a: Record<string, string> = { fill: 'none', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    for (const k in attrs) a[k] = attrs[k];
    svg.appendChild(svgEl(tag, a));
  };
  const fillPath = (d: string) => svg.appendChild(svgEl('path', { d, fill: '#fff' }));
  switch (app.kind) {
    case 'ha': case 'home': fillPath(MDI.ha); break;
    case 'mdi': if (app.path) fillPath(app.path); break;
    case 'youtube': line('path', { d: 'M9 7v10l8.5-5z', fill: '#fff', stroke: 'none' }); break;
    case 'tiktok':
      for (const [c, t] of [['#25f4ee', '-0.9 -0.9'], ['#fe2c55', '0.9 0.9'], ['#fff', '0 0']]) {
        line('path', { d: 'M14 3v11.5a3.5 3.5 0 11-3.5-3.5', stroke: c, transform: `translate(${t})` });
        line('path', { d: 'M14 3c0.6 2.6 2.4 4.2 5 4.4', stroke: c, transform: `translate(${t})` });
      }
      break;
    case 'camera':
      line('path', { d: 'M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z' });
      line('circle', { cx: '12', cy: '13', r: '3.5' });
      break;
    case 'cams':
      for (const [x, y] of [['2.5', '4'], ['13', '4'], ['2.5', '13'], ['13', '13']]) line('rect', { x, y, width: '8.5', height: '7', rx: '1.5' });
      break;
    case 'scenes': line('path', { d: 'M12 3l2.2 5.2L20 9l-4.3 3.8L17 18.5 12 15.6 7 18.5l1.3-5.7L4 9l5.8-.8z' }); break;
    case 'energy': line('path', { d: 'M13 2L4 14h7l-1 8 9-12h-7z', fill: '#fff' }); break;
    case 'music': line('circle', { cx: '12', cy: '12', r: '9' }); line('path', { d: 'M10 8.5v7l5.5-3.5z', fill: '#fff' }); break;
    case 'radio':
      line('rect', { x: '3', y: '8', width: '18', height: '12', rx: '2' }); line('path', { d: 'M7 8l10-5' });
      line('circle', { cx: '15.5', cy: '14', r: '2.5' }); line('path', { d: 'M6.5 12.5h4M6.5 15.5h4' });
      break;
    case 'news': line('rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }); line('path', { d: 'M7 8h10M7 12h10M7 16h6' }); break;
    case 'media': line('path', { d: 'M9 18V5.5l11-2V16' }); line('circle', { cx: '6', cy: '18', r: '3' }); line('circle', { cx: '17', cy: '16', r: '3' }); break;
    case 'weather':
      line('circle', { cx: '8', cy: '8', r: '3' }); line('path', { d: 'M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7' });
      line('path', { d: 'M7 19a4 4 0 010-8 5 5 0 019.6 1.5A3.25 3.25 0 0117 19z', fill: app.color });
      break;
    case 'calendar':
      line('rect', { x: '3', y: '5', width: '18', height: '16', rx: '2' }); line('path', { d: 'M3 10h18M8 3v4M16 3v4' });
      line('path', { d: 'M12 13.5a2.5 2.5 0 11-1.2 4.7' });
      break;
    case 'settings': fillPath(MDI.settings); break;
    // (27/09/2026) Ung dung Nha / tien ich moi
    case 'rooms':
      line('path', { d: 'M3 11l9-7 9 7' }); line('path', { d: 'M5 9.5V20h14V9.5' }); line('path', { d: 'M12 20v-6M5 14h7' });
      break;
    case 'remote':
      line('rect', { x: '7', y: '2.5', width: '10', height: '19', rx: '3' }); line('circle', { cx: '12', cy: '8', r: '2' });
      line('path', { d: 'M10 13h.01M14 13h.01M10 16.5h.01M14 16.5h.01' });
      break;
    case 'todo':
      line('path', { d: 'M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17' }); line('path', { d: 'M11 6.5h9M11 12.5h9M11 18.5h9' });
      break;
    case 'today':
      line('path', { d: 'M3 18h18M6 18a6 6 0 0112 0' }); line('path', { d: 'M12 5v3M4.9 9.9l2.1 2.1M19.1 9.9L17 12' }); line('path', { d: 'M8 21h8' });
      break;
    case 'board':
      line('path', { d: 'M5 3h11l4 4v14H5z' }); line('path', { d: 'M15 3v5h5' }); line('path', { d: 'M8 12h8M8 16h6' });
      break;
    case 'photos':
      line('rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }); line('circle', { cx: '9', cy: '9.5', r: '1.8' });
      line('path', { d: 'M3.5 17l5-5 4 4 3-3 5 5' });
      break;
    case 'timer': line('circle', { cx: '12', cy: '13.5', r: '7.5' }); line('path', { d: 'M12 9.5v4l2.5 2M9.5 2.5h5M19 6l1.5-1.5' }); break;
    case 'browser':
      line('circle', { cx: '12', cy: '12', r: '9' });
      line('path', { d: 'M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z' });
      break;
    default: {
      const t = svgEl('text', { x: '12', y: '16.5', 'text-anchor': 'middle', fill: '#fff', 'font-size': '13', 'font-weight': '700' });
      t.textContent = (app.label || '?').charAt(0).toUpperCase();
      svg.appendChild(t);
    }
  }
  box.appendChild(svg);
  return box;
}

/** Bieu tuong thoi tiet thu gon theo ma WMO. */
export function weatherIcon(code: number, day: boolean): SVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'wx-ic' });
  const p = (d: string, fill: string, stroke = fill) => s.appendChild(svgEl('path', { d, fill, stroke, 'stroke-width': '1.6', 'stroke-linecap': 'round' }));
  const cloud = 'M7 18a4 4 0 010-8 5 5 0 019.6 1.5A3.3 3.3 0 0117 18z';
  if (code <= 1) {
    if (day) {
      s.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '4.5', fill: '#fbbf24' }));
      p('M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4', 'none', '#fbbf24');
    } else p('M16 4a8 8 0 104 12.5A7 7 0 0116 4z', '#e2e8f0');
  } else if (code <= 3 || code === 45 || code === 48) p(cloud, '#cbd5e1');
  else if (code >= 95) { p(cloud, '#94a3b8'); p('M12.5 13l-2 4h3l-2 4', 'none', '#fbbf24'); }
  else { p('M7 14a4 4 0 010-8 5 5 0 019.6 1.5A3.3 3.3 0 0117 14z', '#cbd5e1'); p('M8 17l-1 3M12 17l-1 3M16 17l-1 3', 'none', '#60a5fa'); }
  return s;
}
