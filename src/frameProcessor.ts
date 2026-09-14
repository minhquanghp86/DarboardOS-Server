import os from "node:os";
import sharp from "sharp";
import { Encoding, FRAME_HEADER_BYTES, TILE_HEADER_BYTES } from "./protocol.js";
import { hash32 } from "./util.js";
import type { FrameProcessorStats } from "./metrics.js";

sharp.concurrency(Math.max(1, os.cpus().length - 1));

export type RGBA = { data: Buffer; width: number; height: number };

export type Rect = { x: number; y: number; w: number; h: number; data: Buffer };

export type FrameOut = {
  rects: Rect[];
  isFullFrame: boolean;
  encoding: Encoding;
};

export type FrameProcessorCfg = {
  tileSize: number;
  fullframeTileCount: number;
  fullframeAreaThreshold: number;
  jpegQuality: number;
  fullFrameEvery: number;
  maxBytesPerMessage: number;
};

export class FrameProcessor {
  // Thống kê để đẩy ra /metrics (GĐ0)
  public readonly stats: FrameProcessorStats = {
    frames: 0,
    rects: 0,
    bytes: 0,
    encodeMs: 0,
    qualityFallbacks: 0,
    splits: 0,
    droppedRects: 0,
    oversizeDropped: 0,
    wholeFrameHits: 0,
  };

  private _cfg: FrameProcessorCfg;
  private _cols = 0;
  private _rows = 0;
  private _prev?: Uint32Array;
  private _iter = 0;
  private _fullFrameRequested = false;

  constructor(cfg: FrameProcessorCfg) {
    this._cfg = cfg;
  }

  // (14/09/2026) GĐ3: bộ điều khiển thích nghi chỉnh được chất lượng khi đang chạy
  public setTuning(t: { jpegQuality?: number }): void {
    if (t.jpegQuality !== undefined) {
      this._cfg.jpegQuality = Math.max(1, Math.min(100, Math.round(t.jpegQuality)));
    }
  }

  public get tuning(): { jpegQuality: number } {
    return { jpegQuality: this._cfg.jpegQuality };
  }

  public requestFullFrame(): void {
    this._iter = 0;
    this._fullFrameRequested = true;
  }

  public async processFrameAsync(rgba: RGBA): Promise<FrameOut> {
    if (!this._prev) this._initGrid(rgba.width, rgba.height);
    const t0 = Date.now();

    let forceFull = (this._iter % this._cfg.fullFrameEvery) === 0;
    if (this._fullFrameRequested) {
      forceFull = true;
      this._fullFrameRequested = false;
    }
    const chosenEncoding: Encoding = Encoding.JPEG;

    type TileInfo = { x: number; y: number; w: number; h: number; idx: number; h32: number; changed: boolean };
    const tiles: TileInfo[] = [];
    let changedArea = 0;

    for (let ty = 0; ty < this._rows; ty++) {
      for (let tx = 0; tx < this._cols; tx++) {
        const x = tx * this._cfg.tileSize;
        const y = ty * this._cfg.tileSize;
        const w = Math.min(this._cfg.tileSize, rgba.width - x);
        const h = Math.min(this._cfg.tileSize, rgba.height - y);

        const raw = this._extractRaw(rgba, x, y, w, h);
        const h32 = hash32(raw);
        const idx = ty * this._cols + tx;
        const prev = this._prev![idx];
        const changed = forceFull || (prev !== h32);

        tiles.push({ x, y, w, h, idx, h32, changed });
        if (changed) changedArea += w * h;
      }
    }

    const totalArea = rgba.width * rgba.height;
    const changedPct = totalArea > 0 ? (changedArea / totalArea) : 0;
    const doFull = forceFull || (changedPct > this._cfg.fullframeAreaThreshold);

    let out: FrameOut;
    if (doFull) {
      out = await this._processFullFrame(rgba, tiles, chosenEncoding);
    } else {
      out = await this._processPartialFrame(rgba, tiles, chosenEncoding);
    }

    // (14/09/2026) LƯỚI AN TOÀN CUỐI: KHÔNG gửi khối đỏ nữa.
    // Rect nào vẫn vượt cap (đáng ra không xảy ra vì _encodeRectFitting đã hạ quality
    // hoặc chia nhỏ) thì BỎ QUA - vùng đó giữ nội dung cũ trên màn hình tới lần
    // full-frame kế tiếp - và đếm lại để theo dõi qua /metrics.
    const capBytes = this._cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
    out.rects = out.rects.filter((r) => {
      if (r.data.length <= capBytes) return true;
      this.stats.oversizeDropped++;
      console.warn(`[frame] bỏ rect ${r.w}x${r.h} vì vượt cap (${r.data.length} > ${capBytes})`);
      return false;
    });

    this.stats.frames++;
    this.stats.rects += out.rects.length;
    this.stats.bytes += out.rects.reduce((a, r) => a + r.data.length, 0);
    this.stats.encodeMs += Date.now() - t0;

    this._iter++;
    return out;
  }

  private async _processFullFrame(
    rgba: RGBA,
    tilesInfo: { idx: number; h32: number }[],
    encoding: Encoding
  ): Promise<FrameOut> {
    const cap = this._cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;

    // (14/09/2026) GD2: thử gửi CẢ KHUNG trong MỘT ảnh JPEG -> thiết bị chỉ phải decode
    // 1 lần thay vì N mảnh (decode là chi phí lớn nhất trên ESP32-S3). Hạ quality dần
    // cho vừa cap; nếu vẫn không vừa thì quay về cách chia mảnh như trước.
    const rawWhole = this._extractRaw(rgba, 0, 0, rgba.width, rgba.height);
    for (const factor of [1, 0.75, 0.55, 0.35]) {
      const q = Math.max(20, Math.round(this._cfg.jpegQuality * factor));
      const data = await this._encodeWithQuality(rawWhole, rgba.width, rgba.height, encoding, q);
      if (data.length <= cap) {
        if (factor < 1) this.stats.qualityFallbacks++;
        this.stats.wholeFrameHits++;
        for (const t of tilesInfo) this._prev![t.idx] = t.h32;
        return { rects: [{ x: 0, y: 0, w: rgba.width, h: rgba.height, data }], isFullFrame: true, encoding };
      }
    }

    const rectsForFull = this._splitWholeFrame(rgba.width, rgba.height, this._cfg.fullframeTileCount);
    const rects: Rect[] = [];
    for (const r of rectsForFull) {
      rects.push(...await this._encodeRectFitting(rgba, r.x, r.y, r.w, r.h, encoding, cap));
    }

    for (const t of tilesInfo) this._prev![t.idx] = t.h32;

    return { rects, isFullFrame: true, encoding };
  }

  private async _processPartialFrame(
    rgba: RGBA,
    tiles: { x: number; y: number; w: number; h: number; idx: number; h32: number; changed: boolean }[],
    encoding: Encoding
  ): Promise<FrameOut> {
    const mergedRects = this._mergeChangedTiles(tiles, rgba.width, rgba.height);

    const cap = this._cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
    const out: Rect[] = [];
    for (const r of mergedRects) {
      out.push(...await this._encodeRectFitting(rgba, r.x, r.y, r.w, r.h, encoding, cap));
    }
    for (const t of tiles) if (t.changed) this._prev![t.idx] = t.h32;

    return { rects: out, isFullFrame: false, encoding };
  }

  private _splitWholeFrame(w: number, h: number, n: number): { x: number; y: number; w: number; h: number }[] {
    if (n <= 1) return [{ x: 0, y: 0, w, h }];

    if (n === 2) {
      const h1 = Math.floor(h / 2);
      const h2 = h - h1;
      return [
        { x: 0, y: 0, w, h: h1 },
        { x: 0, y: h1, w, h: h2 },
      ];
    }

    let rows = Math.floor(Math.sqrt(n));
    while (rows > 1 && (n % rows !== 0)) rows--;
    const cols = Math.floor(n / rows);

    const split = (size: number, parts: number): number[] => {
      const out: number[] = [];
      let prev = 0;
      for (let i = 1; i <= parts; i++) {
        const cur = Math.floor((i * size) / parts);
        out.push(cur - prev);
        prev = cur;
      }
      return out;
    };

    const widths = split(w, cols);
    const heights = split(h, rows);

    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let yAcc = 0;
    for (let r = 0; r < rows; r++) {
      let xAcc = 0;
      for (let c = 0; c < cols; c++) {
        rects.push({ x: xAcc, y: yAcc, w: widths[c], h: heights[r] });
        xAcc += widths[c];
      }
      yAcc += heights[r];
    }
    return rects;
  }

  private _getMaxFullTileSize(frameW: number, frameH: number): { maxW: number; maxH: number } {
    const fullRects = this._splitWholeFrame(frameW, frameH, this._cfg.fullframeTileCount);
    let maxW = 0, maxH = 0;
    for (const r of fullRects) {
      if (r.w > maxW) maxW = r.w;
      if (r.h > maxH) maxH = r.h;
    }
    return { maxW, maxH };
  }

  private _calcGridSplits(frameW: number, frameH: number) {
    const cols = this._cols, rows = this._rows, ts = this._cfg.tileSize;
    const widths: number[] = new Array(cols);
    const heights: number[] = new Array(rows);
    const xOffsets: number[] = new Array(cols);
    const yOffsets: number[] = new Array(rows);

    let x = 0;
    for (let c = 0; c < cols; c++) {
      const w = Math.min(ts, frameW - x);
      widths[c] = w;
      xOffsets[c] = x;
      x += w;
    }
    let y = 0;
    for (let r = 0; r < rows; r++) {
      const h = Math.min(ts, frameH - y);
      heights[r] = h;
      yOffsets[r] = y;
      y += h;
    }
    return { widths, heights, xOffsets, yOffsets };
  }

  private _mergeChangedTiles(
    tiles: { x: number; y: number; w: number; h: number; idx: number; h32: number; changed: boolean }[],
    frameW: number,
    frameH: number
  ): { x: number; y: number; w: number; h: number }[] {
    const cols = this._cols, rows = this._rows;
    const changed: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
    const visited: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

    for (let i = 0; i < tiles.length; i++) {
      const ty = Math.floor(i / cols);
      const tx = i % cols;
      changed[ty][tx] = tiles[i].changed;
    }

    const { widths, heights, xOffsets, yOffsets } = this._calcGridSplits(frameW, frameH);
    const { maxW, maxH } = this._getMaxFullTileSize(frameW, frameH);

    const rects: { x: number; y: number; w: number; h: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!changed[r][c] || visited[r][c]) continue;

        // grow horizontally
        let wTiles = 0, pxW = 0;
        while (c + wTiles < cols && changed[r][c + wTiles] && !visited[r][c + wTiles]) {
          const nextW = pxW + widths[c + wTiles];
          if (nextW > maxW) break;
          pxW = nextW;
          wTiles++;
        }

        // grow vertically
        let hTiles = 1, pxH = heights[r];
        let canGrow = true;
        while (canGrow && (r + hTiles) < rows) {
          const nextH = pxH + heights[r + hTiles];
          if (nextH > maxH) break;
          for (let cc = c; cc < c + wTiles; cc++) {
            if (!changed[r + hTiles][cc] || visited[r + hTiles][cc]) { canGrow = false; break; }
          }
          if (!canGrow) break;
          pxH = nextH;
          hTiles++;
        }

        rects.push({ x: xOffsets[c], y: yOffsets[r], w: pxW, h: pxH });

        for (let rr = r; rr < r + hTiles; rr++) {
          for (let cc = c; cc < c + wTiles; cc++) {
            visited[rr][cc] = true;
          }
        }
      }
    }

    return rects;
  }

  private _initGrid(w: number, h: number) {
    this._cols = Math.ceil(w / this._cfg.tileSize);
    this._rows = Math.ceil(h / this._cfg.tileSize);
    this._prev = new Uint32Array(this._cols * this._rows);
  }

  private _extractRaw(rgba: RGBA, x: number, y: number, w: number, h: number): Buffer {
    const out = Buffer.allocUnsafe(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      const src = ((y + yy) * rgba.width + x) * 4;
      rgba.data.copy(out, yy * w * 4, src, src + w * 4);
    }
    return out;
  }

  // (14/09/2026) Encode 1 vùng sao cho VỪA cap bytes - thay cho việc gửi khối ĐỎ.
  // 1) thử quality cấu hình rồi hạ dần (×0.75 → ×0.55 → ×0.35, sàn 20)
  // 2) vẫn quá lớn → chia 2×2 và đệ quy (mỗi mảnh vẽ đúng x/y/w/h, KHÔNG cần đổi
  //    giao thức v1 vì thiết bị chỉ vẽ từng rect theo toạ độ của nó)
  // 3) cùng đường → bỏ qua rect (trả rỗng), tuyệt đối không gửi khối đỏ
  private async _encodeRectFitting(
    rgba: RGBA,
    x: number,
    y: number,
    w: number,
    h: number,
    enc: Encoding,
    cap: number,
    depth = 0
  ): Promise<Rect[]> {
    const raw = this._extractRaw(rgba, x, y, w, h);
    for (const factor of [1, 0.75, 0.55, 0.35]) {
      const q = Math.max(20, Math.round(this._cfg.jpegQuality * factor));
      const data = await this._encodeWithQuality(raw, w, h, enc, q);
      if (data.length <= cap) {
        if (factor < 1) this.stats.qualityFallbacks++;
        return [{ x, y, w, h, data }];
      }
    }

    if (depth < 3 && w >= 32 && h >= 32) {
      this.stats.splits++;
      const w1 = Math.floor(w / 2);
      const h1 = Math.floor(h / 2);
      const parts: [number, number, number, number][] = [
        [x, y, w1, h1],
        [x + w1, y, w - w1, h1],
        [x, y + h1, w1, h - h1],
        [x + w1, y + h1, w - w1, h - h1],
      ];
      const out: Rect[] = [];
      for (const [px, py, pw, ph] of parts) {
        if (pw <= 0 || ph <= 0) continue;
        out.push(...await this._encodeRectFitting(rgba, px, py, pw, ph, enc, cap, depth + 1));
      }
      return out;
    }

    this.stats.droppedRects++;
    console.warn(`[frame] bỏ qua rect ${w}x${h} (không thể nén vừa ${cap} bytes)`);
    return [];
  }

  private async _encodeWithQuality(rawRgba: Buffer, w: number, h: number, enc: Encoding, quality: number): Promise<Buffer> {
    if (enc === Encoding.RAW565) return this._encodeRAW565(rawRgba);
    return sharp(rawRgba, { raw: { width: w, height: h, channels: 4 } })
      .jpeg({ quality, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
  }

  private async _encode(rawRgba: Buffer, w: number, h: number, enc: Encoding): Promise<Buffer> {
    switch (enc) {
      case Encoding.JPEG:
        return this._encodeWithQuality(rawRgba, w, h, enc, this._cfg.jpegQuality);
      case Encoding.RAW565:
        return this._encodeRAW565(rawRgba);
      default:
        return this._encodeJPEG(rawRgba, w, h);
    }
  }

  private async _encodeJPEG(rawRgba: Buffer, w: number, h: number): Promise<Buffer> {
    return sharp(rawRgba, { raw: { width: w, height: h, channels: 4 } })
      .jpeg({ quality: this._cfg.jpegQuality, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
  }

  private _encodeRAW565(rawRgba: Buffer): Buffer {
    const pxCount = rawRgba.length >> 2;
    const out = Buffer.allocUnsafe(pxCount * 2);
    for (let i = 0, j = 0; i < pxCount; i++, j += 4) {
      const r = rawRgba[j];
      const g = rawRgba[j + 1];
      const b = rawRgba[j + 2];
      const v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
      out[i * 2] = v & 0xFF;
      out[i * 2 + 1] = (v >> 8) & 0xFF;
    }
    return out;
  }

  private async _makeRedFrameAsync(w: number, h: number, enc: Encoding): Promise<Buffer> {
    const raw = Buffer.allocUnsafe(w * h * 4);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const RGBA_RED = 0xFF0000FF; // bytes: FF 00 00 FF
    for (let o = 0; o < raw.length; o += 4) view.setUint32(o, RGBA_RED, true);
    return this._encode(raw, w, h, enc);
  }
}
