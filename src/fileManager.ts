// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (02/10/2026) QUAN LY FILE — the SD cua man hinh co camera (P4, firmware cam_app) quan ly tu trang "Darboard" tren thanh
// ben Home Assistant (public/launcher-config.html, the #quan-ly-file). CHI qua ingress cua HA (da dang nhap).
//   - Duyet / xem / tai ve / xoa / doi ten / tao thu muc: chuyen tiep toi HTTP cua cam_app (/sd/ls, get, rm, mv, mkdir).
//   - Tai ve MP4 (nguoi dung chon "cach B" 02/10): video quay la .mkv (H.264 + tieng mu-law) — dien thoai (iPhone) khong
//     phat duoc. Server chep hinh nguyen (khong nen lai), doi tieng sang AAC, +faststart -> MP4 xem duoc moi noi. Ban
//     MP4 giu o /data/fm-mp4 (bo nho dem, toi da ~3 GB / 3 ngay); tep goc tren the khong doi.
//   - Tai len: trang gui tung khuc 768 KB (duoi gioi han than yeu cau cua ingress) vao /data/fm-tmp, roi MOT viec chay
//     nen: (tuy chon) nen lai video 720p H.264/AAC "toi uu cho man hinh", day vao the tung khuc 256 KB (cam_app /sd/put ->
//     "<ten>.part" -> /sd/mv). Man hinh dang phat video thi TAM DUNG day (WiFi cua P4 ~2 MB/s, chia voi luong hinh).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { camAuth, camHostOf, cameraDevices, fileGate, serveThumb, smallGate } from './camProxy.js';

const INGRESS_IP = '172.30.32.2';
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const TMP_DIR = path.join(DATA_DIR, 'fm-tmp');
const MP4_DIR = path.join(DATA_DIR, 'fm-mp4');
const UP_CHUNK_MAX = 1024 * 1024;          // khuc tai len tu trang (trang gui 768 KB)
const PUSH_CHUNK = 256 * 1024;              // khuc day vao the
const FAT32_MAX = 4 * 1024 * 1024 * 1024 - 1;
const MP4_CACHE_MAX = 3 * 1024 * 1024 * 1024;
const MP4_CACHE_AGE_MS = 3 * 24 * 3600_000;
const VIDEO_RE = /\.(mkv|mp4|m4v|mov|webm|avi|3gp|ts|mts|m2ts|wmv|flv|hevc|h265)$/i;

export interface FileManagerHooks {
  /** Man hinh dang phat video/am thanh -> tam dung day tep vao the. */
  mediaBusy(deviceId: string): boolean;
  /** (09/10/2026) Ten man hinh (so dang ky thiet bi HA) cho o chon man o trang Darboard. */
  screenName?(deviceId: string): string;
}
let hooks: FileManagerHooks | null = null;
export function setFileManagerHooks(h: FileManagerHooks): void { hooks = h; }
/** (09/10/2026) Ten man hinh (so dang ky HA) — IPTV hien o chon man khi duyet the nho. */
export function fmScreenName(id: string): string { return hooks?.screenName?.(id) || id; }

for (const d of [TMP_DIR, MP4_DIR]) fs.mkdirSync(d, { recursive: true });
// Tai len do dang tu lan chay truoc: bo (trang se bao loi va nguoi dung tai lai).
for (const f of fs.readdirSync(TMP_DIR)) fs.rmSync(path.join(TMP_DIR, f), { force: true, recursive: true });

// ── Tien ich ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Duong dan tuyet doi tren the: bat dau '/', khong '..'/'.'/rong, khong ky tu dieu khien hay '\' ':'. */
export function cleanSdPath(p: unknown): string | null {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 255) return null;
  if (/[\u0000-\u001f\u007f\\:]/.test(p)) return null;
  const q = p.replace(/\/+$/, '') || '/';
  if (q !== '/' && q.slice(1).split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return q;
}

/** Ten tep (khong co '/'): bo ky tu FAT32 cam, cat 120 ky tu. */
export function cleanName(n: unknown): string | null {
  if (typeof n !== 'string') return null;
  const s = n.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 120);
  return s ? s : null;
}

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []; let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > max) { reject(new Error('Khúc quá lớn')); req.destroy(); return; } parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/** Goi cam_app, doc JSON. */
// (09/10/2026) dev: man co the nho can thao tac (nha nhieu P4); bo trong -> man co camera dau tien.
function cam(pathQuery: string, method = 'GET', body?: Buffer, dev?: string | null): Promise<{ code: number; j: any }> {
  const h = camHostOf(dev, true).h;
  if (!h) return Promise.reject(new Error('Màn hình có thẻ SD chưa kết nối.'));
  const gate = body ? fileGate : smallGate;
  return gate.run(() => new Promise((resolve, reject) => {
    const up = http.request({ host: h.ip, port: h.port, path: pathQuery, method, timeout: 60_000,
      headers: { ...(body ? { 'content-type': 'application/octet-stream', 'content-length': body.length } : {}), ...camAuth(h) } }, (r) => {
      const parts: Buffer[] = [];
      r.on('data', (c: Buffer) => parts.push(c));
      r.on('end', () => { let j: any = {}; try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { /* */ } resolve({ code: r.statusCode || 502, j }); });
      r.on('error', reject);
    });
    up.on('timeout', () => up.destroy(new Error('Màn hình không trả lời')));
    up.on('error', reject);
    up.end(body);
  }));
}

const enc = encodeURIComponent;

/** (07/10/2026) IPTV (src/iptv.ts): liet ke mot thu muc the SD — chon tep danh sach kenh ngay tren panel / trang Darboard. */
export async function sdLs(dir: string, dev?: string | null): Promise<{ n: string; d: boolean; s: number; t: number }[]> {
  const q = cleanSdPath(dir);
  if (!q) throw new Error('Đường dẫn không hợp lệ');
  const r = await cam('/sd/ls?p=' + enc(q), 'GET', undefined, dev);
  if (r.code >= 400) throw new Error(r.j?.error || r.j?.err || `Thẻ nhớ báo lỗi ${r.code}`);
  return ((r.j?.items || []) as { n?: unknown; d?: unknown; s?: unknown; t?: unknown }[])
    .map((i) => ({ n: String(i.n ?? ''), d: !!i.d, s: Number(i.s) || 0, t: Number(i.t) || 0 }))
    .filter((i) => i.n && i.n[0] !== '.' && !/\.part$/i.test(i.n));
}

/** (07/10/2026) IPTV: doc mot tep van ban (danh sach M3U) tu the SD, toi da `max` byte. */
export function sdReadText(p: string, max: number, dev?: string | null): Promise<string> {
  const q = cleanSdPath(p);
  if (!q || q === '/') return Promise.reject(new Error('Đường dẫn không hợp lệ'));
  const h = camHostOf(dev, true).h;
  if (!h) return Promise.reject(new Error('màn hình có thẻ nhớ chưa kết nối'));
  return fileGate.run(() => new Promise<string>((resolve, reject) => {
    const up = http.request({ host: h.ip, port: h.port, path: '/sd/get?p=' + enc(q), timeout: 30_000, headers: camAuth(h) }, (r) => {
      const code = r.statusCode || 502;
      if (code >= 400) { r.resume(); reject(new Error(code === 404 ? 'không thấy tệp trên thẻ nhớ' : `thẻ nhớ báo lỗi ${code}`)); return; }
      const parts: Buffer[] = [];
      let n = 0;
      r.on('data', (c: Buffer) => { n += c.length; if (n > max) { up.destroy(); reject(new Error('tệp quá lớn (> 20 MB)')); } else parts.push(c); });
      r.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      r.on('error', reject);
    });
    up.on('timeout', () => up.destroy(new Error('màn hình có thẻ nhớ không trả lời')));
    up.on('error', reject);
    up.end();
  }));
}

/** Tai mot tep tu the ve dia (de doi MP4 / ...). */
function downloadTo(p: string, dest: string, dev?: string | null): Promise<void> {
  const h = camHostOf(dev, true).h;
  if (!h) return Promise.reject(new Error('Màn hình có thẻ SD chưa kết nối.'));
  return fileGate.run(() => new Promise<void>((resolve, reject) => {
    const up = http.request({ host: h.ip, port: h.port, path: '/sd/get?p=' + enc(p), timeout: 60_000, headers: camAuth(h) }, (r) => {
      if (r.statusCode !== 200) { r.resume(); reject(new Error(`Không đọc được tệp (HTTP ${r.statusCode})`)); return; }
      const out = fs.createWriteStream(dest);
      r.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject); r.on('error', reject);
    });
    up.on('timeout', () => up.destroy(new Error('Màn hình không trả lời')));
    up.on('error', reject);
    up.end();
  }));
}

function run(cmd: string, args: string[], onLine?: (l: string) => void, killer?: { kill?: () => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (killer) killer.kill = () => p.kill('SIGKILL');
    let err = '', buf = '';
    p.stdout.on('data', (c: Buffer) => { buf += c.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine?.(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    p.stderr.on('data', (c: Buffer) => { err = (err + c.toString()).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(err) : reject(new Error(err.trim().split('\n').pop() || `${cmd} thoát mã ${code}`)));
  });
}

async function durationSec(file: string): Promise<number> {
  let out = '';
  await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (l) => { out += l; });
  const d = Number(out.trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Phuc vu tep tren dia co Range (trinh phat video tua duoc). */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string, dlName?: string): void {
  const st = fs.statSync(file);
  const headers: http.OutgoingHttpHeaders = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
  if (dlName) headers['content-disposition'] = `attachment; filename="${dlName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${enc(dlName)}`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    let a = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
    let b = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    if (a >= st.size || a > b) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
    b = Math.min(b, st.size - 1);
    res.writeHead(206, { ...headers, 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': b - a + 1 });
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  fs.createReadStream(file).pipe(res);
}

// ── MP4 (tai ve / xem truoc) ─────────────────────────────────────────────────────────────────────────────────────────
const mp4Inflight = new Map<string, Promise<string>>();

function pruneMp4Cache(): void {
  try {
    const now = Date.now();
    const files = fs.readdirSync(MP4_DIR).map((f) => { const p = path.join(MP4_DIR, f); const s = fs.statSync(p); return { p, size: s.size, t: s.atimeMs || s.mtimeMs }; })
      .sort((x, y) => y.t - x.t);
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (total > MP4_CACHE_MAX || now - f.t > MP4_CACHE_AGE_MS) fs.rmSync(f.p, { force: true });
    }
  } catch { /* */ }
}

/** MKV/MOV/WebM tren the -> MP4 (hinh chep nguyen, tieng AAC). Khoa theo duong + kich thuoc + gio sua. */
export function ensureMp4(p: string, size: string, t: string, dev?: string | null): Promise<string> {
  const key = crypto.createHash('sha1').update(`${dev || ''}|${p}|${size}|${t}`).digest('hex').slice(0, 20);
  const out = path.join(MP4_DIR, key + '.mp4');
  if (fs.existsSync(out)) { const now = new Date(); fs.utimesSync(out, now, now); return Promise.resolve(out); }
  const cur = mp4Inflight.get(key);
  if (cur) return cur;
  const job = (async () => {
    const src = path.join(TMP_DIR, key + '.src'), tmp = path.join(TMP_DIR, key + '.mp4');
    try {
      await downloadTo(p, src, dev);
      // Hinh: chep nguyen neu la H.264/HEVC/AV1 (MP4 nhan); con lai (VP8...) thi nen lai. Tieng: AAC (mu-law/PCM/Opus...).
      let vcodec = '';
      await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', src], (l) => { vcodec += l.trim(); });
      const copyV = /^(h264|hevc|av1|mpeg4)$/.test(vcodec);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?',
        ...(copyV ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']),
        ...(vcodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp]);
      fs.renameSync(tmp, out);
      console.log(`[fm] doi MP4 ${p} -> ${(fs.statSync(out).size / 1048576).toFixed(1)} MB (${copyV ? 'chep hinh' : 'nen lai hinh'})`);
      pruneMp4Cache();
      return out;
    } finally {
      fs.rmSync(src, { force: true }); fs.rmSync(tmp, { force: true });
      mp4Inflight.delete(key);
    }
  })();
  mp4Inflight.set(key, job);
  return job;
}

// ── Tai len: khuc -> dia, roi viec nen (tuy chon) + day vao the ─────────────────────────────────────────────────────
export interface Job {
  id: string; name: string; dest: string; size: number; opt: boolean;
  /** (09/10/2026) man dich (the nho) + ten de hien trong danh sach Tai len. */
  dev?: string; devName?: string;
  stage: 'queue' | 'convert' | 'push' | 'wait' | 'done' | 'error' | 'cancel';
  pct: number; err?: string; created: number; finished?: number;
}
const jobs: Job[] = [];
const jobFiles = new Map<string, string>();       // id -> tep tam tren may chu
const cancels = new Map<string, { kill?: () => void; cancelled?: boolean }>();
let worker: Promise<void> | null = null;

function upPath(u: string): string { return path.join(TMP_DIR, u + '.part'); }

async function uniqueDest(dir: string, name: string, dev?: string | null): Promise<string> {
  const r = await cam('/sd/ls?p=' + enc(dir), 'GET', undefined, dev);
  if (r.code !== 200 || !Array.isArray(r.j.items)) throw new Error(r.j.err || 'Không đọc được thư mục trên thẻ.');
  const have = new Set<string>((r.j.items as { n: string }[]).map((i) => i.n.toLowerCase()));
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let n = name;
  for (let i = 1; have.has(n.toLowerCase()) || have.has((n + '.part').toLowerCase()); i++) n = `${base} (${i})${ext}`;
  return (dir === '/' ? '' : dir) + '/' + n;
}

async function pushToCard(job: Job, file: string, ctl: { cancelled?: boolean }): Promise<void> {
  const size = fs.statSync(file).size;
  if (size > FAT32_MAX) throw new Error('Tệp lớn hơn 4 GB — thẻ FAT32 không chứa được.');
  const part = job.dest + '.part';
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(PUSH_CHUNK);
  let off = 0, fails = 0;
  try {
    while (off < size || size === 0) {
      if (ctl.cancelled) throw new Error('Đã huỷ');
      const dev = job.dev ?? camHostOf().id;
      if (dev && hooks?.mediaBusy(dev)) { job.stage = 'wait'; await new Promise((r) => setTimeout(r, 2000)); continue; }
      job.stage = 'push';
      const n = fs.readSync(fd, buf, 0, Math.min(PUSH_CHUNK, size - off), off);
      try {
        const r = await cam(`/sd/put?p=${enc(part)}&off=${off}${off === 0 ? `&size=${size}` : ''}`, 'POST', buf.subarray(0, n), job.dev);
        if (r.code === 409 && typeof r.j.have === 'number') { off = r.j.have; continue; }     // lech: ghi tiep tu cho the co
        if (r.code !== 200 || !r.j.ok) throw Object.assign(new Error(r.j.err || `HTTP ${r.code}`), { fatal: r.code === 507 || r.code === 400 });
        off = r.j.size; fails = 0;
      } catch (e) {
        if ((e as { fatal?: boolean }).fatal || ++fails > 6) throw e;
        await new Promise((r) => setTimeout(r, 1500 * fails));
        // Hoi lai kich thuoc that tren the (khuc vua roi co the da ghi mot phan)
        const r = await cam(`/sd/put?p=${enc(part)}&off=${off + 1}`, 'POST', Buffer.alloc(0), job.dev).catch(() => null);
        if (r && r.code === 409 && typeof r.j.have === 'number') off = r.j.have;
      }
      job.pct = size ? Math.min(99, Math.round((off / size) * 100)) : 99;
      if (size === 0) break;
    }
  } finally { fs.closeSync(fd); }
  const mv = await cam(`/sd/mv?p=${enc(part)}&to=${enc(job.dest)}`, 'POST', undefined, job.dev);
  if (mv.code !== 200 || !mv.j.ok) throw new Error(mv.j.err || 'Không đổi tên tệp tạm trên thẻ');
}

async function runJob(job: Job): Promise<void> {
  const src = jobFiles.get(job.id)!;
  const ctl = cancels.get(job.id)!;
  let file = src;
  try {
    if (job.opt && VIDEO_RE.test(job.name)) {
      job.stage = 'convert'; job.pct = 0;
      const out = path.join(TMP_DIR, job.id + '.opt.mp4');
      const dur = await durationSec(src).catch(() => 0);
      // 720p (khung toi da 1280x720, giu ty le, doc cung duoc), H.264 High toi da ~3 Mbps, AAC 128k, faststart.
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out],
      (l) => { const m = /^out_time_ms=(\d+)/.exec(l); if (m && dur) job.pct = Math.min(99, Math.round(Number(m[1]) / 1e6 / dur * 100)); }, ctl);
      if (ctl.cancelled) throw new Error('Đã huỷ');
      file = out;
      const dot = job.name.lastIndexOf('.');
      const nn = (dot > 0 ? job.name.slice(0, dot) : job.name) + '.mp4';
      job.dest = await uniqueDest(job.dest.slice(0, job.dest.lastIndexOf('/')) || '/', nn, job.dev);
      job.name = nn;
    }
    job.size = fs.statSync(file).size;
    job.pct = 0;
    await pushToCard(job, file, ctl);
    job.stage = 'done'; job.pct = 100;
    console.log(`[fm] tai len xong ${job.dest} (${(job.size / 1048576).toFixed(1)} MB${job.opt ? ', da toi uu' : ''})`);
  } catch (e) {
    job.stage = ctl.cancelled ? 'cancel' : 'error';
    job.err = (e as Error).message;
    console.warn(`[fm] tai len ${job.name} loi: ${job.err}`);
  } finally {
    job.finished = Date.now();
    fs.rmSync(src, { force: true });
    if (file !== src) fs.rmSync(file, { force: true });
    jobFiles.delete(job.id); cancels.delete(job.id);
  }
}

function kick(): void {
  if (worker) return;
  worker = (async () => {
    for (let j; (j = jobs.find((x) => x.stage === 'queue'));) await runJob(j);
  })().finally(() => { worker = null; });
}

/** Viec dang chay + viec xong trong 30 phut gan nhat (moi nhat truoc) — danh sach "Tai len" khong giu mai. */
export function visibleJobs(now = Date.now()): Job[] {
  return jobs.filter((j) => !j.finished || now - j.finished < 30 * 60_000).slice(-20).reverse();
}

// ── API (chi ingress) ────────────────────────────────────────────────────────────────────────────────────────────────
/** true = da xu ly (duong /fm/...). */
export function handleFileManager(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (!url.pathname.startsWith('/fm/')) return false;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip !== INGRESS_IP && process.env.LAUNCHER_CONFIG_OPEN !== '1') { json(res, 403, { error: 'Chỉ dùng được từ trang Darboard trong Home Assistant.' }); return true; }
  const route = url.pathname.slice(4), q = url.searchParams;
  const DEV = q.get('dev');    // (09/10/2026) man co the nho dang chon (GET); POST: body.dev
  const fail = (e: unknown, code = 502) => { if (!res.headersSent) json(res, code, { error: (e as Error).message || String(e) }); else res.destroy(); };
  (async () => {
    // (09/10/2026) devices: moi man co the nho dang ket noi (o chon man o trang); device: man dang chon (?dev=, mac dinh man dau).
    const devices = cameraDevices().map((id) => ({ id, name: hooks?.screenName?.(id) || id }));
    if (route === 'info' && req.method === 'GET') {
      const { h, id: dev } = camHostOf(DEV, true);
      if (!dev || !h) return json(res, 200, { ok: true, online: false, device: dev ?? null, devices, jobs: visibleJobs() });
      const st = await cam('/cam/status', 'GET', undefined, dev).catch(() => null);
      return json(res, 200, { ok: true, online: !!st, device: dev, devices, busy: !!hooks?.mediaBusy(dev), sd: st?.j?.sd ?? null,
        rec: st?.j?.rec ?? null, jobs: visibleJobs() });
    }
    if (route === 'ls' && req.method === 'GET') {
      const p = cleanSdPath(q.get('p') || '/');
      if (!p) return json(res, 400, { error: 'Đường dẫn không hợp lệ' });
      const r = await cam('/sd/ls?p=' + enc(p), 'GET', undefined, DEV);
      return json(res, r.code, r.j);
    }
    if (route === 'thumb' && req.method === 'GET') {
      const h = camHostOf(DEV, true).h;
      if (!h) return json(res, 503, { error: 'offline' });
      return serveThumb(h, url.search, res);
    }
    if ((route === 'get' || route === 'mp4') && req.method === 'GET') {
      const p = cleanSdPath(q.get('p'));
      if (!p || p === '/') return json(res, 400, { error: 'Đường dẫn không hợp lệ' });
      const name = p.slice(p.lastIndexOf('/') + 1);
      if (route === 'mp4') {
        const file = await ensureMp4(p, q.get('s') || '', q.get('t') || '', DEV);
        return sendFile(req, res, file, 'video/mp4', q.get('dl') ? name.replace(/\.[^.]+$/, '') + '.mp4' : undefined);
      }
      const h = camHostOf(DEV, true).h;
      if (!h) return json(res, 503, { error: 'Màn hình có thẻ SD chưa kết nối.' });
      return fileGate.run(() => new Promise<void>((done) => {
        const up = http.request({ host: h.ip, port: h.port, path: '/sd/get?p=' + enc(p), timeout: 30_000,
          headers: { ...(req.headers.range ? { range: req.headers.range } : {}), ...camAuth(h) } }, (r) => {
          const headers: http.OutgoingHttpHeaders = { 'cache-control': 'no-store' };
          for (const k of ['content-type', 'content-range', 'accept-ranges'] as const) if (r.headers[k]) headers[k] = r.headers[k];
          const bl = Number(r.headers['x-body-length']);
          if (Number.isFinite(bl) && bl >= 0 && (r.statusCode === 200 || r.statusCode === 206)) headers['content-length'] = bl;
          if (q.get('dl')) headers['content-disposition'] = `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${enc(name)}`;
          res.writeHead(r.statusCode || 502, headers);
          r.pipe(res);
          r.on('end', done); r.on('error', done); r.on('close', done);
        });
        up.on('timeout', () => up.destroy(new Error('Màn hình không trả lời')));
        up.on('error', (e) => { fail(e); done(); });
        req.on('close', () => { if (!res.writableEnded) up.destroy(); done(); });
        up.end();
      }));
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (route === 'up') {
      const u = q.get('u') || '', off = Number(q.get('off'));
      if (!/^[a-f0-9]{16,40}$/.test(u) || !Number.isInteger(off) || off < 0) return json(res, 400, { error: 'Tham số không hợp lệ' });
      const f = upPath(u);
      const have = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (off !== have) { req.resume(); return json(res, 409, { error: 'lệch vị trí', have }); }
      if (have > FAT32_MAX) { req.resume(); return json(res, 413, { error: 'Tệp lớn hơn 4 GB — thẻ FAT32 không chứa được.' }); }
      const b = await readBody(req, UP_CHUNK_MAX);
      fs.appendFileSync(f, b);
      return json(res, 200, { ok: true, size: have + b.length });
    }
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
    const BDEV: string | null = typeof body.dev === 'string' ? body.dev : DEV;
    if (route === 'commit') {
      const u = String(body.u || ''), dir = cleanSdPath(body.dir), name = cleanName(body.name);
      if (!/^[a-f0-9]{16,40}$/.test(u) || !fs.existsSync(upPath(u)) || !dir || !name) return json(res, 400, { error: 'Tham số không hợp lệ' });
      const size = fs.statSync(upPath(u)).size;
      if (typeof body.size === 'number' && body.size !== size) return json(res, 400, { error: 'Tải lên chưa đủ — thử lại' });
      const id = crypto.randomBytes(8).toString('hex');
      const tgt = camHostOf(BDEV, true).id;
      const job: Job = { id, name, dest: await uniqueDest(dir, name, tgt), size, opt: !!body.opt && VIDEO_RE.test(name), stage: 'queue', pct: 0, created: Date.now(),
        ...(tgt ? { dev: tgt, devName: hooks?.screenName?.(tgt) || tgt } : {}) };
      const f = path.join(TMP_DIR, id + '.src');
      fs.renameSync(upPath(u), f);
      jobFiles.set(id, f); cancels.set(id, {});
      jobs.push(job); while (jobs.length > 50) jobs.shift();
      kick();
      return json(res, 200, { ok: true, job });
    }
    if (route === 'cancel') {
      const c = cancels.get(String(body.id || ''));
      const j = jobs.find((x) => x.id === body.id);
      if (c) { c.cancelled = true; c.kill?.(); }
      if (j && j.stage === 'queue') { j.stage = 'cancel'; fs.rmSync(jobFiles.get(j.id) || '', { force: true }); jobFiles.delete(j.id); cancels.delete(j.id); }
      return json(res, 200, { ok: !!(c || j) });
    }
    if (route === 'clear-jobs') {
      for (let i = jobs.length - 1; i >= 0; i--) if (['done', 'error', 'cancel'].includes(jobs[i].stage)) jobs.splice(i, 1);
      return json(res, 200, { ok: true });
    }
    if (route === 'rm') {
      const list: string[] = (Array.isArray(body.paths) ? body.paths : []).map(cleanSdPath).filter((p: string | null): p is string => !!p && p !== '/');
      if (!list.length) return json(res, 400, { error: 'Chưa chọn tệp' });
      const failed: { p: string; err: string }[] = [];
      for (const p of list) {
        const r = await cam('/sd/rm?p=' + enc(p), 'POST', undefined, BDEV).catch((e) => ({ code: 502, j: { err: (e as Error).message } }));
        if (r.code !== 200 || !r.j.ok) failed.push({ p, err: r.j.err || `HTTP ${r.code}` });
      }
      console.log(`[fm] xoa ${list.length - failed.length}/${list.length} muc`);
      return json(res, 200, { ok: failed.length === 0, failed });
    }
    if (route === 'mv') {
      const p = cleanSdPath(body.p), to = cleanSdPath(body.to);
      if (!p || !to || p === '/' || to === '/') return json(res, 400, { error: 'Đường dẫn không hợp lệ' });
      const r = await cam(`/sd/mv?p=${enc(p)}&to=${enc(to)}`, 'POST', undefined, BDEV);
      return json(res, r.code, r.j.ok ? { ok: true } : { error: r.j.err || `HTTP ${r.code}` });
    }
    if (route === 'mkdir') {
      const p = cleanSdPath(body.p);
      if (!p || p === '/') return json(res, 400, { error: 'Tên thư mục không hợp lệ' });
      const r = await cam('/sd/mkdir?p=' + enc(p), 'POST', undefined, BDEV);
      return json(res, r.code, r.j.ok ? { ok: true } : { error: r.j.err || `HTTP ${r.code}` });
    }
    return json(res, 404, { error: 'khong co' });
  })().catch((e) => fail(e));
  return true;
}
