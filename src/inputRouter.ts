// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import type { DeviceSession } from "./deviceManager.js";
import { goBack, goOsHome, navigateToUrl } from "./deviceManager.js";
import { EdgeGestures } from "./gestures.js";
import { TouchKind, parseFrameStats, parseOpenURLPacket, parseTouchPacket } from "./protocol.js";
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
    for (const a of g.feed({ kind: pkt.kind, x: pkt.x, y: pkt.y }, p.x, p.y, dev.cfg.height, dev.cfg.width)) {
      if (a.type === 'pass') {
        for (const ev of a.events) await this._dispatchTouchAsync(dev, ev.kind, ev.x, ev.y);
      } else if (a.type === 'shade') {
        dev.cdp.send('Runtime.evaluate', {
          expression: `window.__rwvShell && window.__rwvShell.gesture(${JSON.stringify(a.phase)}, ${Math.round(a.y)})`,
        }).catch(() => { });
      } else if (a.type === 'home') {
        goOsHome(dev);
      } else if (a.type === 'back') {
        // (26/09/2026 OS-3) Bong bong mui ten theo ngon tay (Shell), tha qua nguong -> Quay lai.
        dev.cdp.send('Runtime.evaluate', {
          expression: `window.__rwvShell && window.__rwvShell.back && window.__rwvShell.back(${JSON.stringify(a.phase)}, ${JSON.stringify(a.side)}, ${Math.round(a.d)}, ${Math.round(a.y)}, ${!!a.commit})`,
        }).catch(() => { });
        if (a.phase === 'end' && a.commit) goBack(dev);
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

    // (26/09/2026 OS-2) DINH TUYEN THEO TAB — thay vi navigate thang tab dang active: "Go Home" va "URL hien thi"
    // deu di qua CUNG mot goi tin nay o tang firmware (khong the phan biet — xem docs/KE-HOACH-GIAO-DIEN-HE-
    // DIEU-HANH.md muc 4), nen server tu phan loai theo GOC cua URL: cung goc Home URL -> tab 'home' (ghim, "Go
    // Home" luon dua no VE DUNG home_url ke ca dang o trang con khac); khac goc -> tab 'browser'. Xu ly "URL
    // giong nhau" / nudge / requestFullFrame nam trong navigateToUrl() (deviceManager.ts), dung chung voi duong
    // nguoi dung tu nhap URL o Shell.
    console.log(`[inputRouter] OpenURL → ${pkt.url}`);
    await navigateToUrl(dev, pkt.url);
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
