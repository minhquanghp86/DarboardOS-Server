// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) LUONG CAMERA P4 (av_stream /live, Matroska H.264) DUNG CHUNG: P4 chi phuc vu MOT nguoi xem (nguoi thu hai
// bi 503) ma Frigate dang giu ket noi do -> server giu DUNG MOT ket noi toi P4 roi chia:
//   - nguoi xem MKV (Frigate qua /cam/live): nguoi DAU nhan nguyen tung byte nhu truoc; nguoi vao sau nhan phan dau MKV
//     (EBML + Segment + Tracks) + cum hinh (Cluster) hien tai -> bat dau dung o khung khoa.
//   - nguoi xem KHUNG (cuoc goi, src/callBridge.ts): cau hinh H.264 (avcC) + tung khung AVCC tu khung khoa ke tiep.
// Bo tach doc DUNG cau truc EBML (khong do mau byte) — chi cac phan tu can thiet.

/** Su kien bo tach: cau hinh rang (track, codec, CodecPrivate), khung, dau Cluster (vi tri byte tuyet doi). */
export type MkvEvent =
  | { kind: 'track'; track: number; codec: string; priv: Buffer | null }
  | { kind: 'frame'; track: number; key: boolean; ts: number; data: Buffer }
  | { kind: 'cluster'; at: number };

const ID = {
  Segment: 0x18538067, Cluster: 0x1f43b675, Tracks: 0x1654ae6b, TrackEntry: 0xae, BlockGroup: 0xa0,
  TrackNumber: 0xd7, CodecID: 0x86, CodecPrivate: 0x63a2, Timecode: 0xe7, SimpleBlock: 0xa3, Block: 0xa1,
};
const MASTER = new Set([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.BlockGroup]);

/** Doc so nguyen do dai thay doi (EBML vint). keep = giu bit danh dau (ID). null = chua du byte. */
export function readVint(b: Buffer, off: number, keep: boolean): { v: number; len: number; unknown: boolean } | null {
  if (off >= b.length) return null;
  const first = b[off];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || off + len > b.length) return null;
  let v = keep ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[off + i]; if (b[off + i] !== 0xff) allOnes = false; }
  return { v, len, unknown: !keep && allOnes };
}

export class MkvDemux {
  private buf: Buffer = Buffer.alloc(0);
  private base = 0;            // vi tri tuyet doi cua buf[0]
  private clusterTc = 0;
  private trackNum = 0;
  private trackCodec = '';
  private trackPriv: Buffer | null = null;
  constructor(private readonly emit: (e: MkvEvent) => void) { }

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let off = 0;
    for (;;) {
      const id = readVint(this.buf, off, true);
      if (!id) break;
      const sz = readVint(this.buf, off + id.len, false);
      if (!sz) break;
      const hdr = id.len + sz.len, at = this.base + off;
      if (MASTER.has(id.v)) {
        // Vao trong (khong can biet kich thuoc — Segment / Cluster cua luong song thuong la "khong ro do dai").
        if (id.v === ID.Cluster) this.emit({ kind: 'cluster', at });
        if (id.v === ID.TrackEntry || id.v === ID.Tracks) this.flushTrack();
        off += hdr;
        continue;
      }
      if (sz.unknown || off + hdr + sz.v > this.buf.length) {
        if (sz.unknown) { off += hdr; continue; }   // phan tu la khong ro do dai: bo qua tieu de
        break;                                       // chua du du lieu
      }
      const body = this.buf.subarray(off + hdr, off + hdr + sz.v);
      switch (id.v) {
        case ID.TrackNumber: this.trackNum = body.readUIntBE(0, Math.min(6, body.length)); break;
        case ID.CodecID: this.trackCodec = body.toString('latin1').replace(/\0+$/, ''); break;
        case ID.CodecPrivate: this.trackPriv = Buffer.from(body); break;
        case ID.Timecode: this.clusterTc = body.length ? body.readUIntBE(0, Math.min(6, body.length)) : 0; break;
        case ID.SimpleBlock: case ID.Block: {
          this.flushTrack();
          const tn = readVint(body, 0, false);
          if (tn && body.length >= tn.len + 3) {
            const rel = body.readInt16BE(tn.len), flags = body[tn.len + 2];
            if (!(flags & 0x06)) {   // khong ho tro lacing (av_stream khong dung)
              this.emit({ kind: 'frame', track: tn.v, key: id.v === ID.SimpleBlock ? !!(flags & 0x80) : false,
                ts: this.clusterTc + rel, data: Buffer.from(body.subarray(tn.len + 3)) });
            }
          }
          break;
        }
      }
      off += hdr + sz.v;
    }
    this.base += off;
    this.buf = off >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(off);
  }

  private flushTrack(): void {
    if (this.trackNum && this.trackCodec) this.emit({ kind: 'track', track: this.trackNum, codec: this.trackCodec, priv: this.trackPriv });
    this.trackNum = 0; this.trackCodec = ''; this.trackPriv = null;
  }
}

export interface RawSink { write(b: Buffer): boolean; destroy(): void }
export type FrameSink = (e: { kind: 'config'; codec: string; avcc: Buffer } | { kind: 'frame'; key: boolean; ts: number; data: Buffer }) => void;

/** Mot ket noi /live toi MOT thiet bi, chia cho nhieu nguoi xem. open(): tra ve luong du lieu tu P4 (hoac loi). */
export class LiveHub {
  private header: Buffer | null = null;   // byte truoc Cluster dau tien
  private since: Buffer = Buffer.alloc(0);   // byte tu dau Cluster gan nhat
  private sinceAt = 0;
  private total = 0;
  private raw = new Map<RawSink, boolean>();   // sink -> da nhan du lieu (vao giua thi cho Cluster)
  private frames = new Map<FrameSink, boolean>();   // sink -> da gap khung khoa
  private video: { track: number; codec: string; avcc: Buffer } | null = null;
  private demux = new MkvDemux((e) => this.onEvent(e));
  private stopT: NodeJS.Timeout | null = null;
  closeUpstream: (() => void) | null = null;

  constructor(private readonly open: (hub: LiveHub) => void, private readonly log: (m: string) => void) { }

  get viewers(): number { return this.raw.size + this.frames.size; }

  addRaw(s: RawSink): void {
    // Nguoi dau tien (hub chua chay): nhan tu byte 0 nhu truoc. Vao giua: phan dau + Cluster hien tai.
    const fresh = !this.closeUpstream;
    this.raw.set(s, fresh);
    if (!fresh && this.header && this.sinceAt > 0) { s.write(this.header); s.write(this.since); this.raw.set(s, true); }
    this.ensure();
  }
  removeRaw(s: RawSink): void { this.raw.delete(s); this.maybeStop(); }
  addFrames(f: FrameSink): void {
    this.frames.set(f, false);
    if (this.video) f({ kind: 'config', codec: this.video.codec, avcc: this.video.avcc });
    this.ensure();
  }
  removeFrames(f: FrameSink): void { this.frames.delete(f); this.maybeStop(); }

  /** Du lieu tu P4. */
  data(chunk: Buffer): void {
    for (const [s, joined] of this.raw) if (joined) s.write(chunk);
    this.since = this.since.length ? Buffer.concat([this.since, chunk]) : chunk;
    this.total += chunk.length;
    this.demux.push(chunk);
    // Gioi han bo nho: Cluster qua dai (khong le xay ra — av_stream cat 10 s) thi bo phan cu.
    if (this.since.length > 4 * 1024 * 1024) { this.since = this.since.subarray(this.since.length - 1024 * 1024); this.sinceAt = this.total - this.since.length; }
  }
  /** P4 dong / loi: ket thuc moi nguoi xem MKV (Frigate tu noi lai), nguoi xem khung giu lai cho lan noi sau. */
  ended(why: string): void {
    this.log(`ket thuc luong (${why})`);
    for (const s of this.raw.keys()) s.destroy();
    this.raw.clear();
    this.reset();
    if (this.frames.size) setTimeout(() => this.ensure(), 2000);
  }

  private onEvent(e: MkvEvent): void {
    if (e.kind === 'cluster') {
      if (!this.header) this.header = Buffer.from(this.since.subarray(0, e.at - this.sinceAt));
      this.since = this.since.subarray(e.at - this.sinceAt);
      this.sinceAt = e.at;
      for (const [s, joined] of this.raw) if (!joined) { s.write(this.header); s.write(this.since); this.raw.set(s, true); }
      return;
    }
    if (e.kind === 'track') {
      if (/^V_MPEG4\/ISO\/AVC/.test(e.codec) && e.priv && e.priv.length >= 4) {
        const p = e.priv;
        const codec = 'avc1.' + [p[1], p[2], p[3]].map((x) => x.toString(16).padStart(2, '0')).join('');
        this.video = { track: e.track, codec, avcc: p };
        for (const f of this.frames.keys()) f({ kind: 'config', codec, avcc: p });
      }
      return;
    }
    if (!this.video || e.track !== this.video.track) return;
    for (const [f, started] of this.frames) {
      if (!started && !e.key) continue;
      if (!started) this.frames.set(f, true);
      f({ kind: 'frame', key: e.key, ts: e.ts, data: e.data });
    }
  }

  private ensure(): void {
    if (this.stopT) { clearTimeout(this.stopT); this.stopT = null; }
    if (!this.closeUpstream && this.viewers > 0) this.open(this);
  }
  private maybeStop(): void {
    if (this.viewers > 0 || this.stopT) return;
    this.stopT = setTimeout(() => { this.stopT = null; if (this.viewers === 0) { this.closeUpstream?.(); this.reset(); } }, 3000);
  }
  private reset(): void {
    this.closeUpstream = null;
    this.header = null; this.since = Buffer.alloc(0); this.sinceAt = 0; this.total = 0;
    this.demux = new MkvDemux((e) => this.onEvent(e));
    for (const f of this.frames.keys()) this.frames.set(f, false);
  }
}
