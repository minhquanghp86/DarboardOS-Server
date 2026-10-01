// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (02/10/2026) NHAN TIN NOI BO giua trang "Darboard" tren thanh ben Home Assistant (ingress) va cac panel.
//
// Thanh vien cua mot cuoc tro chuyen: phia 'ha' (moi nguoi dung HA mo trang thanh ben — ten tung nguoi lay tu header
// ingress) LUON co mat, cong mot so man hinh (hoac "moi man hinh"). Tin nhan: chu, anh, video. Xoa cuoc tro chuyen
// = xoa cho moi nguoi (ca tep dinh kem). Luu /data/rwv-chat/ (ben qua cap nhat addon).
//
// Ai goi duoc (src/index.ts -> handleChatApi):
//   ingress HA (172.30.32.2)     -> phia 'ha' (HA da buoc dang nhap)
//   127.0.0.1 + ?dev=<id>         -> man hinh <id> (trang chat.html chay trong Chrome cua chinh addon)
//   may khac trong LAN            -> 403
// Cap nhat tuc thi: GET chat/state?rev=N giu ket noi toi 25 s cho toi khi co thay doi (long-poll — di qua ingress HA
// on dinh hon WebSocket).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

export type Side = 'ha' | 'screen';
export interface Author { side: Side; id: string; name: string }
export interface Media {
  kind: 'image' | 'video';
  file: string;        // ten tep trong thu muc media
  mime: string;
  size: number;
  w?: number; h?: number; dur?: number;
  thumb?: string;      // anh thu nho / poster (jpg) trong thu muc media
}
export interface Msg { id: number; ts: number; from: Author; text?: string; media?: Media }
export interface Conv {
  id: string; title: string;
  /** id man hinh tham gia (phia 'ha' luon co mat). */
  members: string[];
  /** true = moi man hinh (ke ca man hinh them sau nay). */
  all: boolean;
  createdAt: number; createdBy: Author;
  updated: number;
  /** id tin nhan cuoi da doc, theo thanh vien ('ha' hoac id man hinh). */
  read: Record<string, number>;
  nextId: number;
  msgs: Msg[];
}
export interface ScreenInfo { id: string; name: string; w: number; h: number; cam: boolean; online: boolean }

export const MAX_CONVS = 100;
export const MAX_MSGS = 500;        // moi cuoc tro chuyen; cu hon bi bo (ca tep)
export const MAX_TEXT = 2000;
const ID_RE = /^[a-z0-9]{8,32}$/;
const DEV_RE = /^[\w.-]{1,64}$/;

/** Thanh vien key: 'ha' hoac id man hinh. */
export const memberKey = (a: Author) => (a.side === 'ha' ? 'ha' : a.id);

export function canSee(c: Conv, me: Author): boolean {
  return me.side === 'ha' || c.all || c.members.includes(me.id);
}

/** Phan logic thuan (khong dia, khong mang) — de kiem thu. */
export class ChatStore {
  convs = new Map<string, Conv>();
  rev = 1;
  onChange: () => void = () => { };
  /** Tep media khong con tin nhan nao tro toi -> nguoi goi xoa khoi dia. */
  onOrphans: (files: string[]) => void = () => { };

  load(list: Conv[]): void {
    for (const c of list) if (c && ID_RE.test(c.id) && Array.isArray(c.msgs)) this.convs.set(c.id, c);
  }
  private bump(): void { this.rev++; this.onChange(); }

  listFor(me: Author): Conv[] {
    return [...this.convs.values()].filter((c) => canSee(c, me)).sort((a, b) => b.updated - a.updated);
  }
  get(id: string, me: Author): Conv | null {
    const c = this.convs.get(id);
    return c && canSee(c, me) ? c : null;
  }
  unread(c: Conv, me: Author): number {
    const r = c.read[memberKey(me)] ?? 0;
    let n = 0;
    for (let i = c.msgs.length - 1; i >= 0 && c.msgs[i].id > r; i--) if (memberKey(c.msgs[i].from) !== memberKey(me)) n++;
    return n;
  }

  create(me: Author, title: string, members: string[], all: boolean, now = Date.now()): Conv {
    if (this.convs.size >= MAX_CONVS) throw new Error(`Tối đa ${MAX_CONVS} cuộc trò chuyện — xoá bớt cuộc cũ.`);
    const set = new Set(members.filter((m) => DEV_RE.test(m)));
    if (me.side === 'screen') set.add(me.id);
    const c: Conv = {
      id: crypto.randomBytes(8).toString('hex'), title: clean(title, 60), members: [...set], all: !!all,
      createdAt: now, createdBy: me, updated: now, read: {}, nextId: 1, msgs: [],
    };
    this.convs.set(c.id, c); this.bump();
    return c;
  }
  edit(c: Conv, title: string | undefined, members: string[] | undefined, all: boolean | undefined): void {
    if (title !== undefined) c.title = clean(title, 60);
    if (members) c.members = [...new Set(members.filter((m) => DEV_RE.test(m)))];
    if (all !== undefined) c.all = !!all;
    this.bump();
  }
  remove(c: Conv): void {
    this.convs.delete(c.id);
    this.onOrphans(c.msgs.flatMap(mediaFiles));
    this.bump();
  }
  add(c: Conv, from: Author, text: string, media: Media | undefined, now = Date.now()): Msg {
    const t = clean(text, MAX_TEXT, true);
    if (!t && !media) throw new Error('Tin nhắn trống.');
    const m: Msg = { id: c.nextId++, ts: now, from, ...(t ? { text: t } : {}), ...(media ? { media } : {}) };
    c.msgs.push(m);
    c.updated = now;
    c.read[memberKey(from)] = m.id;  // tin cua minh = da doc
    if (c.msgs.length > MAX_MSGS) this.onOrphans(c.msgs.splice(0, c.msgs.length - MAX_MSGS).flatMap(mediaFiles));
    this.bump();
    return m;
  }
  delMsg(c: Conv, id: number, me: Author): boolean {
    const i = c.msgs.findIndex((m) => m.id === id);
    if (i < 0) return false;
    // Xoa tin cua chinh minh; phia HA (quan tri) xoa duoc moi tin.
    if (me.side !== 'ha' && memberKey(c.msgs[i].from) !== memberKey(me)) throw new Error('Chỉ xoá được tin của mình.');
    this.onOrphans(mediaFiles(c.msgs[i]));
    c.msgs.splice(i, 1);
    this.bump();
    return true;
  }
  markRead(c: Conv, me: Author, upTo: number): void {
    const k = memberKey(me);
    const v = Math.min(upTo, c.nextId - 1);
    if ((c.read[k] ?? 0) >= v) return;
    c.read[k] = v; this.bump();
  }
}

function mediaFiles(m: Msg): string[] { return m.media ? [m.media.file, ...(m.media.thumb ? [m.media.thumb] : [])] : []; }

export function clean(s: unknown, max: number, multiline = false): string {
  if (typeof s !== 'string') return '';
  const re = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  return s.replace(re, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// ── Phan chay that: dia, media, API ─────────────────────────────────────────────────────────────────────────────────
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
const ROOT = process.env.CHAT_DIR || path.join(DATA_DIR, 'rwv-chat');
const MEDIA = path.join(ROOT, 'media');
const UP = path.join(ROOT, 'up');
const DB = path.join(ROOT, 'chats.json');
const MEDIA_MAX_MB = Number(process.env.CHAT_MEDIA_MAX_MB) || 2048;
const IMG_MAX = 25 * 1024 * 1024, VID_MAX = 200 * 1024 * 1024, CHUNK_MAX = 1024 * 1024;
const INGRESS_IP = '172.30.32.2';
const LOCAL_URL = `http://127.0.0.1:${process.env.HEALTH_PORT || '18080'}`;

export interface ChatHooks {
  screens(): ScreenInfo[];
  /** Thong bao tren man hinh (postNotify). `conv` -> cham the thong bao mo dung cuoc tro chuyen. */
  notify(device: string, title: string, message: string, conv: string, image?: string): void;
  /** Man hinh dang mo ung dung Tin nhan (tab dang hien)? */
  chatActive(device: string): boolean;
  /** Bao HA (su kien) khi man hinh gui tin. */
  haEvent(data: Record<string, unknown>): void;
  /** Panel co camera: goi cam_app (duong dan nhu /sd/get?p=..), tra ve noi dung. */
  camFetch(pathAndQuery: string, method?: string): Promise<{ code: number; type: string; body: Buffer }>;
  /** (02/10/2026) Nguoi trong HA (thuc the person co user_id): ten + duong anh dai dien (entity_picture). */
  people(): Promise<{ userId: string; name: string; pic: string | null }[]>;
  /** Tai anh tu HA (duong /api/image/serve/... cua entity_picture). */
  haImage(path: string): Promise<Buffer | null>;
  /** (02/10/2026) Sau moi thay doi: server cap nhat so tin chua doc tren man hinh (chuong, man hinh cho, bieu tuong). */
  changed(): void;
}
let hooks: ChatHooks | null = null;
export function setChatHooks(h: ChatHooks): void { hooks = h; }

export const chat = new ChatStore();
try {
  fs.mkdirSync(MEDIA, { recursive: true }); fs.mkdirSync(UP, { recursive: true });
  chat.load(JSON.parse(fs.readFileSync(DB, 'utf8')));
} catch { /* chua co du lieu */ }

let saveT: NodeJS.Timeout | null = null;
const waiters = new Set<() => void>();
chat.onChange = () => {
  if (!saveT) saveT = setTimeout(() => {
    saveT = null;
    try { fs.writeFileSync(DB + '.tmp', JSON.stringify([...chat.convs.values()])); fs.renameSync(DB + '.tmp', DB); }
    catch (e) { console.warn('[chat] khong luu duoc:', (e as Error).message); }
  }, 300);
  for (const w of [...waiters]) w();
  if (!changedT) changedT = setTimeout(() => { changedT = null; hooks?.changed(); }, 150);
};
let changedT: NodeJS.Timeout | null = null;

/** (02/10/2026) Tin CHUA DOC cua mot man hinh: tong + theo cuoc tro chuyen (rieng tung man hinh — man nao doc man do het). */
export function unreadForScreen(deviceId: string): { total: number; byConv: Record<string, number> } {
  const me: Author = { side: 'screen', id: deviceId, name: '' };
  const byConv: Record<string, number> = {};
  let total = 0;
  for (const c of chat.listFor(me)) { const n = chat.unread(c, me); if (n) { byConv[c.id] = n; total += n; } }
  return { total, byConv };
}
chat.onOrphans = (files) => { for (const f of files) fs.promises.unlink(path.join(MEDIA, path.basename(f))).catch(() => { }); };

// Man hinh da tung thay (ten tu HA) — van liet ke khi dang tat.
const known = new Map<string, ScreenInfo>();
const SCREENS_FILE = path.join(ROOT, 'screens.json');
try { for (const s of JSON.parse(fs.readFileSync(SCREENS_FILE, 'utf8'))) known.set(s.id, { ...s, online: false }); } catch { /* */ }
function screens(): ScreenInfo[] {
  const live = hooks?.screens() ?? [];
  let changed = false;
  for (const s of live) {
    const k = known.get(s.id);
    // Ten HA chua tai xong (vua khoi dong): giu ten da luu, khong co thi tam goi theo co man hinh.
    if (!s.name) s.name = k?.name || `Màn hình ${s.w}×${s.h}`;
    if (!k || k.name !== s.name || k.w !== s.w || k.cam !== s.cam) changed = true;
    known.set(s.id, s);
  }
  const liveIds = new Set(live.map((s) => s.id));
  for (const s of known.values()) if (!liveIds.has(s.id)) s.online = false;
  if (changed) fs.promises.writeFile(SCREENS_FILE, JSON.stringify([...known.values()].map(({ online, ...r }) => r))).catch(() => { });
  return [...known.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
const screenName = (id: string) => known.get(id)?.name || id;

// ── (02/10/2026) Anh dai dien nguoi dung HA: anh cua thuc the person gan voi tai khoan (user_id) ──
// Danh ba lam moi 10 phut; anh thu nho 128 px giu trong bo nho, tai lai khi duong anh doi (nguoi dung doi anh).
const people = new Map<string, { name: string; pic: string | null }>();
let peopleAt = 0, peopleBusy: Promise<void> | null = null;
const avatars = new Map<string, { pic: string; img: Buffer | null }>();
function refreshPeople(force = false): Promise<void> {
  if (!hooks || (!force && Date.now() - peopleAt < 10 * 60_000)) return Promise.resolve();
  if (peopleBusy) return peopleBusy;
  peopleBusy = hooks.people().then((list) => {
    people.clear();
    for (const p of list) people.set(p.userId, { name: p.name, pic: p.pic });
    peopleAt = Date.now();
  }).catch(() => { peopleAt = Date.now() - 9 * 60_000; /* thu lai sau 1 phut */ }).finally(() => { peopleBusy = null; });
  return peopleBusy;
}
async function avatarOf(userId: string): Promise<Buffer | null> {
  await refreshPeople();
  const p = people.get(userId);
  if (!p?.pic || !hooks) return null;
  const c = avatars.get(userId);
  if (c && c.pic === p.pic) return c.img;
  let img: Buffer | null = null;
  try {
    const raw = await hooks.haImage(p.pic);
    if (raw) img = await (await import('sharp')).default(raw, { failOn: 'none' }).rotate().resize(128, 128, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  } catch { img = null; }
  avatars.set(userId, { pic: p.pic, img });
  return img;
}
/** userId -> co anh khong (trang chi xin anh cua nguoi co anh; con lai ve chu cai dau). */
function peopleView(): Record<string, { name: string; pic: boolean }> {
  const o: Record<string, { name: string; pic: boolean }> = {};
  for (const [id, p] of people) o[id] = { name: p.name, pic: !!p.pic };
  return o;
}
/** Tin "cua minh": phia HA tinh theo TUNG nguoi dung (nhieu nguoi nha dung chung HA), man hinh theo id. */
const isMine = (from: Author, me: Author) => from.side === me.side && from.id === me.id;

// Mo dung cuoc tro chuyen khi cham thong bao: trang chat.html nhan qua state.open.
const pendingOpen = new Map<string, string>();
export function requestOpenConv(device: string, conv: string): void {
  if (!ID_RE.test(conv)) return;
  pendingOpen.set(device, conv);
  for (const w of [...waiters]) w();
}

function mediaUsedBytes(): number {
  let n = 0;
  try { for (const f of fs.readdirSync(MEDIA)) n += fs.statSync(path.join(MEDIA, f)).size; } catch { /* */ }
  return n;
}

function who(req: http.IncomingMessage, url: URL): Author | null {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip === INGRESS_IP || process.env.LAUNCHER_CONFIG_OPEN === '1' && !url.searchParams.get('dev')) {
    const h = (k: string) => { const v = req.headers[k]; return typeof v === 'string' ? clean(v, 60) : ''; };
    return { side: 'ha', id: h('x-remote-user-id') || 'ha', name: h('x-remote-user-display-name') || h('x-remote-user-name') || 'Home Assistant' };
  }
  if (ip === '127.0.0.1' || ip === '::1') {
    const dev = url.searchParams.get('dev') || '';
    if (DEV_RE.test(dev)) { screens(); return { side: 'screen', id: dev, name: screenName(dev) }; }
  }
  return null;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []; let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > max) { reject(new Error('Dữ liệu quá lớn.')); req.destroy(); return; } parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function readJson(req: http.IncomingMessage): Promise<any> {
  const b = await readBody(req, 64 * 1024);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw new Error('JSON không hợp lệ.'); }
}

function convTitle(c: Conv): string {
  if (c.title) return c.title;
  if (c.all) return 'Mọi màn hình';
  return ['Home Assistant', ...c.members.map(screenName)].join(', ');
}
function preview(m: Msg | undefined): string {
  if (!m) return '';
  if (m.text) return m.text.slice(0, 120);
  return m.media?.kind === 'video' ? 'Video' : 'Ảnh';
}
function summary(c: Conv, me: Author) {
  const last = c.msgs[c.msgs.length - 1];
  return {
    id: c.id, title: convTitle(c), custom: !!c.title, members: c.members, all: c.all, updated: c.updated,
    unread: chat.unread(c, me), createdBy: c.createdBy.name,
    last: last ? { from: last.from.name, mine: isMine(last.from, me), text: preview(last), kind: last.media?.kind ?? 'text', ts: last.ts } : null,
  };
}

/** Man hinh se thay tin nay: thanh vien (hoac moi man hinh), tru nguoi gui. */
function screenRecipients(c: Conv, from: Author): string[] {
  const ids = c.all ? screens().map((s) => s.id) : c.members;
  return ids.filter((id) => !(from.side === 'screen' && from.id === id));
}

function afterSend(c: Conv, m: Msg): void {
  const title = c.title ? `${m.from.name} · ${c.title}` : m.from.name;
  for (const id of screenRecipients(c, m.from)) {
    if (viewing.get(id)?.conv === c.id && Date.now() - (viewing.get(id)?.at ?? 0) < 40_000 && hooks?.chatActive(id)) continue;
    const pic = m.from.side === 'ha' && people.get(m.from.id)?.pic ? `${LOCAL_URL}/chat/avatar?u=${encodeURIComponent(m.from.id)}` : undefined;
    // Nhieu tin chua doc cung cuoc tro chuyen: mot thong bao "3 tin mới · <tin cuoi>" (bao cu duoc thay the).
    const n = chat.unread(c, { side: 'screen', id, name: '' });
    hooks?.notify(id, title, (n > 1 ? `${n} tin mới · ` : '') + preview(m), c.id, pic);
  }
  if (m.from.side === 'screen') {
    hooks?.haEvent({ conversation_id: c.id, conversation: convTitle(c), from: m.from.name, device_id: m.from.id, text: m.text ?? '', kind: m.media?.kind ?? 'text' });
  }
}
// Man hinh dang xem cuoc tro chuyen nao (state?viewing=) — khong bat thong bao trung.
const viewing = new Map<string, { conv: string; at: number }>();

// ── Tep dinh kem ──
function sniff(b: Buffer): { kind: 'image' | 'video'; mime: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (/^(heic|heix|mif1|msf1|avif)/.test(brand)) return { kind: 'image', mime: 'image/heic', ext: 'heic' };
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' };
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (b.readUInt32BE(0) === 0x1a45dfa3) {
    const head = b.subarray(0, 64).toString('latin1');
    return head.includes('webm') ? { kind: 'video', mime: 'video/webm', ext: 'webm' } : { kind: 'video', mime: 'video/x-matroska', ext: 'mkv' };
  }
  return null;
}
const newName = (ext: string) => `${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}.${ext}`;

/** Bien du lieu thanh Media: anh -> chuan hoa (JPEG <= 2048 px tru GIF) + anh thu nho; video -> giu nguyen (+ poster). */
async function makeMedia(buf: Buffer, poster?: Buffer, meta: { w?: number; h?: number; dur?: number } = {}): Promise<Media> {
  const t = sniff(buf);
  if (!t) throw new Error('Chỉ nhận ảnh (JPEG, PNG, GIF, WebP) hoặc video (MP4, WebM, MKV, MOV).');
  if (MEDIA_MAX_MB && mediaUsedBytes() + buf.length > MEDIA_MAX_MB * 1048576)
    throw new Error(`Bộ nhớ tin nhắn đã đầy (${MEDIA_MAX_MB} MB) — xoá bớt cuộc trò chuyện cũ.`);
  const sharp = (await import('sharp')).default;
  if (t.kind === 'image') {
    if (buf.length > IMG_MAX) throw new Error('Ảnh quá lớn (tối đa 25 MB).');
    let out = buf, mime = t.mime, ext = t.ext;
    const img = sharp(buf, { failOn: 'none', animated: t.ext === 'gif' });
    const md = await img.metadata().catch(() => { throw new Error('Không đọc được ảnh (HEIC chưa hỗ trợ — chọn JPEG).'); });
    let w = md.width ?? 0, h = md.pageHeight ?? md.height ?? 0;
    if (t.ext !== 'gif' && (t.ext === 'heic' || Math.max(w, h) > 2560 || buf.length > 3 * 1048576 || (md.orientation ?? 1) !== 1)) {
      const r = await sharp(buf, { failOn: 'none' }).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      out = r.data; w = r.info.width; h = r.info.height; mime = 'image/jpeg'; ext = 'jpg';
    }
    const file = newName(ext);
    await fs.promises.writeFile(path.join(MEDIA, file), out);
    const th = await sharp(out, { failOn: 'none' }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    const thumb = file.replace(/\.\w+$/, '_t.jpg');
    await fs.promises.writeFile(path.join(MEDIA, thumb), th);
    return { kind: 'image', file, mime, size: out.length, w, h, thumb };
  }
  if (buf.length > VID_MAX) throw new Error('Video quá lớn (tối đa 200 MB).');
  const file = newName(t.ext);
  await fs.promises.writeFile(path.join(MEDIA, file), buf);
  let thumb: string | undefined;
  if (poster && sniff(poster)?.kind === 'image') {
    try {
      const th = await sharp(poster, { failOn: 'none' }).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
      thumb = file.replace(/\.\w+$/, '_t.jpg');
      await fs.promises.writeFile(path.join(MEDIA, thumb), th);
    } catch { thumb = undefined; }
  }
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : undefined);
  return { kind: 'video', file, mime: t.mime, size: buf.length, w: num(meta.w, 16384), h: num(meta.h, 16384), dur: num(meta.dur, 86400), thumb };
}

const UP_RE = /^[a-f0-9]{16,40}$/;
function takeUpload(id: unknown): Promise<Buffer | undefined> {
  if (typeof id !== 'string' || !UP_RE.test(id)) return Promise.resolve(undefined);
  const p = path.join(UP, id + '.part');
  return fs.promises.readFile(p).then((b) => { fs.promises.unlink(p).catch(() => { }); return b; }, () => { throw new Error('Tệp tải lên đã hết hạn — gửi lại.'); });
}
// Phan tai do dang qua 1 gio -> xoa.
setInterval(() => {
  fs.promises.readdir(UP).then((fs_) => fs_.forEach((f) => {
    const p = path.join(UP, f);
    fs.promises.stat(p).then((s) => { if (Date.now() - s.mtimeMs > 3600_000) fs.promises.unlink(p).catch(() => { }); }).catch(() => { });
  })).catch(() => { });
}, 15 * 60_000).unref();

function serveMedia(req: http.IncomingMessage, res: http.ServerResponse, name: string): void {
  if (!/^[a-z0-9]+(_t)?\.(jpg|png|gif|webp|mp4|webm|mkv|mov|heic)$/.test(name)) { json(res, 404, { error: 'khong co' }); return; }
  const p = path.join(MEDIA, name);
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) { json(res, 404, { error: 'khong co' }); return; }
    const ext = name.split('.').pop()!;
    const type = ({ jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', heic: 'image/heic' } as Record<string, string>)[ext];
    const headers: http.OutgoingHttpHeaders = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let a = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let b = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (a < 0) a = 0;
      if (a >= st.size || a > b) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': b - a + 1 });
      fs.createReadStream(p, { start: a, end: b }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    fs.createReadStream(p).pipe(res);
  });
}

/** true = da xu ly. Duong dan /chat/... (trang thanh ben goi tuong doi "chat/..." — ingress them tien to). */
export function handleChatApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (!url.pathname.startsWith('/chat/')) return false;
  // Anh dai dien: trang thanh ben (ingress) va moi trang/the thong bao tren panel (127.0.0.1, khong can ?dev=).
  if (url.pathname === '/chat/avatar' && req.method === 'GET') {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (ip !== INGRESS_IP && ip !== '127.0.0.1' && ip !== '::1') { json(res, 403, { error: 'cam' }); return true; }
    avatarOf(url.searchParams.get('u') || '').then((img) => {
      if (!img) { res.writeHead(404, { 'cache-control': 'max-age=300' }); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': img.length, 'cache-control': 'private, max-age=600' });
      res.end(img);
    }).catch(() => json(res, 500, { error: 'loi' }));
    return true;
  }
  const me = who(req, url);
  if (!me) { json(res, 403, { error: 'Chỉ dùng được từ màn hình hoặc trang Darboard trong Home Assistant.' }); return true; }
  const route = url.pathname.slice(6);
  const q = url.searchParams;
  const fail = (e: unknown, code = 400) => json(res, code, { error: (e as Error).message || String(e) });
  const conv = (id: unknown) => {
    const c = typeof id === 'string' ? chat.get(id, me) : null;
    if (!c) throw Object.assign(new Error('Không tìm thấy cuộc trò chuyện (có thể đã bị xoá).'), { code: 404 });
    return c;
  };

  if (route.startsWith('media/') && req.method === 'GET') { serveMedia(req, res, route.slice(6)); return true; }

  if (route === 'state' && req.method === 'GET') {
    refreshPeople();
    const since = Number(q.get('rev')) || 0;
    if (me.side === 'screen') {
      const v = q.get('viewing') || '';
      if (ID_RE.test(v)) viewing.set(me.id, { conv: v, at: Date.now() }); else viewing.delete(me.id);
    }
    const reply = () => {
      const out: Record<string, unknown> = {
        rev: chat.rev, me, convs: chat.listFor(me).map((c) => summary(c, me)), screens: screens(), people: peopleView(),
      };
      if (me.side === 'ha') out.storage = { usedMb: Math.round(mediaUsedBytes() / 1048576), maxMb: MEDIA_MAX_MB };
      if (me.side === 'screen' && pendingOpen.has(me.id)) { out.open = pendingOpen.get(me.id); pendingOpen.delete(me.id); }
      json(res, 200, out);
    };
    if (since !== chat.rev || q.get('wait') !== '1' || (me.side === 'screen' && pendingOpen.has(me.id))) { reply(); return true; }
    let done = false;
    const finish = () => { if (done) return; done = true; waiters.delete(finish); clearTimeout(t); reply(); };
    const t = setTimeout(finish, 25_000);
    waiters.add(finish);
    req.on('close', () => { if (!done) { done = true; waiters.delete(finish); clearTimeout(t); } });
    return true;
  }

  if (route === 'conv' && req.method === 'GET') {
    try {
      const c = conv(q.get('c'));
      json(res, 200, {
        conv: { id: c.id, title: convTitle(c), custom: !!c.title, members: c.members, all: c.all, createdAt: c.createdAt, createdBy: c.createdBy.name },
        msgs: c.msgs.map((m) => ({ ...m, mine: isMine(m.from, me) })),
        read: c.read, rev: chat.rev,
      });
    } catch (e) { fail(e, (e as any).code || 400); }
    return true;
  }

  if (req.method !== 'POST') { json(res, 405, { error: 'method' }); return true; }

  if (route === 'upload') {
    const id = q.get('u') || '', off = Number(q.get('off'));
    if (!UP_RE.test(id) || !Number.isInteger(off) || off < 0) { json(res, 400, { error: 'tham so' }); return true; }
    const p = path.join(UP, id + '.part');
    readBody(req, CHUNK_MAX + 1024).then(async (b) => {
      const cur = await fs.promises.stat(p).then((s) => s.size, () => 0);
      if (cur !== off) { json(res, 409, { error: 'lech vi tri', size: cur }); return; }
      if (cur + b.length > VID_MAX) throw new Error('Tệp quá lớn (tối đa 200 MB).');
      await fs.promises.appendFile(p, b);
      json(res, 200, { ok: true, size: cur + b.length });
    }).catch((e) => fail(e));
    return true;
  }

  (async () => {
    const body = route === 'snap' || route === 'del' || route === 'read' || route === 'msgdel' ? {} : await readJson(req);
    switch (route) {
      case 'new': {
        const c = chat.create(me, body.title, Array.isArray(body.members) ? body.members : [], body.all === true);
        console.log(`[chat] ${me.name}: tao "${convTitle(c)}"`);
        return json(res, 200, { ok: true, id: c.id });
      }
      case 'edit': {
        const c = conv(body.c);
        if (me.side !== 'ha' && memberKey(c.createdBy) !== memberKey(me)) throw new Error('Chỉ người tạo đổi được cuộc trò chuyện.');
        chat.edit(c, typeof body.title === 'string' ? body.title : undefined, Array.isArray(body.members) ? body.members : undefined,
          typeof body.all === 'boolean' ? body.all : undefined);
        return json(res, 200, { ok: true });
      }
      case 'del': {
        const c = conv(q.get('c'));
        chat.remove(c);
        console.log(`[chat] ${me.name}: xoa "${convTitle(c)}"`);
        return json(res, 200, { ok: true });
      }
      case 'read': {
        chat.markRead(conv(q.get('c')), me, Number(q.get('m')) || 0);
        return json(res, 200, { ok: true });
      }
      case 'msgdel': {
        const c = conv(q.get('c'));
        return json(res, 200, { ok: chat.delMsg(c, Number(q.get('m')), me) });
      }
      case 'send': {
        const c = conv(body.c);
        let media: Media | undefined;
        const up = await takeUpload(body.upload);
        if (up) media = await makeMedia(up, await takeUpload(body.poster).catch(() => undefined), { w: body.w, h: body.h, dur: body.dur });
        const m = chat.add(c, me, body.text, media);
        afterSend(c, m);
        return json(res, 200, { ok: true, id: m.id });
      }
      // Man hinh co camera: gui anh/video tu the SD (Thu vien) hoac chup ngay.
      case 'attach-sd': {
        const c = conv(body.c);
        if (!hooks || typeof body.p !== 'string' || !body.p.startsWith('/')) throw new Error('Thiếu tệp.');
        const f = await hooks.camFetch('/sd/get?p=' + encodeURIComponent(body.p));
        if (f.code !== 200) throw new Error('Không đọc được tệp trên thẻ SD.');
        const th = await hooks.camFetch('/sd/thumb?p=' + encodeURIComponent(body.p)).catch(() => null);
        const media = await makeMedia(f.body, th && th.code === 200 ? th.body : undefined, { w: body.w, h: body.h, dur: body.dur });
        const m = chat.add(c, me, body.text, media);
        afterSend(c, m);
        return json(res, 200, { ok: true, id: m.id });
      }
      case 'snap': {
        const c = conv(q.get('c'));
        if (!hooks) throw new Error('Không có camera.');
        const r = await hooks.camFetch('/cam/photo', 'POST');
        if (r.code !== 200) throw new Error('Camera chưa chụp được — thử lại.');
        const img = await hooks.camFetch('/cam/last.jpg');
        if (img.code !== 200) throw new Error('Không lấy được ảnh vừa chụp.');
        const m = chat.add(c, me, '', await makeMedia(img.body));
        afterSend(c, m);
        return json(res, 200, { ok: true, id: m.id });
      }
    }
    json(res, 404, { error: 'khong co' });
  })().catch((e) => fail(e, (e as any).code || 400));
  return true;
}
