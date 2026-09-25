// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import type { DeviceSession } from "./deviceManager.js";
import { goOsHome, requestFullFrameFor } from "./deviceManager.js";
import { EdgeGestures } from "./gestures.js";
import { TouchKind, parseFrameStats, parseOpenURLPacket, parseTouchPacket } from "./protocol.js";
import { nudgeRepaintAsync } from "./browser.js";
import { metrics } from "./metrics.js";
import { mapPointForRotation } from "./util.js";
export class InputRouter {
  private _lastMoveAt = 0;
  // (25/09/2026) Cu chi mep man hinh theo tung thiet bi (Shell: keo xuong mo thanh trang thai, vuot len ve Home OS).
  private readonly _gestures = new Map<string, EdgeGestures>();
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

    let g = this._gestures.get(dev.deviceId);
    if (!g) { g = new EdgeGestures(); this._gestures.set(dev.deviceId, g); }
    const p = mapPointForRotation(pkt.x, pkt.y, dev.cfg.width, dev.cfg.height, dev.cfg.rotation);
    for (const a of g.feed({ kind: pkt.kind, x: pkt.x, y: pkt.y }, p.x, p.y, dev.cfg.height)) {
      if (a.type === 'pass') {
        for (const ev of a.events) await this._dispatchTouchAsync(dev, ev.kind, ev.x, ev.y);
      } else if (a.type === 'shade') {
        dev.cdp.send('Runtime.evaluate', {
          expression: `window.__rwvShell && window.__rwvShell.gesture(${JSON.stringify(a.phase)}, ${Math.round(a.y)})`,
        }).catch(() => { });
      } else if (a.type === 'home') {
        goOsHome(dev);
      }
    }
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
    // (25/09/2026) KHONG gan dev.url = pkt.url o day nua. Page.frameNavigated thuong den SAU khi await
    // Page.navigate tra ve -> handleNavigation (deviceManager) thay dev.url "da bang" URL moi nen bo qua, KHONG gui
    // CurrentURL -> cam bien "URL hien tai" tren thiet bi ket o URL cu (do that: van la anh SVG luc khoi dong sau khi
    // da mo dashboard roi vnexpress). handleNavigation tu cap nhat dev.url (ca URL sau chuyen huong).
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
