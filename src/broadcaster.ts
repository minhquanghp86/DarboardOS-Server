// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import { WebSocket } from "ws";
import { buildFrameStatsPacket, buildFramePackets, buildCurrentURLPacket, buildAudioFramePacket } from "./protocol.js";
import type { FrameOut } from "./frameProcessor.js";
import { metrics } from "./metrics.js";

type OutFrame = { frameId: number; packets: Buffer[] };
type BroadcasterState = { queue: OutFrame[]; sending: boolean };

export class DeviceBroadcaster {
  private _clients = new Map<string, Set<WebSocket>>();
  private _state = new Map<string, BroadcasterState>();

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
  backlogBytes(id: string): number {
    const peers = this._clients.get(id);
    if (!peers) return 0;
    let max = 0;
    for (const ws of peers) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > max) max = ws.bufferedAmount;
    }
    return max;
  }

  public sendFrameChunked(id: string, data: FrameOut, frameId: number, maxBytes = 12_000): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0 || data.rects.length === 0) return;

    const packets = buildFramePackets(data.rects, data.encoding, frameId, data.isFullFrame, maxBytes);

    const st = this._ensureState(id);
    st.queue.push({ frameId, packets });
    this._drainAsync(id).catch(() => {});
  }

  // (14/09/2026) GD2: ten chung cho viec "xin thiet bi bao so lieu decode" (dung ca cho self-test)
  public requestFrameStats(id: string): void {
    this.startSelfTestMeasurement(id);
  }

  public startSelfTestMeasurement(id: string): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return;

    const packet = buildFrameStatsPacket();
    const st = this._ensureState(id);
    st.queue.push({ frameId: 42, packets: [packet] });
    this._drainAsync(id).catch(() => {});
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
      try { ws.send(pkt, { binary: true }); } catch { }
    }
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
              ws.send(pkt, { binary: true });
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
