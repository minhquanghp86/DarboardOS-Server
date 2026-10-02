// (25/09/2026) Danh sach ung dung cua menu (launcher), chia 3 nhom. Tinh o SERVER roi chen vao script launcher.
// Nguoi dung an/hien, sap xep, doi bieu tuong/mau, them ung dung o trang "Menu panel" (launcherConfig.ts).

export type AppGroup = 'nha' | 'giai_tri' | 'tien_ich';
import { getLauncherConfig, getMdiPath } from './launcherConfig.js';

export interface LauncherApp {
  id: string; label: string; kind: string; color: string; group: AppGroup; url?: string; action?: 'url';
  /** (01/10/2026) Bieu tuong MDI mac dinh ("mdi:ten") cua ung dung co san — nguoi dung van doi duoc o "Menu panel". */
  defIcon?: string;
  /** (01/10/2026) Duong ve SVG 24x24 rieng (khong co trong MDI, vd logo Frigate). */
  defPath?: string;
  /** kind === 'mdi': duong ve SVG 24x24 cua bieu tuong MDI */
  path?: string;
}
/** Cho trang cau hinh: them trang thai an + thong tin mac dinh. */
export interface LauncherAppInfo extends LauncherApp { hidden: boolean; builtin: boolean; icon: string; baseKind: string; defaults?: { label: string; color: string; group: AppGroup; }; }
/** Bieu tuong MDI gan nhat voi bieu tuong ve tay co san — de trang cau hinh xem truoc. */
export const BUILTIN_PREVIEW: Record<string, string> = {
  home: 'home-assistant', ha: 'home-assistant', camera: 'camera', cams: 'view-grid-outline', energy: 'lightning-bolt',
  youtube: 'youtube', tiktok: 'music-note', music: 'play-circle-outline', radio: 'radio', news: 'newspaper-variant-outline',
  media: 'music', weather: 'weather-partly-cloudy', calendar: 'calendar-month-outline', timer: 'timer-outline', browser: 'web', settings: 'cog-outline',
  rooms: 'home-floor-1', remote: 'remote-tv', todo: 'format-list-checks', photos: 'image-multiple-outline',
  today: 'weather-sunset-up', board: 'note-multiple-outline', solar: 'solar-power-variant-outline', yttv: 'youtube-tv',
};

export const GROUP_TITLES: Record<AppGroup, string> = { nha: 'Nhà', giai_tri: 'Giải trí', tien_ich: 'Tiện ích' };
/** Ten bieu tuong ve tay co san trong launcher. */
export const KNOWN_ICONS = ['ha', 'home', 'camera', 'cams', 'energy', 'youtube', 'tiktok', 'music', 'radio', 'news',
  'media', 'weather', 'calendar', 'timer', 'browser', 'settings', 'rooms', 'remote', 'todo', 'photos', 'today', 'board', 'solar', 'yttv'];

const PORT = process.env.HEALTH_PORT || '18080';
const LOCAL = `http://127.0.0.1:${PORT}`;
/** Dia chi server nhin tu Chromium cung may (anh man hinh cho, ung dung he thong). */
export const LOCAL_ORIGIN = LOCAL;
// Chromium chay cung container voi server -> 127.0.0.1. Doi bang bien moi truong neu can.
export const LAUNCHER_CAMERA_URL = process.env.LAUNCHER_CAMERA_URL || `${LOCAL}/camera.html?src=p4_panel`;
export const LAUNCHER_WEATHER_URL = process.env.LAUNCHER_WEATHER_URL || `${LOCAL}/weather.html`;
export const LAUNCHER_TIMER_URL = `${LOCAL}/timer.html`;
/** (25/09/2026) Home cua OS: man hinh chinh (Shell ve luoi ung dung). Vuot len tu mep duoi / nut Ung dung -> day. */
export const LAUNCHER_OS_HOME_URL = `${LOCAL}/os/home`;
export const LAUNCHER_CAMS_URL = `${LOCAL}/cams.html`;
/** (01/10/2026) Google Maps lop giao thong. Mac dinh trung tam Hai Phong; doi bang bien moi truong LAUNCHER_TRAFFIC_URL. */
export const LAUNCHER_TRAFFIC_URL = process.env.LAUNCHER_TRAFFIC_URL || 'https://www.google.com/maps/@20.8449,106.6881,13z/data=!5m1!1e1';

/** (01/10/2026) Logo Frigate (favicon cua add-on Frigate, potrace 888x888) chuyen ve khung 24x24. */
const FRIGATE_ICON_PATH = 'M22.2 0.0405c-0.00541 0.00541-0.0676 0.0162-0.143 0.0243-0.103 0.0135-0.751 0.151-1.15 0.246-0.0892 0.0189-1.03 0.265-1.26 0.327-0.132 0.0378-0.335 0.0919-0.446 0.122-0.181 0.0486-1.31 0.373-1.66 0.476-0.135 0.0378-0.286 0.0811-0.365 0.1-0.0216 0.00541-0.0946 0.0297-0.162 0.0514-0.0676 0.0216-0.23 0.073-0.365 0.114-0.132 0.0378-0.273 0.0838-0.311 0.0973-0.0378 0.0135-0.0919 0.0297-0.122 0.0351-0.0297 0.00811-0.176 0.0514-0.324 0.0973-0.149 0.0486-0.343 0.108-0.432 0.135-0.473 0.143-0.668 0.208-1.49 0.481-0.984 0.327-1.56 0.541-2.22 0.808-0.238 0.0973-0.578 0.238-0.757 0.311-0.178 0.073-0.349 0.143-0.378 0.157-0.0297 0.0135-0.181 0.0784-0.338 0.146-0.924 0.389-1.45 0.7-1.56 0.927-0.0919 0.178 0.0189 0.392 0.422 0.808 0.619 0.643 0.792 0.854 0.919 1.12 0.103 0.216 0.111 0.411 0.027 0.759-0.154 0.632-0.473 1.47-0.759 1.98-0.265 0.47-0.465 0.646-0.922 0.803-0.314 0.108-0.397 0.141-0.568 0.216-0.289 0.132-0.484 0.289-0.784 0.638-0.138 0.159-0.484 0.284-0.986 0.354-0.0514 0.00541-0.13 0.0189-0.176 0.0243-0.0432 0.00811-0.135 0.0216-0.203 0.0297-0.186 0.0243-0.351 0.105-0.351 0.17 0 0.0649 0.0838 0.124 0.211 0.151 0.0486 0.0108 0.376 0.0216 0.73 0.027 0.676 0.0108 0.816 0.0297 0.905 0.119 0.0514 0.0486 0.0514 0.0622 0.0189 0.124-0.0514 0.0973-0.535 0.327-1.32 0.63-2.3 0.886-2.47 0.957-3.13 1.28-0.5 0.243-0.911 0.503-1.07 0.673-0.162 0.176-0.181 0.289-0.168 0.946 0.00811 0.305 0.0189 0.584 0.027 0.622 0.00811 0.0378 0.0189 0.141 0.027 0.23 0.0189 0.189 0.0378 0.346 0.0568 0.459 0.00541 0.0432 0.0189 0.13 0.027 0.189 0.00811 0.0595 0.0297 0.173 0.0432 0.254 0.0162 0.0811 0.0324 0.173 0.0378 0.203 0.0027 0.0324 0.0135 0.0919 0.0243 0.138 0.00811 0.0432 0.0216 0.105 0.027 0.135 0.0324 0.154 0.157 0.697 0.192 0.838 0.0243 0.0892 0.0486 0.186 0.0541 0.214 0.0676 0.297 0.373 1.12 0.584 1.57 0.0568 0.127 0.105 0.235 0.105 0.243 0 0.0189 0.586 1.18 0.705 1.41 0.295 0.543 0.792 1.35 0.938 1.52 0.0297 0.0351 0.1 0.119 0.151 0.184 0.186 0.222 0.341 0.295 0.432 0.203 0.0703-0.0676 0.0378-0.176-0.13-0.443-0.373-0.589-0.384-0.662-0.373-2.16 0.00541-0.557 0.0108-1.32 0.0135-1.69 0.0027-0.373-0.0027-0.792-0.0162-0.932-0.0757-0.932-0.0757-1.61-0.0027-2.05 0.0324-0.186 0.146-0.505 0.232-0.635 0.0892-0.141 0.508-0.573 0.792-0.816 0.265-0.227 0.292-0.251 0.389-0.327 0.0514-0.0405 0.141-0.114 0.203-0.165 0.211-0.173 0.816-0.619 1.15-0.846 0.67-0.457 1.31-0.803 1.62-0.881 0.143-0.0378 0.554-0.0162 0.986 0.0459 0.0892 0.0135 0.419 0.0216 0.73 0.0162 0.484-0.00811 0.611-0.0189 0.854-0.0757 0.157-0.0351 0.378-0.0676 0.492-0.0703 0.222-0.00541 0.324-0.0162 0.586-0.0595 0.197-0.0324 0.262-0.0432 0.33-0.0486 0.0324-0.0027 0.0622-0.0568 0.103-0.189l0.0541-0.184 0.2 0.0459c0.219 0.0541 0.419 0.0811 0.895 0.122 0.186 0.0162 0.357 0.0216 1.93 0.0541 1.31 0.0297 1.68 0.0216 1.97-0.0432 0.23-0.0514 0.354-0.17 0.265-0.259-0.0676-0.0703-0.281-0.0919-0.816-0.0865-1.01 0.00541-1.1 0.0027-1.27-0.0703-0.243-0.1 0.00541-0.276 0.462-0.324 0.0892-0.00811 0.205-0.0216 0.257-0.027 0.0514-0.00541 0.192-0.0189 0.311-0.027 0.657-0.0459 0.722-0.0541 0.914-0.1 0.392-0.0973 0.127-0.276-0.549-0.37-0.368-0.0514-0.708-0.0676-1.32-0.0595-0.335 0.00541-0.978 0.0108-1.43 0.0108l-0.824 0.0027-0.151-0.0703c-0.176-0.0838-0.462-0.295-0.643-0.476-0.141-0.138-0.381-0.468-0.381-0.516 0-0.0162-0.0162-0.0595-0.0378-0.0919-0.0486-0.073-0.146-0.446-0.173-0.659-0.0324-0.265-0.0162-0.87 0.0324-1.12 0.0243-0.127 0.0784-0.343 0.122-0.476 0.0703-0.216 0.157-0.589 0.178-0.751 0.0027-0.0297 0.0162-0.127 0.027-0.216 0.00811-0.0892 0.0216-0.189 0.027-0.224 0.00541-0.0351 0.0189-0.143 0.0297-0.243 0.00811-0.1 0.0216-0.2 0.0243-0.224 0.0595-0.319 0.0595-0.754-0.0027-1.25-0.0541-0.465-0.0541-0.465 0.189-0.643 0.292-0.214 1.15-0.67 1.8-0.959 0.0676-0.0297 0.208-0.0919 0.311-0.141 0.249-0.114 1.2-0.516 1.54-0.654 0.149-0.0595 0.295-0.119 0.324-0.13 0.0649-0.0297 0.351-0.141 1.05-0.405 0.538-0.203 1.21-0.468 1.35-0.527 0.0459-0.0189 0.319-0.135 0.608-0.257 0.641-0.27 0.9-0.386 1.32-0.595 0.619-0.305 0.941-0.516 0.911-0.603-0.00811-0.027-0.189-0.0541-0.214-0.0324z';

export function listAllApps(homeUrl: string | undefined): LauncherAppInfo[] {
  let haOrigin = '';
  try { if (homeUrl) haOrigin = new URL(homeUrl).origin; } catch { }
  const apps: LauncherApp[] = [];
  const add = (group: AppGroup, label: string, kind: string, color: string, url?: string, action?: 'url', id?: string, defIcon?: string, defPath?: string) =>
    apps.push({ id: id || kind, group, label, kind, color, url, action, defIcon, defPath });

  // Home Assistant la MOT ung dung (uu tien: dau dock). id giu 'home' de cau hinh cu (Menu panel) van ap dung.
  if (homeUrl) add('nha', 'Home Assistant', 'ha', '#1a8fd6', homeUrl, undefined, 'home');
  // (01/10/2026) "Camera" = ung dung camera kieu dien thoai cua CHINH panel (xem truc tiep, chup anh, quay video luu the SD —
  // public/camera.html). "Frigate" (truoc la "Camera nha") = luoi camera Frigate, logo Frigate lay tu chinh add-on Frigate.
  add('nha', 'Camera', 'camera', '#16a34a', LAUNCHER_CAMERA_URL);
  add('nha', 'Frigate', 'cams', '#1e3a8a', LAUNCHER_CAMS_URL, undefined, undefined, undefined, FRIGATE_ICON_PATH);
  // (01/10/2026) The SD cua panel co camera: Thu vien (anh/video da chup, trinh phat) va Tep (duyet / xoa ca the).
  add('nha', 'Thư viện', 'gallery', '#0d9488', `${LOCAL}/files.html?view=gallery`, undefined, 'gallery', 'mdi:image-album');
  add('tien_ich', 'Quản lý file', 'files', '#64748b', `${LOCAL}/files.html`, undefined, 'files', 'mdi:folder-outline');
  // (27/09/2026) Ung dung Nha: dieu khien theo khu vuc, TV/loa (src/homeApi.ts).
  add('nha', 'Phòng', 'rooms', '#0284c7', `${LOCAL}/rooms.html`);
  add('nha', 'Điều khiển', 'remote', '#7c3aed', `${LOCAL}/remote.html`);
  // (27/09/2026) Bo ung dung "Nang luong" (trang Energy cua HA) theo yeu cau nguoi dung — thay bang Solar.
  // (27/09/2026) Trang Solar rieng cua nguoi dung (khong doc cam bien nao — chi mo trang).
  add('nha', 'Solar', 'solar', '#eab308', 'http://solar.example.com');

  add('giai_tri', 'YouTube', 'youtube', '#ff0033', 'https://m.youtube.com');
  add('giai_tri', 'TikTok', 'tiktok', '#161616', 'https://www.tiktok.com');
  // (27/09/2026) Giao dien YouTube cho TV (tab UA Smart TV) — dien thoai truyen toi day; mo tay de lien ket bang ma TV.
  add('giai_tri', 'YouTube TV', 'yttv', '#cc0000', process.env.YT_TV_URL || 'https://www.youtube.com/tv');
  add('giai_tri', 'YouTube Music', 'music', '#e11d48', 'https://music.youtube.com');
  add('giai_tri', 'Radio', 'radio', '#ea580c', `${LOCAL}/radio.html`);
  add('giai_tri', 'Tin tức', 'news', '#b91c1c', 'https://vnexpress.net');
  // (01/10/2026) Tien ich web moi (nguoi dung chon). Do 01/10 trong tab Chrome rieng: deu tai duoc; VTVgo phat VTV1 truc
  // tiep (khong vuong DRM; lan dau co hop Dieu khoan — nguoi dung tu bam Dong y). Zing MP3 / NhacCuaTui: kind 'music' de
  // PHAT NEN nhu ung dung Nhac (tab khong bi dong bang khi dang phat).
  add('giai_tri', 'VTVgo', 'vtvgo', '#c8102e', 'https://vtvgo.vn', undefined, 'vtvgo', 'mdi:television-play');
  add('giai_tri', 'Zing MP3', 'music', '#8b45ca', 'https://zingmp3.vn', undefined, 'zingmp3', 'mdi:music-circle-outline');
  add('giai_tri', 'NhacCuaTui', 'music', '#1f6feb', 'https://www.nhaccuatui.com', undefined, 'nhaccuatui', 'mdi:playlist-music');
  if (haOrigin) add('giai_tri', 'Media', 'media', '#7c3aed', `${haOrigin}/media-browser/browser`);
  add('giai_tri', 'Khung ảnh', 'photos', '#db2777', `${LOCAL}/photos.html`);

  add('tien_ich', 'Thời tiết', 'weather', '#0ea5e9', LAUNCHER_WEATHER_URL);
  add('tien_ich', 'Lịch', 'calendar', '#dc2626', `${LOCAL}/calendar.html`);
  add('tien_ich', 'Hẹn giờ', 'timer', '#f97316', LAUNCHER_TIMER_URL);
  // (01/10/2026) Bao thuc (giu o server — src/alarms.ts): lap theo thu, bao lai, reo tren man hinh chon.
  add('tien_ich', 'Báo thức', 'alarm', '#4f46e5', `${LOCAL}/alarm.html`, undefined, 'alarm', 'mdi:alarm');
  add('tien_ich', 'Việc cần làm', 'todo', '#16a34a', `${LOCAL}/todo.html`);
  add('tien_ich', 'Hôm nay', 'today', '#f59e0b', `${LOCAL}/today.html`);
  add('tien_ich', 'Bảng tin', 'board', '#ca8a04', `${LOCAL}/board.html`);
  // (01/10/2026) Nhan tin noi bo: panel <-> trang "Darboard" tren thanh ben HA (src/chat.ts, public/chat.html).
  add('tien_ich', 'Tin nhắn', 'chat', '#2563eb', `${LOCAL}/chat.html`, undefined, 'chat', 'mdi:message-text-outline');
  add('tien_ich', 'Báo Mới', 'baomoi', '#15803d', 'https://baomoi.com', undefined, 'baomoi', 'mdi:newspaper-variant-multiple');
  add('tien_ich', 'Giá vàng', 'giavang', '#ca8a04', 'https://webgia.com', undefined, 'giavang', 'mdi:gold');
  add('tien_ich', 'Xổ số', 'xoso', '#dc2626', 'https://www.minhngoc.net.vn', undefined, 'xoso', 'mdi:ticket-confirmation-outline');
  // (01/10/2026) Nguoi dung: dat ten Google Maps + bieu tuong Google Maps (mo san lop giao thong). id giu 'giaothong'.
  add('tien_ich', 'Google Maps', 'giaothong', '#4285f4', LAUNCHER_TRAFFIC_URL, undefined, 'giaothong', 'mdi:google-maps');
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
    const icon = o.icon || iconOf.get(a.id) || a.defIcon || '';
    const info: LauncherAppInfo = {
      ...a, label: o.label || a.label, color: o.color || a.color, group: o.group || a.group,
      hidden: false, builtin: builtinIds.has(a.id), icon, baseKind: a.kind, defaults: builtinIds.has(a.id) ? defaults : undefined,
    };
    const p = getMdiPath(icon) ?? (o.icon || iconOf.get(a.id) ? null : a.defPath ?? null);
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

/** (01/10/2026) Ung dung chi co tren man hinh co camera + the SD (firmware bao ?cam=, hien chi P4). */
export const CAMERA_ONLY_APPS = new Set(['camera', 'gallery', 'files']);

/** Ung dung HIEN tren menu (bo an), gon cho launcher. */
export function buildLauncherApps(homeUrl: string | undefined, hasCamera = true): LauncherApp[] {
  return listAllApps(homeUrl).filter(a => !a.hidden && (hasCamera || !CAMERA_ONLY_APPS.has(a.id)))
    .map(({ id, label, kind, color, group, url, action, path }) => ({ id, label, kind, color, group, url, action, path }));
}
