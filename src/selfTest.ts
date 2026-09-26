// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import { CDPSession } from "playwright-core";
import { DeviceBroadcaster } from "./broadcaster";

export class SelfTestRunner {
  private _broadcaster: DeviceBroadcaster;
  // (26/09/2026) -1 = KHONG chay self-test. Truoc day mac dinh 0 va giu 2 sau khi xong -> moi goi FrameStats (5 s/lan)
  // deu ghi log "Frame render time" va, sau mot lan self-test, tai lai trang ket qua moi 5 s.
  private _stage = -1;
  private _partial?: number;
  private _full?: number;
  private _timeoutId0?: NodeJS.Timeout;
  private _timeoutId1?: NodeJS.Timeout;
  private _timeoutId2?: NodeJS.Timeout;

  constructor(broadcaster: DeviceBroadcaster) {
    this._broadcaster = broadcaster;
  }

  public async startAsync(id: string, session: CDPSession): Promise<void> {
    if (this._timeoutId0) clearTimeout(this._timeoutId0);
    if (this._timeoutId1) clearTimeout(this._timeoutId1);
    if (this._timeoutId2) clearTimeout(this._timeoutId2);

    await session.send('Page.navigate', { url: 'file:///app/self-test/test1.html' });

    this._timeoutId0 = setTimeout(() => {
      this._stage = 0;
      console.log(`[Self test] Started for device ${id}`);
      this._broadcaster.startSelfTestMeasurement(id);
    }, 5_000);

    this._timeoutId1 = setTimeout(() => {
      this._stage = 1;
      console.log(`[Self test] Partial stage finished for device ${id}`);
      this._broadcaster.startSelfTestMeasurement(id);
    }, 70_000);

    this._timeoutId2 = setTimeout(() => {
      this._stage = 2;
      console.log(`[Self test] Full stage finished for device ${id}`);
      this._broadcaster.startSelfTestMeasurement(id);
    }, 125_000);
  }

  public async setFrameRenderTimeAsync(value: number, session: CDPSession): Promise<void> {
    if (this._stage < 0) return;
    console.log(`[Self test] Frame render time: ${value}ms`);
    switch (this._stage) {
      case 1:
        this._partial = value ?? 0;
        break;
      case 2:
        this._full = value ?? 0;
        console.log(`Self test result: partial=${this._partial}ms, full=${this._full}ms`);
        this._stage = -1;
        this._timeoutId0 = this._timeoutId1 = this._timeoutId2 = undefined;
        await session.send('Page.navigate', { url: `file:///app/self-test/test1.html?partial=${this._partial}&full=${this._full}` });
        break;
    }
  }

  public stop(): void {
    if (this._timeoutId0 || this._timeoutId1 || this._timeoutId2)
      console.log(`[Self test] Stopped`);
    
    if (this._timeoutId0) clearTimeout(this._timeoutId0);
    if (this._timeoutId1) clearTimeout(this._timeoutId1);
    if (this._timeoutId2) clearTimeout(this._timeoutId2);
    this._timeoutId0 = undefined;
    this._timeoutId1 = undefined;
    this._timeoutId2 = undefined;
    this._stage = -1;
  }
}