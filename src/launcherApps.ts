// (25/09/2026) Danh sach ung dung cua menu (launcher), chia 3 nhom. Tinh o SERVER roi chen vao script launcher.
// Nguoi dung THEM ung dung (launcher_apps) / AN ung dung co san (launcher_hide) trong cau hinh addon — run.sh xuat ra
// LAUNCHER_APPS_JSON / LAUNCHER_HIDE_JSON.

export type AppGroup = 'nha' | 'giai_tri' | 'tien_ich';
import { getLauncherConfig, getMdiPath } from './launcherConfig.js';

export interface LauncherApp {
  id: string; label: string; kind: string; color: string; group: AppGroup; url?: string; action?: 'url';
  /** kind === 'mdi': duong ve SVG 24x24 cua bieu tuong MDI */
  path?: string;
}
/** Cho trang cau hinh: them trang thai an + thong tin mac dinh. */
export interface LauncherAppInfo extends LauncherApp { hidden: boolean; builtin: boolean; icon: string; baseKind: string; defaults?: { label: string; color: string; group: AppGroup; }; }
/** Bieu tuong MDI gan nhat voi bieu tuong ve tay co san — de trang cau hinh xem truoc. */
export const BUILTIN_PREVIEW: Record<string, string> = {
  home: 'home', camera: 'camera', cams: 'view-grid-outline', scenes: 'star-outline', energy: 'lightning-bolt',
  youtube: 'youtube', tiktok: 'music-note', music: 'play-circle-outline', radio: 'radio', news: 'newspaper-variant-outline',
  media: 'music', weather: 'weather-partly-cloudy', calendar: 'calendar-month-outline', timer: 'timer-outline', browser: 'web',
};

export const GROUP_TITLES: Record<AppGroup, string> = { nha: 'Nhà', giai_tri: 'Giải trí', tien_ich: 'Tiện ích' };
/** Ten bieu tuong co san — launcher_apps.icon chon mot trong so nay (khac -> chu cai dau cua ten). */
export const KNOWN_ICONS = ['home', 'camera', 'cams', 'scenes', 'energy', 'youtube', 'tiktok', 'music', 'radio', 'news',
  'media', 'weather', 'calendar', 'timer', 'browser'];
const GROUP_COLORS: Record<AppGroup, string> = { nha: '#2f7cf6', giai_tri: '#db2777', tien_ich: '#0891b2' };

const PORT = process.env.HEALTH_PORT || '18080';
const LOCAL = `http://127.0.0.1:${PORT}`;
// Chromium chay cung container voi server -> 127.0.0.1. Doi bang bien moi truong neu can.
export const LAUNCHER_CAMERA_URL = process.env.LAUNCHER_CAMERA_URL || `${LOCAL}/cam.html?src=p4_panel`;
export const LAUNCHER_WEATHER_URL = process.env.LAUNCHER_WEATHER_URL || `${LOCAL}/weather.html`;
export const LAUNCHER_TIMER_URL = `${LOCAL}/timer.html`;

function parseJsonArray(name: string): unknown[] {
  try { const v = JSON.parse(process.env[name] || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Tat ca ung dung (co san + tu them), da ap cau hinh, KE CA ung dung dang an (co hidden). Thu tu = thu tu hien. */
export function listAllApps(homeUrl: string | undefined): LauncherAppInfo[] {
  let haOrigin = '';
  try { if (homeUrl) haOrigin = new URL(homeUrl).origin; } catch { }
  const apps: LauncherApp[] = [];
  const add = (group: AppGroup, label: string, kind: string, color: string, url?: string, action?: 'url', id?: string) =>
    apps.push({ id: id || kind, group, label, kind, color, url, action });

  if (homeUrl) add('nha', 'Trang chủ', 'home', '#2f7cf6', homeUrl);
  add('nha', 'Camera P4', 'camera', '#16a34a', LAUNCHER_CAMERA_URL);
  add('nha', 'Camera nhà', 'cams', '#15803d', `${LOCAL}/cams.html`);
  add('nha', 'Cảnh', 'scenes', '#9333ea', `${LOCAL}/scenes.html`);
  if (haOrigin) add('nha', 'Năng lượng', 'energy', '#ca8a04', `${haOrigin}/energy`);

  add('giai_tri', 'YouTube', 'youtube', '#ff0033', 'https://m.youtube.com');
  add('giai_tri', 'TikTok', 'tiktok', '#161616', 'https://www.tiktok.com');
  add('giai_tri', 'Nhạc', 'music', '#e11d48', 'https://music.youtube.com');
  add('giai_tri', 'Radio', 'radio', '#ea580c', `${LOCAL}/radio.html`);
  add('giai_tri', 'Tin tức', 'news', '#b91c1c', 'https://vnexpress.net');
  if (haOrigin) add('giai_tri', 'Media', 'media', '#7c3aed', `${haOrigin}/media-browser/browser`);

  add('tien_ich', 'Thời tiết', 'weather', '#0ea5e9', LAUNCHER_WEATHER_URL);
  add('tien_ich', 'Lịch', 'calendar', '#dc2626', `${LOCAL}/calendar.html`);
  add('tien_ich', 'Hẹn giờ', 'timer', '#f97316', LAUNCHER_TIMER_URL);
  add('tien_ich', 'Trình duyệt', 'browser', '#0891b2', undefined, 'url');

  // Ung dung nguoi dung tu them — cach cu, trong cau hinh addon (van giu de tuong thich)
  let n = 0;
  for (const raw of parseJsonArray('LAUNCHER_APPS_JSON')) {
    const a = raw as Record<string, unknown>;
    const label = typeof a.label === 'string' ? a.label.trim().slice(0, 30) : '';
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    if (!label || !/^https?:\/\//i.test(url)) continue;
    const group: AppGroup = a.group === 'nha' || a.group === 'giai_tri' || a.group === 'tien_ich' ? a.group : 'tien_ich';
    const kind = typeof a.icon === 'string' && KNOWN_ICONS.includes(a.icon) ? a.icon : 'generic';
    const color = typeof a.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(a.color) ? a.color : GROUP_COLORS[group];
    add(group, label, kind, color, url, undefined, `opt_${n++}`);
  }
  const builtinIds = new Set(apps.map(a => a.id));
  const conf = getLauncherConfig();
  // Ung dung them bang trang "Menu panel"
  for (const a of conf.custom) add(a.group, a.label, 'generic', a.color, a.url, undefined, a.id);
  const iconOf = new Map<string, string>(conf.custom.filter(a => a.icon).map(a => [a.id, a.icon]));

  // Doi ten / bieu tuong / mau / nhom
  const out: LauncherAppInfo[] = apps.map(a => {
    const o = conf.overrides[a.id] || {};
    const defaults = { label: a.label, color: a.color, group: a.group };
    const icon = o.icon || iconOf.get(a.id) || '';
    const info: LauncherAppInfo = {
      ...a, label: o.label || a.label, color: o.color || a.color, group: o.group || a.group,
      hidden: false, builtin: builtinIds.has(a.id), icon, baseKind: a.kind, defaults: builtinIds.has(a.id) ? defaults : undefined,
    };
    const p = getMdiPath(icon);
    if (p) { info.kind = 'mdi'; info.path = p; }
    return info;
  });

  // An: theo id (trang cau hinh) hoac theo ten (launcher_hide cu)
  const hideIds = new Set(conf.hidden);
  const hideNames = new Set(parseJsonArray('LAUNCHER_HIDE_JSON').filter((x): x is string => typeof x === 'string')
    .map(s => s.trim().toLocaleLowerCase('vi')));
  for (const a of out) a.hidden = hideIds.has(a.id) || hideNames.has(a.label.toLocaleLowerCase('vi'));

  // Thu tu trong tung nhom: theo cau hinh, ung dung chua co trong danh sach giu thu tu goc o cuoi
  const orderIdx = (a: LauncherAppInfo) => {
    const list = conf.order[a.group] || [];
    const i = list.indexOf(a.id);
    return i < 0 ? 1000 + out.indexOf(a) : i;
  };
  const groups: AppGroup[] = ['nha', 'giai_tri', 'tien_ich'];
  return groups.flatMap(g => out.filter(a => a.group === g).sort((x, y) => orderIdx(x) - orderIdx(y)));
}

/** Ung dung HIEN tren menu (bo an), gon cho launcher. */
export function buildLauncherApps(homeUrl: string | undefined): LauncherApp[] {
  return listAllApps(homeUrl).filter(a => !a.hidden)
    .map(({ id, label, kind, color, group, url, action, path }) => ({ id, label, kind, color, group, url, action, path }));
}
