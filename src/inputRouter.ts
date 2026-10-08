// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import type { DeviceSession } from "./deviceManager.js";
import { goBack, goOsHome, navigateToUrl, openRecents } from "./deviceManager.js";
import { EdgeGestures, GestureAction, TV_KEY_CODE, tvSwipeKeys } from "./gestures.js";
import { TouchKind, parseFrameStats, parseOpenURLPacket, parseTouchPacket } from "./protocol.js";
import { metrics } from "./metrics.js";
import { mapPointForRotation } from "./util.js";
export class InputRouter {
  // (26/09/2026) Chong doi Move THEO TUNG THIET BI — truoc day dung chung mot bien cho moi man hinh, nen hai panel
  // cung duoc cham thi Move cua panel nay nuot Move cua panel kia.
  private readonly _lastMoveAt = new Map<string, number>();
  // (25/09/2026) Cu chi mep man hinh theo tung thiet bi (Shell: keo xuong mo thanh trang thai, vuot len ve Home OS).
  private readonly _gestures = new Map<string, EdgeGestures>();
  /** Hen gio "giu yen" cua cu chi vuot-len-roi-giu (Gan day), moi thiet bi mot cai. */
  private readonly _holdTimers = new Map<string, NodeJS.Timeout>();
  private readonly _moveThrottleMs: number;
  /** (01/10/2026) YouTube TV: diem dat ngon / diem cuoi (toa do trang) de doi vuot thanh phim mui ten. */
  private readonly _tvTouch = new Map<string, { x0: number; y0: number; x: number; y: number }>();

  constructor(moveThrottleMs = 12) {
    this._moveThrottleMs = moveThrottleMs;
  }

  public async handleTouchPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseTouchPacket(buf);
    if (!pkt) return;

    if (pkt.kind === TouchKind.Move) {
      const now = Date.now();
      if (now - (this._lastMoveAt.get(dev.deviceId) ?? 0) < this._moveThrottleMs) return;
      this._lastMoveAt.set(dev.deviceId, now);
    }

    let g = this._gestures.get(dev.deviceId);
    if (!g) { g = new EdgeGestures(); this._gestures.set(dev.deviceId, g); }
    const p = mapPointForRotation(pkt.x, pkt.y, dev.cfg.width, dev.cfg.height, dev.cfg.rotation);
    await this._runActions(dev, g.feed({ kind: pkt.kind, x: pkt.x, y: pkt.y }, p.x, p.y, dev.cfg.height, dev.cfg.width));
    this._armHold(dev, g);
    if (pkt.kind === TouchKind.Up) this._logEdge(dev, g, pkt.x, pkt.y);
  }

  /** (08/10/2026) Ghi log moi lan cham SAT MEP (vi tri, lan di chuyen dau, ket qua) — chinh dai mep theo so lieu that
   *  (nguoi dung bao vuot mep khong tac dung). Toi da 1 dong / 300 ms moi man. */
  private readonly _edgeLogAt = new Map<string, number>();
  private _logEdge(dev: DeviceSession, g: EdgeGestures, rawX: number, rawY: number): void {
    const r = g.takeReport();
    if (!r) return;
    const now = Date.now();
    if (now - (this._edgeLogAt.get(dev.deviceId) ?? 0) < 300) return;
    this._edgeLogAt.set(dev.deviceId, now);
    const EDGE = { left: 'mep trai', right: 'mep phai', bottom: 'mep duoi', top: 'mep tren' } as const;
    const RES = { back: 'quay lai', 'back-huy': 'quay lai (huy: keo chua du)', home: 've man hinh chinh', 'home-huy': 've man hinh chinh (huy)',
      recents: 'gan day', shade: 'thanh trang thai', cham: 'cham (chuyen cho trang)', trang: 'chuyen cho trang (khong phai cu chi)' } as const;
    console.log(`[cu chi] ${dev.deviceId}: ${EDGE[r.edge]} (${r.band === 'core' ? 'dai mep' : 'dai mo rong'}) x=${r.x} y=${r.y}` +
      ` tho=${rawX},${rawY}${r.first ? ` · lan dau ${r.first.d} px/${r.first.dt} ms` : ''} -> ${RES[r.result]}`);
  }

  /** Dat lai hen gio "giu yen": khi toi han ma ngon tay van dung yen qua nguong -> g.poll() mo Gan day. */
  private _armHold(dev: DeviceSession, g: EdgeGestures): void {
    const old = this._holdTimers.get(dev.deviceId);
    if (old) { clearTimeout(old); this._holdTimers.delete(dev.deviceId); }
    const at = g.holdDeadline();
    if (at == null) return;
    this._holdTimers.set(dev.deviceId, setTimeout(() => {
      this._holdTimers.delete(dev.deviceId);
      this._runActions(dev, g.poll()).catch(() => { });
      this._armHold(dev, g);
    }, Math.max(0, at - Date.now()) + 5));
  }

  private async _runActions(dev: DeviceSession, actions: GestureAction[]): Promise<void> {
    for (const a of actions) {
      if (a.type === 'pass') {
        // (01/10/2026) Tab YouTube TV chi nghe phim (remote): van chuyen cham nhu cu (cham chon video / o tim kiem chay),
        // them: tha tay sau mot cu vuot -> phim mui ten (xem tvSwipeKeys).
        const tv = dev.tabs.get(dev.activeTabKey)?.kind === 'yttv';
        for (const ev of a.events) {
          await this._dispatchTouchAsync(dev, ev.kind, ev.x, ev.y);
          if (tv) await this._tvGesture(dev, ev.kind, ev.x, ev.y);
        }
      } else if (a.type === 'shade') {
        dev.cdp.send('Runtime.evaluate', {
          expression: `window.__rwvShell && window.__rwvShell.gesture(${JSON.stringify(a.phase)}, ${Math.round(a.y)})`,
        }).catch(() => { });
      } else if (a.type === 'home') {
        goOsHome(dev);
      } else if (a.type === 'recents') {
        openRecents(dev);
      } else if (a.type === 'homeDrag') {
        dev.cdp.send('Runtime.evaluate', {
          expression: `window.__rwvShell && window.__rwvShell.homeDrag && window.__rwvShell.homeDrag(${JSON.stringify(a.phase)}, ${Math.round(a.d)})`,
        }).catch(() => { });
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

  private async _tvGesture(dev: DeviceSession, kind: TouchKind, x: number, y: number): Promise<void> {
    const p = mapPointForRotation(x, y, dev.cfg.width, dev.cfg.height, dev.cfg.rotation);
    const id = dev.deviceId;
    if (kind === TouchKind.Down) { this._tvTouch.set(id, { x0: p.x, y0: p.y, x: p.x, y: p.y }); return; }
    const t = this._tvTouch.get(id);
    if (!t) return;
    if (kind === TouchKind.Move) { t.x = p.x; t.y = p.y; return; }
    if (kind !== TouchKind.Up) return;
    this._tvTouch.delete(id);
    for (const key of tvSwipeKeys(t.x - t.x0, t.y - t.y0)) {
      const code = TV_KEY_CODE[key];
      const ev = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      try {
        await dev.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev });
        await dev.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
      } catch (e) { console.warn(`[yttv] gui phim that bai: ${(e as Error).message}`); return; }
      await new Promise((r) => setTimeout(r, 70));  // de giao dien TV kip chuyen o (hieu ung)
    }
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
