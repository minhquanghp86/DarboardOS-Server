// (25/09/2026) Danh sach ung dung cua menu (launcher), chia 3 nhom. Tinh o SERVER roi chen vao script launcher.
// Nguoi dung an/hien, sap xep, doi bieu tuong/mau, them ung dung o trang "Menu panel" (launcherConfig.ts).

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
  home: 'home-assistant', ha: 'home-assistant', camera: 'camera', cams: 'view-grid-outline', scenes: 'star-outline', energy: 'lightning-bolt',
  youtube: 'youtube', tiktok: 'music-note', music: 'play-circle-outline', radio: 'radio', news: 'newspaper-variant-outline',
  media: 'music', weather: 'weather-partly-cloudy', calendar: 'calendar-month-outline', timer: 'timer-outline', browser: 'web', settings: 'cog-outline',
  rooms: 'home-floor-1', remote: 'remote-tv', todo: 'format-list-checks', photos: 'image-multiple-outline',
  today: 'weather-sunset-up', board: 'note-multiple-outline', solar: 'solar-power-variant-outline',
};

export const GROUP_TITLES: Record<AppGroup, string> = { nha: 'Nhà', giai_tri: 'Giải trí', tien_ich: 'Tiện ích' };
/** Ten bieu tuong ve tay co san trong launcher. */
export const KNOWN_ICONS = ['ha', 'home', 'camera', 'cams', 'scenes', 'energy', 'youtube', 'tiktok', 'music', 'radio', 'news',
  'media', 'weather', 'calendar', 'timer', 'browser', 'settings', 'rooms', 'remote', 'todo', 'photos', 'today', 'board', 'solar'];

const PORT = process.env.HEALTH_PORT || '18080';
const LOCAL = `http://127.0.0.1:${PORT}`;
/** Dia chi server nhin tu Chromium cung may (anh man hinh cho, ung dung he thong). */
export const LOCAL_ORIGIN = LOCAL;
// Chromium chay cung container voi server -> 127.0.0.1. Doi bang bien moi truong neu can.
export const LAUNCHER_CAMERA_URL = process.env.LAUNCHER_CAMERA_URL || `${LOCAL}/cam.html?src=p4_panel`;
export const LAUNCHER_WEATHER_URL = process.env.LAUNCHER_WEATHER_URL || `${LOCAL}/weather.html`;
export const LAUNCHER_TIMER_URL = `${LOCAL}/timer.html`;
/** (25/09/2026) Home cua OS: man hinh chinh (Shell ve luoi ung dung). Vuot len tu mep duoi / nut Ung dung -> day. */
export const LAUNCHER_OS_HOME_URL = `${LOCAL}/os/home`;
export const LAUNCHER_CAMS_URL = `${LOCAL}/cams.html`;
export const LAUNCHER_SCENES_URL = `${LOCAL}/scenes.html`;

export function listAllApps(homeUrl: string | undefined): LauncherAppInfo[] {
  let haOrigin = '';
  try { if (homeUrl) haOrigin = new URL(homeUrl).origin; } catch { }
  const apps: LauncherApp[] = [];
  const add = (group: AppGroup, label: string, kind: string, color: string, url?: string, action?: 'url', id?: string) =>
    apps.push({ id: id || kind, group, label, kind, color, url, action });

  // Home Assistant la MOT ung dung (uu tien: dau dock). id giu 'home' de cau hinh cu (Menu panel) van ap dung.
  if (homeUrl) add('nha', 'Home Assistant', 'ha', '#1a8fd6', homeUrl, undefined, 'home');
  add('nha', 'Camera P4', 'camera', '#16a34a', LAUNCHER_CAMERA_URL);
  add('nha', 'Camera nhà', 'cams', '#15803d', LAUNCHER_CAMS_URL);
  add('nha', 'Cảnh', 'scenes', '#9333ea', LAUNCHER_SCENES_URL);
  // (27/09/2026) Ung dung Nha: dieu khien theo khu vuc, TV/loa (src/homeApi.ts).
  add('nha', 'Phòng', 'rooms', '#0284c7', `${LOCAL}/rooms.html`);
  add('nha', 'Điều khiển', 'remote', '#7c3aed', `${LOCAL}/remote.html`);
  if (haOrigin) add('nha', 'Năng lượng', 'energy', '#ca8a04', `${haOrigin}/energy`);
  // (27/09/2026) Trang Solar rieng cua nguoi dung (khong doc cam bien nao — chi mo trang).
  add('nha', 'Solar', 'solar', '#eab308', 'http://solar.example.com');

  add('giai_tri', 'YouTube', 'youtube', '#ff0033', 'https://m.youtube.com');
  add('giai_tri', 'TikTok', 'tiktok', '#161616', 'https://www.tiktok.com');
  add('giai_tri', 'Nhạc', 'music', '#e11d48', 'https://music.youtube.com');
  add('giai_tri', 'Radio', 'radio', '#ea580c', `${LOCAL}/radio.html`);
  add('giai_tri', 'Tin tức', 'news', '#b91c1c', 'https://vnexpress.net');
  if (haOrigin) add('giai_tri', 'Media', 'media', '#7c3aed', `${haOrigin}/media-browser/browser`);
  add('giai_tri', 'Khung ảnh', 'photos', '#db2777', `${LOCAL}/photos.html`);

  add('tien_ich', 'Thời tiết', 'weather', '#0ea5e9', LAUNCHER_WEATHER_URL);
  add('tien_ich', 'Lịch', 'calendar', '#dc2626', `${LOCAL}/calendar.html`);
  add('tien_ich', 'Hẹn giờ', 'timer', '#f97316', LAUNCHER_TIMER_URL);
  add('tien_ich', 'Việc cần làm', 'todo', '#16a34a', `${LOCAL}/todo.html`);
  add('tien_ich', 'Hôm nay', 'today', '#f59e0b', `${LOCAL}/today.html`);
  add('tien_ich', 'Bảng tin', 'board', '#ca8a04', `${LOCAL}/board.html`);
  add('tien_ich', 'Trình duyệt', 'browser', '#0891b2', undefined, 'url');
  // (26/09/2026 OS-4) Cai dat cua CHINH man hinh nay (thuc the ESPHome qua HA API) — public/settings.html.
  add('tien_ich', 'Cài đặt', 'settings', '#475569', `${LOCAL}/settings.html`);

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

  // An: theo trang "Menu panel"
  const hideIds = new Set(conf.hidden);
  for (const a of out) a.hidden = hideIds.has(a.id);

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
