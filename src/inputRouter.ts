// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import type { DeviceSession } from "./deviceManager.js";
import { requestFullFrameFor } from "./deviceManager.js";
import { TouchKind, parseFrameStats, parseOpenURLPacket, parseTouchPacket } from "./protocol.js";
import { nudgeRepaintAsync } from "./browser.js";
import { metrics } from "./metrics.js";
import { mapPointForRotation } from "./util.js";
export class InputRouter {
  private _lastMoveAt = 0;
  private readonly _moveThrottleMs: number;

  constructor(moveThrottleMs = 12) {
    this._moveThrottleMs = moveThrottleMs;
  }

  public async handleTouchPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseTouchPacket(buf);
    if (!pkt) return;

    if (pkt.kind === TouchKind.Move) {
      const now = Date.now();
      if (now - this._lastMoveAt < this._moveThrottleMs) return;
      this._lastMoveAt = now;
    }

    await this._dispatchTouchAsync(dev, pkt.kind, pkt.x, pkt.y);
  }

  public async handleFrameStatsPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const stats = parseFrameStats(buf);
    if (!stats) return;
    // (14/09/2026) GD2: luu lai thoi gian decode ma thiet bi vua bao -> /metrics
    metrics.onDeviceDecodeMs(dev.deviceId, stats.avgTimeMs);
    // (14/09/2026) GD3.5: heap/PSRAM thiet bi bao (chi co o firmware >= 2.4)
    if (stats.heapFree != null) metrics.onDeviceMemory(dev.deviceId, stats.heapFree, stats.psramFree ?? 0);
    dev.selfTestRunner?.setFrameRenderTimeAsync(stats.avgTimeMs, dev.cdp);
  }

  
  public async handleOpenURLPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseOpenURLPacket(buf);
    if (!pkt) return;

    if (pkt.url === "self-test") {
      await dev.selfTestRunner.startAsync(dev.deviceId, dev.cdp);
      return;
    }

    dev.selfTestRunner.stop();

    const prevUrl = dev.url ?? "";
    const sameUrl = prevUrl === pkt.url;

    if (!sameUrl) {
      // URL thay đổi → navigate bình thường
      console.log(`[inputRouter] navigate → ${pkt.url}`);
      await dev.cdp.send('Page.navigate', { url: pkt.url });
    } else {
      // URL giống nhau (ESP reboot/reconnect) → không navigate để tránh flicker,
      // nhưng PHẢI force full frame để ESP nhận lại toàn bộ nội dung hiện tại.
      // (15/09/2026) Và phải ÉP VẼ LẠI: trang tĩnh thì requestFullFrame() một mình không
      // sinh frame nào -> thiết bị kẹt ảnh cũ (màn hình trắng chỉ sáng đèn nền).
      // (23/09/2026) VẪN CHƯA ĐỦ: khung "nudge" (một <div> 2x2px, opacity 0.004
      // đổi màu) sau khi Chrome nén JPEG có xác suất cao trùng BYTE TUYỆT ĐỐI
      // với khung tĩnh trước lúc ngủ — bị flushPending() vứt bỏ ngay ở bước
      // khử trùng lặp (so hash32) TRƯỚC KHI kịp chạm tới cờ requestFullFrame().
      // Thiết bị kẹt "đèn sáng, không hiển thị gì" cho tới khi người dùng tự
      // chạm thật (đổi điểm ảnh đủ lớn để không thể trùng hash). Dùng
      // requestFullFrameFor() thay vì gọi thẳng processor: nó VÔ HIỆU HOÁ LUÔN
      // prevFrameHash nên khung kế tiếp không bao giờ bị vứt vì lý do này nữa.
      console.log(`[inputRouter] same URL reconnect, requesting full frame: ${pkt.url}`);
      await nudgeRepaintAsync(dev.cdp);
      requestFullFrameFor(dev);
    }

    dev.url = pkt.url;
  }

  private async _dispatchTouchAsync(dev: DeviceSession, kind: TouchKind, x: number, y: number): Promise<void> {
    try {
      const id = 1; // single-finger id
      const rotated = mapPointForRotation(
        x, y,
        dev.cfg.width, dev.cfg.height,
        dev.cfg.rotation
      );
      const points = [{ x: rotated.x, y: rotated.y, radiusX: 1, radiusY: 1, force: 1, id }];

      switch (kind) {
        case TouchKind.Down:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
          break;

        case TouchKind.Move:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points });
          break;

        case TouchKind.Up:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          break;

        case TouchKind.Tap:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          break;
      }
    } catch (e) {
      console.warn(`Failed to dispatch touch event: ${(e as Error).message}`);
    }
  }
}
