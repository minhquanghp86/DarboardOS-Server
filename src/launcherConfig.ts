// (25/09/2026) Cau hinh MENU UNG DUNG chinh bang giao dien (trang "Menu panel" tren thanh ben HA — ingress):
// an/hien, thu tu trong nhom, doi ten/bieu tuong/mau, them ung dung. Luu /data/launcher.json (ben qua cap nhat addon).
// Bieu tuong MDI ("mdi:ten", dung bo HA dung): server tai SVG tu jsDelivr MOT lan, luu dem /data/mdi-cache.json, roi
// chen duong ve (path) vao launcher -> panel khong phai tai gi.
import fs from 'node:fs';
import path from 'node:path';
import type { AppGroup } from './launcherApps.js';
import { HomeLayout, sanitizeLayout } from './homeLayout.js';

export interface CustomApp { id: string; label: string; url: string; group: AppGroup; icon: string; color: string; }
export interface AppOverride { label?: string; icon?: string; color?: string; group?: AppGroup; }
export interface LauncherConfig {
  hidden: string[];
  order: Partial<Record<AppGroup, string[]>>;
  custom: CustomApp[];
  overrides: Record<string, AppOverride>;
  /** (27/09/2026 OS-3) Bo cuc man hinh chinh sap tren panel. null = mac dinh theo thu tu Menu panel. */
  home: HomeLayout | null;
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const CFG_FILE = process.env.LAUNCHER_CONFIG_FILE || path.join(DATA_DIR, 'launcher.json');
const MDI_FILE = path.join(DATA_DIR, 'mdi-cache.json');
const MDI_CDN = 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/';
export const MDI_VERSION = '7.4.47';

const GROUPS: AppGroup[] = ['nha', 'giai_tri', 'tien_ich'];
const EMPTY: LauncherConfig = { hidden: [], order: {}, custom: [], overrides: {}, home: null };

let cfg: LauncherConfig = load();
let mdi: Record<string, string> = loadMdi();

function load(): LauncherConfig {
  try { return sanitize(JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch { return structuredClone(EMPTY); }
}
function loadMdi(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MDI_FILE, 'utf8')); } catch { return {}; }
}

export function getLauncherConfig(): LauncherConfig { return cfg; }

const isGroup = (g: unknown): g is AppGroup => GROUPS.includes(g as AppGroup);
const ICON_RE = /^mdi:[a-z0-9-]{1,64}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ID_RE = /^[a-z0-9_-]{1,40}$/i;
function str(v: unknown, max: number): string { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

/** Kiem tra/cat gon du lieu tu trinh duyet (va file cu): chi giu gia tri hop le. */
export function sanitize(raw: any): LauncherConfig {
  const out: LauncherConfig = structuredClone(EMPTY);
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.hidden)) out.hidden = raw.hidden.filter((x: unknown) => typeof x === 'string' && ID_RE.test(x)).slice(0, 200);
  if (raw.order && typeof raw.order === 'object') {
    for (const g of GROUPS) {
      const list = raw.order[g];
      if (Array.isArray(list)) out.order[g] = list.filter((x: unknown) => typeof x === 'string' && ID_RE.test(x)).slice(0, 100);
    }
  }
  if (Array.isArray(raw.custom)) {
    for (const c of raw.custom.slice(0, 60)) {
      const id = str(c?.id, 40), label = str(c?.label, 30), url = str(c?.url, 500);
      if (!ID_RE.test(id) || !id.startsWith('c_') || !label || !/^https?:\/\//i.test(url)) continue;
      out.custom.push({
        id, label, url, group: isGroup(c.group) ? c.group : 'tien_ich',
        icon: ICON_RE.test(c.icon) ? c.icon : '', color: COLOR_RE.test(c.color) ? c.color : '#0891b2',
      });
    }
  }
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [id, o] of Object.entries<any>(raw.overrides)) {
      if (!ID_RE.test(id) || !o || typeof o !== 'object') continue;
      const ov: AppOverride = {};
      const label = str(o.label, 30); if (label) ov.label = label;
      if (ICON_RE.test(o.icon)) ov.icon = o.icon;
      if (COLOR_RE.test(o.color)) ov.color = o.color;
      if (isGroup(o.group)) ov.group = o.group;
      if (Object.keys(ov).length) out.overrides[id] = ov;
    }
  }
  out.home = sanitizeLayout(raw.home);
  return out;
}

function writeConfig(next: LauncherConfig): void {
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(next, null, 2));
  cfg = next;
}

/** (27/09/2026 OS-3) Luu bo cuc man hinh chinh (panel gui sau moi lan keo tha). null = dat lai mac dinh. */
export function saveHomeLayout(raw: unknown): HomeLayout | null {
  writeConfig({ ...cfg, home: raw == null ? null : sanitizeLayout(raw) });
  return cfg.home;
}

export async function saveLauncherConfig(raw: unknown): Promise<LauncherConfig> {
  const next = sanitize(raw);
  // Trang Menu panel cu khong biet "home": thieu khoa -> giu bo cuc dang co (khong xoa mat viec nguoi dung da sap).
  if (!raw || typeof raw !== 'object' || !('home' in raw)) next.home = cfg.home;
  await ensureMdiIcons(next);
  writeConfig(next);
  return cfg;
}

/** Duong ve MDI da luu dem (null = chua co -> launcher dung chu cai dau). */
export function getMdiPath(icon: string | undefined): string | null {
  if (!icon || !ICON_RE.test(icon)) return null;
  return mdi[icon.slice(4)] ?? null;
}

/** Tai SVG cua moi bieu tuong MDI dang dung ma chua co trong bo dem. */
export async function ensureMdiIcons(c: LauncherConfig = cfg): Promise<void> {
  const want = new Set<string>();
  for (const a of c.custom) if (a.icon) want.add(a.icon.slice(4));
  for (const o of Object.values(c.overrides)) if (o.icon) want.add(o.icon.slice(4));
  let changed = false;
  for (const name of want) {
    if (mdi[name]) continue;
    try {
      const r = await fetch(MDI_CDN + name + '.svg', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = /<path[^>]*\sd="([^"]+)"/.exec(await r.text())?.[1];
      if (d) { mdi[name] = d; changed = true; }
    } catch (e) {
      console.warn(`[launcher] khong tai duoc bieu tuong mdi:${name}: ${(e as Error).message}`);
    }
  }
  if (changed) {
    try { fs.mkdirSync(path.dirname(MDI_FILE), { recursive: true }); fs.writeFileSync(MDI_FILE, JSON.stringify(mdi)); } catch { }
  }
}
