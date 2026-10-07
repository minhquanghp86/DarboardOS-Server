// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import { WebSocket } from "ws";
import { buildFrameStatsPacket, buildFramePackets, buildCurrentURLPacket, buildSetDisplayURLPacket, buildAudioFramePacket, buildDeviceControlPacket, ControlField, FLAG_HALF_SCALE } from "./protocol.js";
import type { FrameOut } from "./frameProcessor.js";
import { metrics } from "./metrics.js";
import { kernelTxQueue } from "./kernelQueue.js";
import { tuning } from "./tuning.js";

type OutFrame = { frameId: number; packets: Buffer[] };
type BroadcasterState = { queue: OutFrame[]; sending: boolean };

// (02/10/2026) Su co P4 dung 12:40: thiet bi ngung DOC WebSocket, am thanh (gui vo dieu kien) don 17 MB trong RAM Node
// va khong ai cat socket chet. Hai chot chan:
//  - am thanh bi bo khi socket ton dong qua AUDIO_HIGH_WATER (512 KB: khung video 196 KB van lot, chi cat ca nang that su; am thanh cu vo nghia);
//  - socket co byte ton dong nhung 0 byte roi khoi server trong STALL_MS -> terminate de thiet bi noi lai.
const AUDIO_HIGH_WATER = parseInt(process.env.CCR_WS_AUDIO_HIGH_WATER ?? "", 10) || 524_288;
const STALL_MS = parseInt(process.env.CCR_WS_STALL_MS ?? "", 10) || 30_000;
const STALL_CHECK_MS = 5_000;

export type StallTrack = { drained: number; since: number };

/** Socket "chet doc": con byte ton dong ma luong byte da roi khoi server khong tang trong `stallMs`. */
export function trackStall(prev: StallTrack | undefined, sent: number, backlog: number, now: number, stallMs: number):
  { track: StallTrack; stalled: boolean } {
  const drained = sent - backlog;
  if (!prev || backlog <= 0 || drained > prev.drained) return { track: { drained, since: now }, stalled: false };
  return { track: prev, stalled: now - prev.since >= stallMs };
}

export class DeviceBroadcaster {
  private _clients = new Map<string, Set<WebSocket>>();
  private _state = new Map<string, BroadcasterState>();
  // (24/09/2026) Tong byte DA GIAO cho tung socket. Tru di bufferedAmount ra so byte
  // da THUC SU roi khoi server — dung de uoc luong bang thong that cua duong truyen.
  private _sentBytes = new WeakMap<WebSocket, number>();
  private _stall = new WeakMap<WebSocket, StallTrack>();

  constructor() {
    const t = setInterval(() => this._checkStalls(), STALL_CHECK_MS);
    t.unref?.();
  }

  private _checkStalls(): void {
    const now = Date.now();
    for (const [id, peers] of this._clients) {
      for (const ws of peers) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const backlog = ws.bufferedAmount;
        const r = trackStall(this._stall.get(ws), this._sentBytes.get(ws) ?? 0, backlog, now, STALL_MS);
        this._stall.set(ws, r.track);
        if (r.stalled) {
          console.warn(`[broadcaster] ${id}: socket ket ${Math.round((now - r.track.since) / 1000)} s (ton dong ${backlog}B, 0 byte roi server) -> ngat de thiet bi noi lai`);
          this._stall.delete(ws);
          try { ws.terminate(); } catch {}
        }
      }
    }
  }

  private _send(ws: WebSocket, buf: Buffer): void {
    ws.send(buf, { binary: true });
    this._sentBytes.set(ws, (this._sentBytes.get(ws) ?? 0) + buf.length);
  }

  addClient(id: string, ws: WebSocket): void {
    const old = this._clients.get(id);
    if (old && old.size) {
      for (const sock of old) {
        try { sock.close(); } catch {}
      }
      old.clear();
    }

    if (!this._clients.has(id)) this._clients.set(id, new Set());
    this._clients.get(id)!.add(ws);

    if (!this._state.has(id)) this._state.set(id, { queue: [], sending: false });

    const nClients = this._clients.get(id)?.size ?? 0;
    console.log(`[broadcaster] Client connected to device ${id}, total clients: ${nClients}`);
    metrics.setClientCount(id, nClients);
    ws.once("close", () => this.removeClient(id, ws));
    // (14/09/2026) SỬA LỖI: lỗi tạm thời (error) KHÔNG có nghĩa là đã ngắt.
    // Trước đây chỉ cần 1 sự kiện 'error' là socket bị loại khỏi danh sách phát
    // -> panel không nhận frame nữa (đứng hình) dù TCP vẫn ESTABLISHED, và
    // /metrics báo clients=0. Nay chỉ loại khi socket thực sự không còn OPEN.
    ws.once("error", () => {
      if (ws.readyState !== WebSocket.OPEN) this.removeClient(id, ws);
    });
  }

  removeClient(id: string, ws: WebSocket): void {
    this._clients.get(id)?.delete(ws);
    if ((this._clients.get(id)?.size ?? 0) === 0) {
      this._clients.delete(id);
      this._state.delete(id);
    }
    console.log(`[broadcaster] Client disconnected from device ${id}, total clients: ${this._clients.get(id)?.size ?? 0}`);
    metrics.setClientCount(id, this._clients.get(id)?.size ?? 0);
  }

  getClientCount(id: string): number {
    return this._clients.get(id)?.size ?? 0;
  }

  // (17/09/2026) ÁP LỰC NGƯỢC: số byte đang kẹt trong bộ đệm gửi của socket.
  //
  // Trước đây server gửi vô điều kiện. Thư viện `ws` của Node đệm KHÔNG GIỚI HẠN
  // trong RAM khi phía nhận chậm, nên khi thiết bị không giải mã kịp thì server
  // vẫn dồn tiếp — thiết bị càng ngộp. Đo thật trên ESP32-P4 với tab 5 thẻ
  // camera: 1720 gói bị thiết bị vứt vì hàng đợi đầy, chỉ 1 khung được vẽ trọn
  // trong 200 giây.
  //
  // `bufferedAmount` là tín hiệu quá tải ĐÁNG TIN NHẤT vì nó không phụ thuộc
  // vào việc thiết bị có báo số liệu về được hay không — mà đúng lúc quá tải
  // thì gói FrameStats cũng chính là thứ không lọt.
  //
  // (07/10/2026, 2.9.108) Cong them hang doi gui cua KERNEL (xem kernelQueue.ts): do that P4 phat YouTube, kernel giu toi
  // 374 KB ma bufferedAmount khong thay -> bo khung / gian nhip phan ung qua muon, tieng xep sau va bi dut. Tat bang
  // "kernelBacklog": false trong /data/rwv-tuning.json.
  private _backlog(ws: WebSocket): number {
    let b = ws.bufferedAmount;
    if (tuning().kernelBacklog !== false) {
      const s = (ws as unknown as { _socket?: { remoteAddress?: string; remotePort?: number; localPort?: number } })._socket;
      if (s) b += kernelTxQueue(s.remoteAddress, s.remotePort, s.localPort);
    }
    return b;
  }

  backlogBytes(id: string): number {
    const peers = this._clients.get(id);
    if (!peers) return 0;
    let max = 0;
    for (const ws of peers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const b = this._backlog(ws);
      if (b > max) max = b;
    }
    return max;
  }

  // (24/09/2026) Bo dem cho uoc luong bang thong: tong byte da giao va byte con ket, cua
  // socket da giao nhieu nhat (thuc te moi thiet bi mot client). null = chua co client.
  linkCounters(id: string): { sent: number; backlog: number } | null {
    const peers = this._clients.get(id);
    if (!peers) return null;
    let best: { sent: number; backlog: number } | null = null;
    for (const ws of peers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const sent = this._sentBytes.get(ws) ?? 0;
      if (!best || sent > best.sent) best = { sent, backlog: this._backlog(ws) };
    }
    return best;
  }

  public sendFrameChunked(id: string, data: FrameOut, frameId: number, maxBytes = 12_000): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0 || data.rects.length === 0) return;

    const packets = buildFramePackets(data.rects, data.encoding, frameId, data.isFullFrame, maxBytes,
      data.halfScale ? FLAG_HALF_SCALE : 0);

    const st = this._ensureState(id);
    st.queue.push({ frameId, packets });
    this._drainAsync(id).catch(() => {});
  }

  // (14/09/2026) GD2: ten chung cho viec "xin thiet bi bao so lieu decode" (dung ca cho self-test)
  public requestFrameStats(id: string): void {
    this.startSelfTestMeasurement(id);
  }

  // (23/09/2026) Goi XIN SO LIEU gui THANG, khong qua hang doi khung hinh.
  //
  // Nghich ly da do duoc tren addon 2.9.18: P4 chay 571 giay, server hoi so
  // lieu ~57 lan (10 giay/lan), nhung /metrics bao decodeSamples = 1. Tuc vong
  // dieu khien thich nghi da lai NHIP 200ms -> 50ms dua tren DUY NHAT mot mau
  // 13ms do tu 9 phut truoc — no dang bay mu.
  //
  // Ly do: goi nay truoc day xep SAU ca hang doi khung hinh. Dung luc thiet bi
  // ngop (chinh luc can do nhat) thi hang doi dai nhat, nen goi do hoac den
  // muon hang chuc giay hoac khong den. Dung bang chung nguoc voi y do: bien
  // dung de PHAT HIEN nghen lai bi chinh su nghen do lam cam.
  //
  // Goi chi 8 byte — gui thang khong lam nang them ap luc mang that su.
  public startSelfTestMeasurement(id: string): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return;

    const packet = buildFrameStatsPacket();
    for (const ws of peers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try { this._send(ws, packet); } catch { }
    }
  }

  /**
   * (18/09/2026) Bao cho thiet bi biet URL dang hien thi THUC TE.
   * Goi moi khi Chromium dieu huong — ke ca dieu huong trong cung trang (SPA),
   * vi dashboard Home Assistant chuyen tab bang history.pushState chu khong
   * tai lai trang.
   */
  public sendCurrentURL(id: string, url: string): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return;

    const st = this._ensureState(id);
    st.queue.push({ frameId: -1, packets: [buildCurrentURLPacket(url)] });
    this._drainAsync(id).catch(() => {});
  }

  /** (25/09/2026) Nguoi dung nhap URL o nut mo rong -> thiet bi dat "URL hien thi" (xem MsgType.SetDisplayURL). */
  public sendSetDisplayURL(id: string, url: string): boolean {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return false;
    const st = this._ensureState(id);
    st.queue.push({ frameId: -1, packets: [buildSetDisplayURLPacket(url)] });
    this._drainAsync(id).catch(() => {});
    return true;
  }

  // (23/09/2026) Am thanh gui THANG, KHONG qua hang doi/_drainAsync nhu
  // video. Ly do: hang doi video co the ket dong (backpressure that su khi
  // thiet bi giai ma khong kip — dung tinh nang da co san), va am thanh xep
  // sau mot backlog video lon se bi giat/tre ro ret hon nhieu so voi anh bi
  // giat — tai lieu deu la goi PCM nho (~640-1280 byte/20-40ms), khong dang
  // ke so voi kich thuoc khung anh, nen gui thang khong lam nang them tac
  // dong nghen mang thuc su.
  public sendAudioFrame(id: string, pcm: Buffer): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return;
    const pkt = buildAudioFramePacket(pcm);
    for (const ws of peers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > AUDIO_HIGH_WATER) continue;
      try { this._send(ws, pkt); } catch { }
    }
  }

  /** (25/09/2026) Thanh truot trong menu -> thiet bi. Gui THANG (4 byte), khong xep sau hang doi khung hinh. */
  public sendDeviceControl(id: string, field: ControlField, value: number): boolean {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return false;
    const pkt = buildDeviceControlPacket(field, value);
    let sent = false;
    for (const ws of peers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try { this._send(ws, pkt); sent = true; } catch { }
    }
    return sent;
  }

  private _ensureState(id: string): BroadcasterState {
    let st = this._state.get(id);
    if (!st) {
      st = { queue: [], sending: false };
      this._state.set(id, st);
    }
    return st;
  }

  private async _drainAsync(id: string): Promise<void> {
    const st = this._ensureState(id);
    if (st.sending) return;
    st.sending = true;

    try {
      const peers = this._clients.get(id);
      if (!peers || peers.size === 0) { st.queue.length = 0; return; }

      while (st.queue.length) {
        const f = st.queue.shift()!;
        for (const pkt of f.packets) {
          let sentOnce = false;
          for (const ws of new Set(peers)) {
            if (ws.readyState !== WebSocket.OPEN) {
              peers.delete(ws);
              continue;
            }
            try {
              this._send(ws, pkt);
              sentOnce = true;
            } catch {
              try { ws.close(); } catch {}
              peers.delete(ws);
            }
          }
          if (sentOnce) metrics.onPacket(id, pkt.length);
          if (peers.size === 0) { st.queue.length = 0; return; }
          await Promise.resolve();
        }
      }
    } finally {
      st.sending = false;
    }
  }
}
