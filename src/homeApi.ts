// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) API cua cac ung dung Nha tren panel: Phong, Dieu khien TV/loa, Viec can lam, Khung anh.
//   GET  /ha/rooms              -> phong + nut dieu khien (homeModel.buildRooms)
//   GET  /ha/media              -> media_player dang dung duoc
//   GET  /ha/art?e=<entity>     -> anh bia cua media_player (qua HA, thu nho)
//   POST /ha/act  {e,a,v}       -> thao tac (homeModel.planAction — danh sach co dinh)
//   GET  /ha/todo               -> danh sach viec (todo.*);  GET /ha/todo/items?l=<entity> -> cac muc
//   POST /ha/todo {l,a,v,d}     -> them / danh dau / xoa muc da xong
//   GET  /photos/list           -> anh trong thu muc anh (PHOTOS_DIR, mac dinh /media/photos)
//   GET  /photos/img?f=&w=&h=   -> mot anh, xoay theo EXIF, thu nho vua man hinh
// CHI nhan tu CHINH may nay (Chromium cua addon, 127.0.0.1): may khac trong LAN khong dieu khien nha / doc anh qua day.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import sharp from 'sharp';
import { callService, getRegistry, getStates, haGetRaw, haReady, wsCalls } from './haSettings.js';
import { buildMedia, buildRooms, buildTodoLists, planAction, planTodo, todoItemsOf } from './homeModel.js';
import type { HaState } from './settingsModel.js';

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const isLocal = (req: http.IncomingMessage) => {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
};

function readBody(req: http.IncomingMessage, max = 4096): Promise<any> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > max) { reject(new Error('qua dai')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Nhieu trang cung hoi moi vai giay: giu trang thai 1,5 s de khong don HA.
let statesCache: { at: number; list: HaState[] } | null = null;
async function states(fresh = false): Promise<HaState[]> {
  if (!fresh && statesCache && Date.now() - statesCache.at < 1500) return statesCache.list;
  const list = await getStates();
  statesCache = { at: Date.now(), list };
  return list;
}

async function rooms() {
  const [reg, list] = await Promise.all([getRegistry(), states()]);
  return buildRooms(reg.areas, reg.devices as any, reg.entities as any, new Map(list.map((s) => [s.entity_id, s])));
}

async function media() {
  const [reg, list] = await Promise.all([getRegistry().catch(() => null), states()]);
  const areaName = new Map((reg?.areas ?? []).map((a) => [a.area_id, a.name]));
  const devArea = new Map((reg?.devices ?? []).map((d: any) => [d.id, d.area_id]));
  const entArea = new Map((reg?.entities ?? []).map((e: any) => [e.entity_id, e.area_id || devArea.get(e.device_id)]));
  return buildMedia(list, (id) => areaName.get(entArea.get(id) as string));
}

const errMsg = (e: unknown) => ({ ok: false, error: `Không kết nối được Home Assistant (${(e as Error).message}).` });

// ── Khung anh ────────────────────────────────────────────────────────────────────────────────────────────────
const IMG_RE = /\.(jpe?g|png|webp)$/i;
// (27/09/2026) CHI thu muc anh rieng (/media/photos). Truoc day thieu thu muc nay thi lui ve ca /media -> quet trung
// anh chup cua Frigate (/media/frigate: nguoi truoc camera) va hien len man hinh cho — sai va lo rieng tu.
function photosDir(): string {
  return process.env.PHOTOS_DIR || '/media/photos';
}
// Du thu muc anh chua gi: khong bao gio lay anh cua camera / ghi hinh.
const SKIP_DIRS = /^(frigate|clips|recordings|snapshots|exports|cctv|camera|cameras)$/i;
let photoCache: { at: number; dir: string; files: string[] } | null = null;
export function listPhotos(): { dir: string; files: string[] } {
  const dir = photosDir();
  if (photoCache && photoCache.dir === dir && Date.now() - photoCache.at < 60_000) return photoCache;
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || files.length >= 5000) return;
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) walk(p, depth + 1); }
      else if (IMG_RE.test(e.name)) files.push(path.relative(dir, p));
      if (files.length >= 5000) return;
    }
  };
  walk(dir, 0);
  files.sort();
  photoCache = { at: Date.now(), dir, files };
  return photoCache;
}

async function sendPhoto(res: http.ServerResponse, url: URL): Promise<void> {
  const { dir, files } = listPhotos();
  const f = url.searchParams.get('f') || '';
  if (!files.includes(f)) { json(res, 404, { error: 'khong co anh' }); return; }
  const full = path.resolve(dir, f);
  if (!full.startsWith(path.resolve(dir) + path.sep)) { json(res, 400, { error: 'duong dan' }); return; }
  const w = Math.min(2048, Math.max(64, Number(url.searchParams.get('w')) || 1024));
  const h = Math.min(2048, Math.max(64, Number(url.searchParams.get('h')) || 600));
  const fit = url.searchParams.get('fit') === 'contain' ? 'inside' : 'cover';
  const buf = await sharp(full).rotate().resize(w, h, { fit, withoutEnlargement: false }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=300' });
  res.end(buf);
}

/** true = da xu ly request. */
export function handleHomeApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (!p.startsWith('/ha/rooms') && !p.startsWith('/ha/media') && !p.startsWith('/ha/art') && !p.startsWith('/ha/act') &&
      !p.startsWith('/ha/todo') && !p.startsWith('/photos/')) return false;
  if (!isLocal(req)) { json(res, 403, { error: 'Chỉ dùng được từ màn hình (trình duyệt của addon).' }); return true; }
  const need = () => { if (!haReady()) { json(res, 200, { ok: false, error: 'Addon không có quyền đọc Home Assistant.' }); return false; } return true; };

  if (p === '/photos/list' && req.method === 'GET') {
    const { dir, files } = listPhotos();
    json(res, 200, { ok: true, dir, files });
    return true;
  }
  if (p === '/photos/img' && req.method === 'GET') {
    sendPhoto(res, url).catch((e) => json(res, 500, { error: (e as Error).message }));
    return true;
  }
  if (!need()) return true;

  if (p === '/ha/rooms' && req.method === 'GET') {
    rooms().then((r) => json(res, 200, { ok: true, rooms: r })).catch((e) => json(res, 200, errMsg(e)));
    return true;
  }
  if (p === '/ha/media' && req.method === 'GET') {
    media().then((m) => json(res, 200, { ok: true, players: m })).catch((e) => json(res, 200, errMsg(e)));
    return true;
  }
  if (p === '/ha/art' && req.method === 'GET') {
    (async () => {
      const e = url.searchParams.get('e') || '';
      const st = (await states()).find((s) => s.entity_id === e && e.startsWith('media_player.'));
      const pic = st?.attributes?.entity_picture;
      if (typeof pic !== 'string' || !pic.startsWith('/')) { res.writeHead(404); res.end(); return; }
      const r = await haGetRaw(pic);
      if (!r.ok) { res.writeHead(404); res.end(); return; }
      const buf = await sharp(Buffer.from(await r.arrayBuffer())).resize(360, 360, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=30' });
      res.end(buf);
    })().catch(() => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
    return true;
  }
  if (p === '/ha/act' && req.method === 'POST') {
    (async () => {
      const b = await readBody(req);
      const [r, m, list] = await Promise.all([rooms(), media(), states()]);
      const ids = new Set<string>([...r.flatMap((x) => x.items.map((i) => i.id)), ...m.map((x) => x.id)]);
      const known = new Map(list.filter((s) => ids.has(s.entity_id)).map((s) => [s.entity_id, s]));
      const plan = planAction(known, String(b.e || ''), String(b.a || ''), b.v);
      if (typeof plan === 'string') { json(res, 400, { ok: false, error: plan }); return; }
      const ok = await callService(plan).catch(() => false);
      statesCache = null;  // lan hoi ke tiep lay trang thai moi
      json(res, ok ? 200 : 502, { ok });
    })().catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  if (p === '/ha/todo' && req.method === 'GET') {
    states().then((l) => json(res, 200, { ok: true, lists: buildTodoLists(l) })).catch((e) => json(res, 200, errMsg(e)));
    return true;
  }
  if (p === '/ha/todo/items' && req.method === 'GET') {
    (async () => {
      const l = url.searchParams.get('l') || '';
      const lists = buildTodoLists(await states());
      if (!lists.some((x) => x.id === l)) { json(res, 404, { ok: false, error: 'Danh sách không tồn tại.' }); return; }
      const [raw] = await wsCalls([{ type: 'todo/item/list', entity_id: l }]);
      json(res, 200, { ok: true, items: todoItemsOf(raw) });
    })().catch((e) => json(res, 200, errMsg(e)));
    return true;
  }
  if (p === '/ha/todo' && req.method === 'POST') {
    (async () => {
      const b = await readBody(req);
      const plan = planTodo(buildTodoLists(await states()), String(b.l || ''), String(b.a || ''), b.v, b.d);
      if (typeof plan === 'string') { json(res, 400, { ok: false, error: plan }); return; }
      const ok = await callService(plan).catch(() => false);
      statesCache = null;
      json(res, ok ? 200 : 502, { ok });
    })().catch((e) => json(res, 400, { ok: false, error: (e as Error).message }));
    return true;
  }
  json(res, 404, { error: 'khong co' });
  return true;
}
