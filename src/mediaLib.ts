// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) UNG DUNG "MEDIA" cua panel (public/media.html) — thay trang Media cua Home Assistant:
//   GET  /mlib/browse?id=<media-source://...>[&all=1]  duyet nguon media cua HA (CHI DOC: media_source/browse_media)
//   GET  /mlib/f?id=<media-source://...>               phat tep: resolve_media (URL ky ten, het han nhanh) roi chuyen tiep
//                                                       tu HA kem Range (tua duoc) — moi yeu cau resolve lai
//   GET  /mlib/players                                  loa / TV trong HA (media_player.*, bo cai "unavailable")
//   POST /mlib/cast {player, id, mime}                  phat tep tren loa HA (media_player.play_media, nguoi dung chon)
//   POST /mlib/ctl  {player, act, v?}                   play / pause / stop / volume tren loa da chon
// Chi tu Chromium cua add-on (127.0.0.1). Khong sua cau hinh tich hop nao — chi doc nguon media va goi lenh phat.
import http from 'node:http';
import { isLocalBrowser } from './requestOrigin.js';
import { Readable } from 'node:stream';

import { callService, getRegistry, getStates, wsCalls } from './haSettings.js';
import { findDeviceByMac, macFromDeviceId } from './settingsModel.js';

/** Nguon da co ung dung rieng tren panel (Camera, Su kien, Anh, Radio...) -> an o goc, tru khi ?all=1. */
export const HIDDEN_SOURCES = new Set(['ai_task', 'camera', 'frigate', 'image', 'image_upload', 'radio_browser', 'tts']);
/** Ten tieng Viet cho nguon quen thuoc. */
const SOURCE_NAMES: Record<string, string> = {
  media_source: 'Thư mục media', radio_browser: 'Radio Internet', tts: 'Giọng đọc', camera: 'Camera', frigate: 'Frigate',
  image: 'Ảnh', image_upload: 'Ảnh tải lên', ai_task: 'Ảnh AI', dlna_dms: 'Máy chủ DLNA', jellyfin: 'Jellyfin', plex: 'Plex',
};

export type MediaKind = 'dir' | 'aud' | 'vid' | 'img' | 'other';
export interface MediaItem { t: string; id: string; k: MediaKind; play: boolean; mime?: string }
export interface MediaFolder { t: string; id: string; items: MediaItem[] }

interface HaBrowse {
  title?: string; media_content_id?: string; media_content_type?: string; media_class?: string;
  can_play?: boolean; can_expand?: boolean; children?: HaBrowse[];
}

export function sourceOf(id: string): string { return /^media-source:\/\/([^/]+)/.exec(id)?.[1] ?? ''; }

/** Loai cua mot muc: thu muc / nhac / video / anh — theo media_class roi mime. */
export function kindOf(x: HaBrowse): MediaKind {
  const cls = x.media_class || '', mime = x.media_content_type || '';
  if (x.can_expand && !x.can_play) return 'dir';
  if (/^audio\//.test(mime) || ['music', 'podcast', 'track', 'album'].includes(cls) && !/^video\//.test(mime)) return 'aud';
  if (/^video\//.test(mime) || ['video', 'movie', 'episode', 'tv_show'].includes(cls)) return 'vid';
  if (/^image\//.test(mime) || cls === 'image') return 'img';
  return x.can_expand ? 'dir' : 'other';
}

/** Chuyen ket qua browse_media -> danh sach gon cho trang. Goc: an nguon da co ung dung rieng (tru khi all). */
export function toFolder(r: HaBrowse, root: boolean, all: boolean): MediaFolder {
  const kids = (r.children || []).filter((c) => !!c.media_content_id && (!root || all || !HIDDEN_SOURCES.has(sourceOf(c.media_content_id))));
  const items: MediaItem[] = kids.map((c) => {
    const k = root ? 'dir' : kindOf(c);
    const it: MediaItem = { t: root ? (SOURCE_NAMES[sourceOf(c.media_content_id!)] || c.title || '') : (c.title || ''), id: c.media_content_id!, k, play: !!c.can_play };
    if (c.media_content_type && /\//.test(c.media_content_type)) it.mime = c.media_content_type;
    return it;
  });
  // Thu muc truoc, roi theo ten (so tu nhien: "Bai 2" truoc "Bai 10").
  items.sort((a, b) => (a.k === 'dir' ? 0 : 1) - (b.k === 'dir' ? 0 : 1) || a.t.localeCompare(b.t, 'vi', { numeric: true }));
  return { t: root ? 'Media' : (r.title === 'media' ? SOURCE_NAMES.media_source : r.title || ''), id: r.media_content_id || '', items };
}

/** media_content_type cho play_media tren loa HA. */
export function castType(mime: string | undefined): string {
  if (/^video\//.test(mime || '')) return 'video';
  if (/^image\//.test(mime || '')) return 'image';
  return 'music';
}

export interface Player { id: string; name: string; state: string; vol: number | null; title: string; canVol: boolean }
// MediaPlayerEntityFeature: VOLUME_SET 4, PLAY_MEDIA 512.
export function toPlayers(states: Array<{ entity_id: string; state: string; attributes: Record<string, any> }>): Player[] {
  return states
    .filter((s) => s.entity_id.startsWith('media_player.') && s.state !== 'unavailable' && ((s.attributes.supported_features ?? 0) & 512))
    .map((s) => ({
      id: s.entity_id, name: String(s.attributes.friendly_name || s.entity_id), state: s.state,
      vol: typeof s.attributes.volume_level === 'number' ? Math.round(s.attributes.volume_level * 100) : null,
      title: String(s.attributes.media_title || ''), canVol: !!((s.attributes.supported_features ?? 0) & 4),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

// Ten tep co dau cach ("Nhac 1.mp3") la binh thuong — chi chan ky tu xuong dong / dieu khien.
const ID_RE = /^media-source:\/\/[^\x00-\x1f]{1,1000}$/;
const PLAYER_RE = /^media_player\.[a-z0-9_]{1,100}$/;
const HA_HTTP = () => process.env.HA_HTTP_URL || 'http://homeassistant:8123';

function isLocal(req: http.IncomingMessage): boolean { return /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || ''); }
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let n = 0; const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => { n += c.length; if (n > 8192) { fail(new Error('qua lon')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch (e) { fail(e as Error); } });
    req.on('error', fail);
  });
}

async function browse(id: string, all: boolean): Promise<MediaFolder> {
  const [r] = await wsCalls([id ? { type: 'media_source/browse_media', media_content_id: id } : { type: 'media_source/browse_media' }]);
  return toFolder(r as HaBrowse, !id, all);
}

async function streamFile(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
  const [r] = await wsCalls([{ type: 'media_source/resolve_media', media_content_id: id }]);
  const u = String((r as { url?: string })?.url || '');
  if (!u.startsWith('/')) { json(res, 422, { error: 'Không phát được mục này trên màn.' }); return; }   // URL ngoai: khong lam proxy mo
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const up = await fetch(HA_HTTP() + u, { headers: req.headers.range ? { Range: String(req.headers.range) } : {}, signal: ac.signal });
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(k); if (v) headers[k] = v; }
  res.writeHead(up.status, headers);
  if (!up.body) { res.end(); return; }
  Readable.fromWeb(up.body as any).on('error', () => res.destroy()).pipe(res);
}

/** true = da xu ly request. */
export function handleMediaApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/mlib/')) return false;
  // (12/11/2026) + trang mo TRUC TIEP trong LAN cung origin (app Android mo media.html trong WebView).
  if (!isLocal(req) && !isLocalBrowser(req)) { json(res, 403, { error: 'Chỉ dùng được từ màn hình.' }); return true; }
  const fail = (e: unknown) => { if (!res.headersSent) json(res, 502, { error: (e as Error).message }); else res.destroy(); };
  const id = url.searchParams.get('id') || '';
  if (p === '/mlib/browse' && req.method === 'GET') {
    if (id && !ID_RE.test(id)) { json(res, 400, { error: 'id sai' }); return true; }
    browse(id, url.searchParams.get('all') === '1').then((f) => json(res, 200, f)).catch(fail);
    return true;
  }
  if (p === '/mlib/f' && req.method === 'GET') {
    if (!ID_RE.test(id)) { json(res, 400, { error: 'id sai' }); return true; }
    streamFile(req, res, id).catch(fail);
    return true;
  }
  if (p === '/mlib/players' && req.method === 'GET') {
    // ?dev=esp32-<mac>: bo loa cua CHINH man nay (trung voi "Man nay" — phat ca hai thi tranh loa).
    const mac = macFromDeviceId(url.searchParams.get('dev') || '');
    Promise.all([getStates(), mac ? getRegistry().catch(() => null) : null]).then(([s, reg]) => {
      let own = new Set<string>();
      const d = mac && reg ? findDeviceByMac(reg.devices, mac) : undefined;
      if (d && reg) own = new Set(reg.entities.filter((e) => e.device_id === d.id).map((e) => e.entity_id));
      json(res, 200, toPlayers(s as any).filter((x) => !own.has(x.id)));
    }).catch(fail);
    return true;
  }
  if ((p === '/mlib/cast' || p === '/mlib/ctl') && req.method === 'POST') {
    readJson(req).then(async (b) => {
      const player = String(b?.player || '');
      if (!PLAYER_RE.test(player)) { json(res, 400, { error: 'loa sai' }); return; }
      let ok = false;
      if (p === '/mlib/cast') {
        const mid = String(b?.id || '');
        if (!ID_RE.test(mid)) { json(res, 400, { error: 'id sai' }); return; }
        ok = await callService({ domain: 'media_player', service: 'play_media',
          data: { entity_id: player, media_content_id: mid, media_content_type: castType(b?.mime) } });
        console.log(`[media] phat tren ${player}${ok ? '' : ' — HA bao loi'}`);
      } else {
        const act = String(b?.act || '');
        const svc: Record<string, string> = { play: 'media_play', pause: 'media_pause', stop: 'media_stop', vol: 'volume_set' };
        if (!svc[act]) { json(res, 400, { error: 'lenh sai' }); return; }
        const data: Record<string, unknown> = { entity_id: player };
        if (act === 'vol') {
          const v = Number(b?.v);
          if (!Number.isFinite(v) || v < 0 || v > 100) { json(res, 400, { error: 'am luong sai' }); return; }
          data.volume_level = Math.round(v) / 100;
        }
        ok = await callService({ domain: 'media_player', service: svc[act], data });
      }
      json(res, ok ? 200 : 502, ok ? { ok } : { error: 'Loa không nhận lệnh.' });
    }).catch(fail);
    return true;
  }
  json(res, 404, { error: 'khong co' });
  return true;
}
