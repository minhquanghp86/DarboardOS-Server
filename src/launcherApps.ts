// (25/09/2026) Danh sach ung dung cua menu (launcher), chia 3 nhom. Tinh o SERVER roi chen vao script launcher.
// Nguoi dung THEM ung dung (launcher_apps) / AN ung dung co san (launcher_hide) trong cau hinh addon — run.sh xuat ra
// LAUNCHER_APPS_JSON / LAUNCHER_HIDE_JSON.

export type AppGroup = 'nha' | 'giai_tri' | 'tien_ich';
export interface LauncherApp { label: string; kind: string; color: string; group: AppGroup; url?: string; action?: 'url'; }

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

export function buildLauncherApps(homeUrl: string | undefined): LauncherApp[] {
  let haOrigin = '';
  try { if (homeUrl) haOrigin = new URL(homeUrl).origin; } catch { }
  const apps: LauncherApp[] = [];
  const add = (group: AppGroup, label: string, kind: string, color: string, url?: string, action?: 'url') =>
    apps.push({ group, label, kind, color, url, action });

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

  // Ung dung nguoi dung tu them
  for (const raw of parseJsonArray('LAUNCHER_APPS_JSON')) {
    const a = raw as Record<string, unknown>;
    const label = typeof a.label === 'string' ? a.label.trim().slice(0, 30) : '';
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    if (!label || !/^https?:\/\//i.test(url)) continue;
    const group: AppGroup = a.group === 'nha' || a.group === 'giai_tri' || a.group === 'tien_ich' ? a.group : 'tien_ich';
    const kind = typeof a.icon === 'string' && KNOWN_ICONS.includes(a.icon) ? a.icon : 'generic';
    const color = typeof a.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(a.color) ? a.color : GROUP_COLORS[group];
    add(group, label, kind, color, url);
  }
  // An ung dung co san theo ten (khong phan biet hoa thuong)
  const hide = new Set(parseJsonArray('LAUNCHER_HIDE_JSON').filter((x): x is string => typeof x === 'string')
    .map(s => s.trim().toLocaleLowerCase('vi')));
  return apps.filter(a => !hide.has(a.label.toLocaleLowerCase('vi')));
}
