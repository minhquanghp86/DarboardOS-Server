// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026 OS-2) Chinh sach tab THUAN (khong CDP) — tach khoi deviceManager.ts de kiem thu duoc:
//   - hang doi tuan tu cho moi thao tac tab cua MOT thiet bi (chong tao trung tab),
//   - chon tab can don khi vuot MAX_APP_TABS,
//   - danh sach "Dang phat" (tab nen dang phat am thanh) cho thanh trang thai.

/** Phan cua Tab ma cac chinh sach duoi day can doc. */
export interface TabPolicyView {
  key: string;
  label: string;
  pinned: boolean;
  /** Ung dung duoc phep keu KHI KHONG active (Radio/Nhac). */
  backgroundAudio: boolean;
  /** Trang cua tab tu bao dang phat (the <audio>/<video> khong paused) — xem buildAudioGuardScript. */
  mediaPlaying: boolean;
  /** Trang da tung bao trang thai phat it nhat mot lan tu lan dieu huong gan nhat. */
  mediaKnown: boolean;
  lastUsed: number;
}

/**
 * Tab nen co dang (hoac CO THE dang) giu am thanh khong. Chua biet (trang chua bao lan nao) thi coi nhu CO — thiet ke
 * than trong: don nham mot tab radio dang phat (mat tieng giua chung) te hon giu thua mot tab qua han muc.
 */
export function mayBePlayingInBackground(t: TabPolicyView): boolean {
  return t.backgroundAudio && (t.mediaPlaying || !t.mediaKnown);
}

/**
 * Cac tab can dong (theo thu tu dong) de so tab KHONG GHIM ve <= maxAppTabs. Khong bao gio chon: tab ghim, tab active,
 * tab co the dang phat nen. Het ung vien thi dung (tam vuot han muc).
 */
export function pickEvictions(tabs: Iterable<TabPolicyView>, activeKey: string, maxAppTabs: number): string[] {
  const all = [...tabs];
  let nonPinned = all.filter((t) => !t.pinned).length;
  const candidates = all
    .filter((t) => !t.pinned && t.key !== activeKey && !mayBePlayingInBackground(t))
    .sort((a, b) => a.lastUsed - b.lastUsed);
  const out: string[] = [];
  for (const t of candidates) {
    if (nonPinned <= maxAppTabs) break;
    out.push(t.key);
    nonPinned--;
  }
  return out;
}

/** Thẻ "Đang phát" trong thanh trang thai: tab NEN dang phat THAT (da bao), khong tinh tab dang hien. */
export function nowPlaying(tabs: Iterable<TabPolicyView>, activeKey: string): { k: string; l: string }[] {
  const out: { k: string; l: string }[] = [];
  for (const t of tabs) {
    if (t.key !== activeKey && t.backgroundAudio && t.mediaPlaying) out.push({ k: t.key, l: t.label });
  }
  return out;
}

/**
 * Hang doi tuan tu: moi tac vu chi bat dau khi tac vu truoc (cua CUNG hang doi) da xong — ke ca khi tac vu truoc loi.
 * Dung cho openApp/navigateToUrl: ca hai "kiem tra tab da co chua -> chua thi tao" qua nhieu buoc await, nen hai lenh
 * sat nhau (cham dup bieu tuong, vuot mep lap lai) se CUNG thay "chua co" va tao HAI tab — tab dau bi ghi de khoi
 * `dev.tabs`, khong bao gio duoc dong (ro mot tien trinh renderer Chromium moi lan).
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => { });
    return p;
  }
}

/** Mot the trong man hinh "Gan day": k = khoa tab, l = ten, t = anh thu nho (data URL) hoac null, p = ghim (khong dong). */
export interface RecentCard { k: string; l: string; t: string | null; p: boolean; a: boolean }

/**
 * (26/09/2026 OS-3) Danh sach "Gan day": moi tab dang mo tru man hinh chinh (no la noi ta DANG dung khi mo Gan day tu
 * Home), moi dung gan nhat truoc. Tab ghim (Home Assistant) hien nhung khong co nut dong.
 */
export function recentsList(
  tabs: Iterable<{ key: string; label: string; pinned: boolean; lastUsed: number; thumb?: string }>, activeKey: string,
): RecentCard[] {
  return [...tabs]
    .filter((t) => t.key !== '__system')
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .map((t) => ({ k: t.key, l: t.label, t: t.thumb ?? null, p: t.pinned, a: t.key === activeKey }));
}

/** Ten mien "goc" de so khop ung dung: bo www./m., gom cac ten mien bi danh (youtu.be = youtube.com). */
function siteOf(url: string): string | null {
  let h: string;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return null; }
  h = h.replace(/^(www|m|mobile)\./, '');
  const ALIAS: Record<string, string> = { 'youtu.be': 'youtube.com', 'vt.tiktok.com': 'tiktok.com' };
  return ALIAS[h] ?? h;
}

/**
 * (26/09/2026) URL mo tu thuc the "URL hien thi" / tu dong hoa HA thuoc ung dung nao trong menu (cung trang web) — vd
 * https://youtu.be/xyz -> 'youtube'. Nho vay no vao DUNG tab ung dung do (tu dung khi roi di, co trong Gan day voi
 * dung ten/bieu tuong) thay vi tab "Trinh duyet" chung. Khong khop -> null.
 */
export function appKeyForUrl(url: string, apps: { id: string; url?: string }[]): string | null {
  const site = siteOf(url);
  if (!site) return null;
  const path = new URL(url).pathname;
  // Cung trang web VA duong dan cua ung dung la tien to (ung dung noi bo cung host 127.0.0.1 khac nhau o duong dan:
  // /weather.html, /timer.html...). Nhieu ung dung khop -> duong dan dai nhat (cu the nhat).
  let best: { id: string; len: number } | null = null;
  for (const a of apps) {
    if (!a.url || siteOf(a.url) !== site) continue;
    const p = new URL(a.url).pathname.replace(/\/$/, '');
    if (p && path !== p && !path.startsWith(p + '/')) continue;
    if (!best || p.length > best.len) best = { id: a.id, len: p.length };
  }
  return best ? best.id : null;
}
