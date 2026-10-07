// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (07/10/2026) UNG DUNG IPTV — danh sach kenh M3U nguoi dung them o trang Darboard (the IPTV); trang public/iptv.html phat
// bang hls.js / mpegts.js (phuc vu tu node_modules, khong can CDN). Server lam 3 viec:
//   1. Tai + phan tich danh sach M3U (parseM3u thuan, co test), luu dia /data/rwv-iptv-cache de mat mang van co kenh.
//   2. PROXY luong /iptv/p: trang chay o http://127.0.0.1:18080 nen moi luong deu cung nguon (khong vuong CORS — do
//      07/10: 11/82 kenh mau thieu header CORS), gan header rieng tung kenh (User-Agent/Referer trong M3U — trinh duyet
//      khong cho trang tu dat), viet lai playlist HLS de doan con cung di qua proxy. Chi nhan tu 127.0.0.1 KEM ma phien
//      (sinh moi lan khoi dong, chi trang cung nguon doc duoc qua /iptv/channels) — trang web la mo o tab Trinh duyet
//      khong muon proxy de doc mang LAN duoc.
//   3. Kenh yeu thich (chung moi man hinh).
// Khong ho tro: DRM (Widevine/KODIPROP license), DASH (.mpd), udp:// / rtmp:// (can udpxy / may chu chuyen ma).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';

export type StreamKind = 'hls' | 'ts' | 'flv' | 'mp4' | 'dash' | 'auto';
export interface Channel {
  /** On dinh trong mot danh sach: bam (danh sach | URL). */
  id: string;
  name: string;
  logo?: string;
  groups: string[];
  url: string;
  /** User-Agent / Referer / Origin / Cookie rieng cua kenh (EXTVLCOPT, EXTHTTP, hau to "|k=v"). */
  headers?: Record<string, string>;
  kind: StreamKind;
  drm?: boolean;
  list: string;
}
export interface IptvList { id: string; name: string; url: string; on: boolean }
interface IptvConfig { lists: IptvList[]; favs: string[] }

const OTHER = 'Khác';
const HEADER_NAMES: Record<string, string> = {
  'user-agent': 'User-Agent', 'referer': 'Referer', 'referrer': 'Referer', 'origin': 'Origin', 'cookie': 'Cookie',
};

/** FNV-1a 32 bit -> base36 (ma kenh ngan, on dinh giua cac lan tai). */
function hash36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** key="gia tri" key2=gia-tri ... -> { key: 'gia tri' } (ten khoa viet thuong). */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  // Gia tri khong ngoac co the dinh ngoac le (danh sach that: group-title=Radio" tvg-logo="...") — bo ngoac le.
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? (m[4] ?? '').replace(/["']/g, '')).trim();
  return out;
}

/** "#EXTINF:-1 tvg-logo="..." group-title="A, B",Ten kenh" — ten la phan sau dau phay DAU TIEN nam ngoai ngoac kep. */
function parseExtinf(line: string): { name: string; attrs: Record<string, string> } {
  const s = line.slice(8);
  let q = false, i = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) break;
  }
  if (i >= s.length) { const j = s.lastIndexOf(','); if (j >= 0) i = j; }  // ngoac le lam lech: lay dau phay cuoi
  return { name: s.slice(i + 1).trim(), attrs: parseAttrs(s.slice(0, i)) };
}

function normHeader(k: string): string { return HEADER_NAMES[k.trim().toLowerCase()] ?? k.trim(); }

/** Kieu luong doan theo duong dan (phan mo rong) — 'auto' = hoi may chu (/iptv/probe) luc phat. */
export function kindFromUrl(url: string): StreamKind {
  let p: string;
  try { p = new URL(url).pathname.toLowerCase(); } catch { return 'auto'; }
  if (/\.m3u8?$/.test(p)) return 'hls';
  if (/\.mpd$/.test(p)) return 'dash';
  if (/\.ts$/.test(p) || /\/(udp|rtp)\//.test(p)) return 'ts';
  if (/\.flv$/.test(p)) return 'flv';
  if (/\.(mp4|m4v|webm|mov)$/.test(p)) return 'mp4';
  return 'auto';
}

/** Ten kenh iptv-org co nhan "[Geo-blocked]" / "[Not 24/7]" — bo cho gon (nguoi dung o VN). */
function cleanName(n: string): string {
  return n.replace(/\s*\[(?:Geo-blocked|Not 24\/7)\]/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Phan tich M3U / M3U8 "IPTV" (khong phai playlist HLS): #EXTINF (tvg-logo, group-title, tvg-name), #EXTGRP,
 * #EXTVLCOPT:http-user-agent / http-referrer, #EXTHTTP:{json}, #KODIPROP (license -> DRM, manifest_type), hau to
 * "url|User-Agent=..&Referer=.." (kieu Kodi). Bo: URL khong phai http(s) (udp/rtmp/rtsp — `skipped`), URL trung.
 */
export function parseM3u(text: string, listId: string): { channels: Channel[]; skipped: number; epg?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const channels: Channel[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let epg: string | undefined;
  let inf: { name: string; attrs: Record<string, string> } | null = null;
  let grp: string | undefined;
  let headers: Record<string, string> = {};
  let drm = false, dash = false;
  const reset = () => { inf = null; grp = undefined; headers = {}; drm = false; dash = false; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const a = parseAttrs(line.slice(7));
      epg = a['url-tvg'] || a['x-tvg-url'] || epg;
      continue;
    }
    if (line.startsWith('#EXTINF:')) { inf = parseExtinf(line); continue; }
    if (line.startsWith('#EXTGRP:')) { grp = line.slice(8).trim(); continue; }
    if (line.startsWith('#EXTVLCOPT:')) {
      const kv = line.slice(11), eq = kv.indexOf('=');
      if (eq > 0) {
        const k = kv.slice(0, eq).trim().toLowerCase(), v = kv.slice(eq + 1).trim();
        if (k === 'http-user-agent') headers['User-Agent'] = v;
        else if (k === 'http-referrer' || k === 'http-referer') headers['Referer'] = v;
        else if (k === 'http-origin') headers['Origin'] = v;
      }
      continue;
    }
    if (line.startsWith('#EXTHTTP:')) {
      try {
        const j = JSON.parse(line.slice(9)) as Record<string, unknown>;
        for (const [k, v] of Object.entries(j)) if (typeof v === 'string') headers[normHeader(k)] = v;
      } catch { /* dong hong: bo qua */ }
      continue;
    }
    if (line.startsWith('#KODIPROP:')) {
      const kv = line.slice(10);
      if (/license_(type|key)\s*=/i.test(kv)) drm = true;
      if (/manifest_type\s*=\s*mpd/i.test(kv)) dash = true;
      continue;
    }
    if (line.startsWith('#')) continue;

    // Dong URL (co the kem "|header=..").
    const bar = line.indexOf('|');
    const url = (bar >= 0 ? line.slice(0, bar) : line).trim();
    const h = { ...headers };
    if (bar >= 0) {
      for (const part of line.slice(bar + 1).split('&')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        let v = part.slice(eq + 1);
        try { v = decodeURIComponent(v); } catch { /* giu nguyen */ }
        h[normHeader(part.slice(0, eq))] = v;
      }
    }
    const cur = inf as { name: string; attrs: Record<string, string> } | null;
    const g = grp, isDrm = drm, isDash = dash;
    reset();
    if (!/^https?:\/\//i.test(url)) { skipped++; continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    const a = cur?.attrs ?? {};
    let name = cleanName(cur?.name || a['tvg-name'] || '');
    if (!name) {
      try { const u = new URL(url); name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname); } catch { name = url; }
    }
    const groups = (a['group-title'] || g || '').split(';').map((s) => s.trim())
      .map((s) => (/^(undefined|other|others|uncategorized)$/i.test(s) ? OTHER : s)).filter(Boolean);
    const ch: Channel = {
      id: hash36(listId + '|' + url), name, groups: groups.length ? [...new Set(groups)] : [OTHER], url,
      kind: isDash ? 'dash' : kindFromUrl(url), list: listId,
    };
    const logo = a['tvg-logo'] || a['logo'];
    if (logo && /^https?:\/\//i.test(logo)) ch.logo = logo;
    if (Object.keys(h).length) ch.headers = h;
    if (isDrm) ch.drm = true;
    channels.push(ch);
  }
  return { channels, skipped, epg };
}

/**
 * Viet lai playlist HLS (master / media): moi URI (dong segment, URI="..." cua EXT-X-KEY / MAP / MEDIA / I-FRAME...)
 * thanh URL tuyet doi (tinh tu `base` — dia chi CUOI sau chuyen huong) roi qua `mk` (dia chi proxy). URI khong phai
 * http(s) (data:, skd:) giu nguyen.
 */
export function rewritePlaylist(body: string, base: string, mk: (abs: string) => string): string {
  const conv = (u: string): string => {
    let abs: string;
    try { abs = new URL(u, base).toString(); } catch { return u; }
    return /^https?:/i.test(abs) ? mk(abs) : u;
  };
  return body.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${conv(u)}"`);
    return conv(t);
  }).join('\n');
}

/** Doan kieu luong tu content-type + vai KB dau (luong khong co phan mo rong, vd Xtream ".../12345"). */
export function sniffKind(contentType: string, head: Buffer): StreamKind | '?' {
  const ct = contentType.toLowerCase();
  let off = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) off = 3;
  const txt = head.subarray(off, off + 512).toString('latin1');
  if (ct.includes('mpegurl') || txt.trimStart().startsWith('#EXTM3U')) return 'hls';
  if (ct.includes('dash+xml') || /<MPD[\s>]/.test(txt)) return 'dash';
  // MPEG-TS: byte dong bo 0x47 lap lai moi 188 byte (cho phep bat dau lech goi).
  for (let i = 0; i < Math.min(188, head.length); i++) {
    if (head[i] === 0x47 && (i + 188 >= head.length || head[i + 188] === 0x47) && (i + 376 >= head.length || head[i + 376] === 0x47)) {
      if (i + 188 < head.length) return 'ts';
      break;
    }
  }
  if (txt.startsWith('FLV')) return 'flv';
  if (head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (ct.includes('mp2t')) return 'ts';
  if (ct.includes('x-flv')) return 'flv';
  if (ct.includes('video/mp4') || ct.includes('video/webm')) return 'mp4';
  return '?';
}

// ── Cau hinh + bo dem ────────────────────────────────────────────────────────────────────────────────────────────
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const CONF_FILE = process.env.IPTV_FILE || path.join(DATA_DIR, 'rwv-iptv.json');
const CACHE_DIR = path.join(DATA_DIR, 'rwv-iptv-cache');
const REFRESH_MS = 6 * 3600_000;
const MAX_LIST_BYTES = 20 * 1024 * 1024;
const MAX_LISTS = 20;
/** Danh sach MAU khi chua cau hinh: kenh Viet Nam cong khai cua iptv-org (do 07/10: 82 kenh, 52 tra 200). */
const SAMPLE: IptvList = { id: 'mau-vn', name: 'iptv-org — Việt Nam (mẫu)', url: 'https://iptv-org.github.io/iptv/countries/vn.m3u', on: true };

let conf: IptvConfig | null = null;
function config(): IptvConfig {
  if (conf) return conf;
  try {
    const j = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')) as Partial<IptvConfig>;
    conf = { lists: Array.isArray(j.lists) ? j.lists : [SAMPLE], favs: Array.isArray(j.favs) ? j.favs : [] };
  } catch { conf = { lists: [SAMPLE], favs: [] }; }
  return conf;
}
function saveConfig(): void {
  try { fs.mkdirSync(path.dirname(CONF_FILE), { recursive: true }); fs.writeFileSync(CONF_FILE, JSON.stringify(conf, null, 1)); }
  catch (e) { console.warn('[iptv] khong luu duoc cau hinh:', (e as Error).message); }
}

interface ListState { at: number; channels: Channel[]; skipped: number; error?: string; stale?: boolean }
const state = new Map<string, ListState>();
const inflight = new Map<string, Promise<ListState>>();

/** Ten may chu (khong lo duong dan / tai khoan Xtream trong log). */
function hostOf(u: string): string { try { return new URL(u).host; } catch { return u.startsWith('/') ? 'tep cuc bo' : '?'; } }

/** Duong dan tep cuc bo duoc phep: /media (HA, chi doc) va /config (thu muc cau hinh rieng cua addon). */
function localPath(u: string): string | null {
  if (!u.startsWith('/')) return null;
  const p = path.posix.normalize(u);
  return /^\/(media|config)\//.test(p) ? p : null;
}

async function fetchText(u: string): Promise<string> {
  const lp = localPath(u);
  if (lp) {
    const st = await fs.promises.stat(lp);
    if (st.size > MAX_LIST_BYTES) throw new Error('tệp quá lớn (> 20 MB)');
    return fs.promises.readFile(lp, 'utf8');
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const { res } = await upstream(u, {}, ac.signal);
    const code = res.statusCode ?? 0;
    if (code >= 400) { res.resume(); throw new Error(`máy chủ trả lỗi ${code}`); }
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of res as AsyncIterable<Buffer>) {
      n += c.length;
      if (n > MAX_LIST_BYTES) { res.destroy(); throw new Error('danh sách quá lớn (> 20 MB)'); }
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (e) {
    if (ac.signal.aborted) throw new Error('hết thời gian chờ (30 giây)');
    throw e;
  } finally { clearTimeout(timer); }
}

function cacheFile(id: string): string { return path.join(CACHE_DIR, id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.m3u'); }

async function loadList(l: IptvList, force: boolean): Promise<ListState> {
  const cur = state.get(l.id);
  if (!force && cur && !cur.error && Date.now() - cur.at < REFRESH_MS) return cur;
  const run = inflight.get(l.id);
  if (run) return run;
  const p = (async (): Promise<ListState> => {
    let text: string | null = null, error: string | undefined, stale = false;
    try {
      text = await fetchText(l.url);
      if (!/#EXTINF|^https?:\/\//m.test(text)) throw new Error('không phải danh sách M3U');
      fs.promises.mkdir(CACHE_DIR, { recursive: true }).then(() => fs.promises.writeFile(cacheFile(l.id), text!)).catch(() => { });
    } catch (e) {
      error = (e as Error).message;
      try { text = await fs.promises.readFile(cacheFile(l.id), 'utf8'); stale = true; } catch { text = null; }
    }
    const parsed = text ? parseM3u(text, l.id) : { channels: [], skipped: 0 };
    const st: ListState = { at: Date.now(), channels: parsed.channels, skipped: parsed.skipped, error, stale };
    state.set(l.id, st);
    console.log(`[iptv] danh sach "${l.name}" (${hostOf(l.url)}): ${parsed.channels.length} kenh` +
      (parsed.skipped ? `, bo ${parsed.skipped} (khong phai http)` : '') + (error ? ` — LOI: ${error}${stale ? ' (dung ban luu)' : ''}` : ''));
    return st;
  })().finally(() => inflight.delete(l.id));
  inflight.set(l.id, p);
  return p;
}

async function allChannels(force = false): Promise<{ lists: (IptvList & { count: number; error?: string; stale?: boolean; at: number; skipped: number })[]; channels: Channel[] }> {
  const c = config();
  const on = c.lists.filter((l) => l.on);
  const states = await Promise.all(on.map((l) => loadList(l, force)));
  const lists = c.lists.map((l) => {
    const s = l.on ? state.get(l.id) : undefined;
    return { ...l, count: s?.channels.length ?? 0, error: s?.error, stale: s?.stale, at: s?.at ?? 0, skipped: s?.skipped ?? 0 };
  });
  return { lists, channels: states.flatMap((s) => s.channels) };
}

// ── Proxy ────────────────────────────────────────────────────────────────────────────────────────────────────────
const TOKEN = crypto.randomBytes(12).toString('base64url');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/** GET qua node:http(s): tu theo chuyen huong (5 lan), CHAP NHAN chung chi TLS hong (may chu IPTV hay het han), 15 s
 * khong co du lieu thi cat (ca khi trang dung doc — tab bi dong bang — de khong giu ket noi toi nguon). */
function upstream(url: string, headers: Record<string, string>, signal?: AbortSignal, redirects = 0):
  Promise<{ res: http.IncomingMessage; url: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { reject(new Error('địa chỉ không hợp lệ')); return; }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) { reject(new Error('chỉ hỗ trợ http/https')); return; }
    const req = mod.request(u, {
      method: 'GET', timeout: 15_000, rejectUnauthorized: false,
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Encoding': 'identity', ...headers },
    } as https.RequestOptions, (res) => {
      const loc = res.headers.location, code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && loc && redirects < 5) {
        res.resume();
        let next: string;
        try { next = new URL(loc, u).toString(); } catch { reject(new Error('chuyển hướng hỏng')); return; }
        upstream(next, headers, signal, redirects + 1).then(resolve, reject);
        return;
      }
      resolve({ res, url: u.toString() });
    });
    req.on('timeout', () => req.destroy(new Error('nguồn không trả lời')));
    req.on('error', reject);
    if (signal) {
      if (signal.aborted) req.destroy(new Error('huy'));
      else signal.addEventListener('abort', () => req.destroy(new Error('huy')), { once: true });
    }
    req.end();
  });
}

function encHeaders(h: Record<string, string> | undefined): string {
  return h && Object.keys(h).length ? Buffer.from(JSON.stringify(h)).toString('base64url') : '';
}
function decHeaders(s: string | null): Record<string, string> {
  if (!s) return {};
  try {
    const j = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && /^[A-Za-z-]{1,40}$/.test(k)) out[k] = v;
    return out;
  } catch { return {}; }
}
function proxyUrl(abs: string, h: string): string {
  return `/iptv/p?t=${TOKEN}&u=${encodeURIComponent(abs)}${h ? '&h=' + h : ''}`;
}

/** Doc goi du lieu DAU (roi tam dung luong) — de nhan ra playlist HLS ma may chu khong bao dung content-type. */
function firstChunk(s: Readable): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const done = () => { s.off('data', onData); s.off('end', onEnd); s.off('error', onErr); };
    const onData = (c: Buffer) => { done(); s.pause(); resolve(c); };
    const onEnd = () => { done(); resolve(null); };
    const onErr = (e: Error) => { done(); reject(e); };
    s.on('data', onData); s.once('end', onEnd); s.once('error', onErr);
  });
}

function isPlaylistStart(b: Buffer | null): boolean {
  if (!b) return false;
  const off = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  return b.subarray(off, off + 32).toString('latin1').trimStart().startsWith('#EXTM3U');
}

async function proxy(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const target = url.searchParams.get('u') || '';
  const hParam = url.searchParams.get('h') || '';
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const fwd = decHeaders(hParam);
  if (req.headers.range) fwd['Range'] = String(req.headers.range);
  let up: { res: http.IncomingMessage; url: string };
  try { up = await upstream(target, fwd, ac.signal); } catch (e) {
    if (!res.headersSent && !ac.signal.aborted) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end((e as Error).message); }
    return;
  }
  const ur = up.res;
  const code = ur.statusCode ?? 502;
  const hdr: http.OutgoingHttpHeaders = { 'cache-control': 'no-store' };
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (ur.headers[k]) hdr[k] = ur.headers[k];
  // MOT bo xu ly 'data' co trang thai: goi dau quyet dinh playlist (gom + viet lai) hay chuyen thang. KHONG pause() roi
  // resume() de "nhin truoc": do 07/10 tren HASS, playlist nam gon trong goi dau (546 B, content-length) thi 'end' khong
  // bao gio toi sau resume -> trang treo 12 s (33/40 kenh mau hong). Chuyen thang tu lo backpressure (drain).
  let mode: 'peek' | 'pl' | 'pass' = 'peek';
  const chunks: Buffer[] = [];
  let n = 0;
  const pass = (c: Buffer) => {
    if (res.destroyed) return;
    if (!res.write(c)) { ur.pause(); res.once('drain', () => ur.resume()); }
  };
  ur.on('data', (c: Buffer) => {
    if (mode === 'peek') {
      if (code < 400 && isPlaylistStart(c)) mode = 'pl';
      else { mode = 'pass'; res.writeHead(code, hdr); pass(c); return; }
    }
    if (mode === 'pl') {
      n += c.length;
      if (n > 4 * 1024 * 1024) { ur.destroy(); res.destroy(); return; }
      chunks.push(c);
    } else pass(c);
  });
  ur.on('end', () => {
    if (mode === 'pl') {
      const body = rewritePlaylist(Buffer.concat(chunks).toString('utf8'), up.url, (abs) => proxyUrl(abs, hParam));
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
      res.end(body);
    } else {
      if (mode === 'peek') res.writeHead(code, hdr);
      res.end();
    }
  });
  ur.on('error', () => res.destroy());
}

/** Kieu luong cua URL khong co phan mo rong: doc goi dau roi cat. */
async function probe(target: string, h: Record<string, string>): Promise<{ kind: StreamKind | '?'; status: number }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const { res } = await upstream(target, h, ac.signal);
    const status = res.statusCode ?? 0;
    const head = await firstChunk(res).catch(() => null);
    res.destroy();
    return { kind: status < 400 && head ? sniffKind(String(res.headers['content-type'] || ''), head) : '?', status };
  } catch { return { kind: '?', status: 0 }; } finally { clearTimeout(timer); ac.abort(); }
}

// ── HTTP API ─────────────────────────────────────────────────────────────────────────────────────────────────────
function isLocal(req: http.IncomingMessage): boolean { return /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || ''); }
function fromIngress(req: http.IncomingMessage): boolean {
  if (process.env.LAUNCHER_CONFIG_OPEN === '1') return true;
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === '172.30.32.2';
}
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req: http.IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > max) { req.destroy(); reject(new Error('quá lớn')); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('JSON không hợp lệ')); } });
    req.on('error', reject);
  });
}

/** Kiem + chuan hoa danh sach tu trang Darboard. */
export function validateLists(v: unknown): IptvList[] {
  if (!Array.isArray(v)) throw new Error('thiếu danh sách');
  if (v.length > MAX_LISTS) throw new Error(`tối đa ${MAX_LISTS} danh sách`);
  const ids = new Set<string>();
  return v.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const url = String(o.url ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(url) && !localPath(url)) throw new Error(`danh sách ${i + 1}: địa chỉ phải bắt đầu bằng http(s):// hoặc /media/ /config/`);
    const name = String(o.name ?? '').trim().slice(0, 60) || (localPath(url) ? 'Tệp cục bộ' : hostOf(url));
    let id = String(o.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    if (!id || ids.has(id)) id = 'l' + hash36(url + i + Date.now());
    ids.add(id);
    return { id, name, url, on: o.on !== false };
  });
}

async function configView(force = false) {
  const { lists } = await allChannels(force);
  return { ok: true, lists, favs: config().favs.length };
}

/** true = da xu ly. */
export function handleIptvApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/iptv/')) return false;
  const local = isLocal(req), ingress = fromIngress(req);
  if (p === '/iptv/p' || p === '/iptv/probe') {
    if (!local || url.searchParams.get('t') !== TOKEN) { json(res, 403, { error: 'Chỉ dùng được từ màn hình.' }); return true; }
    if (p === '/iptv/p') { proxy(req, res, url).catch(() => res.destroy()); return true; }
    probe(url.searchParams.get('u') || '', decHeaders(url.searchParams.get('h'))).then((r) => json(res, 200, r));
    return true;
  }
  if (!local && !ingress) { json(res, 403, { error: 'Chỉ dùng được từ màn hình hoặc trang Darboard.' }); return true; }
  if (p === '/iptv/channels' && req.method === 'GET') {
    allChannels(url.searchParams.get('refresh') === '1').then(({ lists, channels }) => json(res, 200, {
      ok: true, token: TOKEN, favs: config().favs,
      lists: lists.filter((l) => l.on).map((l) => ({ id: l.id, name: l.name, count: l.count, error: l.error, stale: l.stale })),
      channels: channels.map((c) => ({ ...c, h: encHeaders(c.headers), headers: undefined })),
    })).catch((e) => json(res, 500, { ok: false, error: (e as Error).message }));
    return true;
  }
  if (p === '/iptv/fav' && req.method === 'POST') {
    readJson(req, 4096).then((b) => {
      const o = b as { key?: unknown; on?: unknown };
      const key = String(o.key ?? '').trim().toLowerCase().slice(0, 120);
      if (!key) throw new Error('thiếu tên kênh');
      const c = config();
      c.favs = c.favs.filter((k) => k !== key);
      if (o.on) c.favs.unshift(key);
      saveConfig();
      json(res, 200, { ok: true, favs: c.favs });
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  if (p === '/iptv/log' && req.method === 'POST') {
    readJson(req, 2048).then((b) => {
      const o = b as { dev?: unknown; ch?: unknown; msg?: unknown };
      console.log(`[iptv] ${String(o.dev ?? '?').slice(0, 40)}: "${String(o.ch ?? '').slice(0, 60)}" ${String(o.msg ?? '').slice(0, 200)}`);
      json(res, 200, { ok: true });
    }).catch(() => json(res, 400, { ok: false }));
    return true;
  }
  if (p === '/iptv/config' && req.method === 'GET') { configView().then((v) => json(res, 200, v)).catch((e) => json(res, 500, { ok: false, error: (e as Error).message })); return true; }
  if (p === '/iptv/refresh' && req.method === 'POST') { configView(true).then((v) => json(res, 200, v)).catch((e) => json(res, 500, { ok: false, error: (e as Error).message })); return true; }
  if (p === '/iptv/config' && req.method === 'POST') {
    if (!ingress) { json(res, 403, { error: 'Chỉ lưu được từ trang Darboard trong Home Assistant.' }); return true; }
    readJson(req, 64 * 1024).then(async (b) => {
      const lists = validateLists((b as { lists?: unknown }).lists);
      const c = config();
      const before = new Map(c.lists.map((l) => [l.id, l.url]));
      c.lists = lists;
      saveConfig();
      for (const l of lists) if (before.get(l.id) !== l.url) state.delete(l.id);  // doi dia chi: tai lai
      for (const id of [...state.keys()]) if (!lists.some((l) => l.id === id)) { state.delete(id); fs.promises.rm(cacheFile(id), { force: true }).catch(() => { }); }
      console.log(`[iptv] da luu ${lists.length} danh sach (${lists.filter((l) => l.on).length} dang bat)`);
      json(res, 200, await configView());
    }).catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  json(res, 404, { error: 'khong co' });
  return true;
}
