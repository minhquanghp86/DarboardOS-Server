// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import env from "env-var";
import { mkdir } from 'fs/promises';
import { chromium } from 'playwright-core';
import { initCdpRootAsync, waitForCdpReadyAsync } from './cdpRoot.js';

const DEBUG_PORT = +(process.env.DEBUG_PORT || 9221);
const PREFERS_REDUCED_MOTION = /^(1|true|yes|on)$/i.test(process.env.PREFERS_REDUCED_MOTION ?? '');
const USER_DATA_DIR = process.env.USER_DATA_DIR || (process.platform === 'win32'
  ? 'C:\\Temp\\remotewebview-profile'
  : '/var/temp/remotewebview-profile');
const BROWSER_LOCALE = env.get("BROWSER_LOCALE").default("en-US").asString();

const CHROME_EXECUTABLE =
  process.env.CHROME_EXECUTABLE ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome-stable');

async function fetchJsonVersionAsync(): Promise<{ webSocketDebuggerUrl: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function startHeadlessIfNeededAsync(): Promise<void> {
  const info = await fetchJsonVersionAsync();
  if (info?.webSocketDebuggerUrl) return;

  await mkdir(USER_DATA_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    '--headless=new',
    '--enable-features=VaapiVideoDecoder',
    '--disable-features=UseChromeOSDirectVideoDecoder',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // (23/09/2026) Giam dau hieu tu dong hoa ro nhat: mac dinh Chrome dat
    // navigator.webdriver = true khi bi dieu khien qua CDP (xac nhan bang
    // Runtime.evaluate truc tiep), day la tin hieu DAU TIEN cac trang chong
    // bot (vd dang nhap Google/YouTube) kiem tra. Co KHONG the loai bo hoan
    // toan (kien truc du an dua hoan toan vao CDP — Page.startScreencast,
    // Input.dispatch*Event...), nhung co nay giam duoc mot lop phat hien ro
    // rang. KHONG bao dam het bi chan — Google con nhieu tin hieu khac
    // (Client Hints, WebGL fingerprint, risk-scoring server-side theo thiet
    // bi/vi tri moi la...) ma mot addon tu luu trai khong the gia mao het.
    '--disable-blink-features=AutomationControlled',
    // (23/09/2026 v9) NGUYEN NHAN GOC cua "video chay nhung khong co tieng":
    // YouTube bi chan autoplay khi khong co cu cham duoc tinh la user gesture
    // (do that: play() nem NotAllowedError) — trinh phat YouTube xu ly loi do
    // bang cach TU PHAT LAI O CHE DO MUTED. Ket qua: hinh chay binh thuong
    // nhung khong bao gio co am thanh. Cho phep autoplay khong can cu cham
    // de trinh phat khong phai lui ve che do muted.
    '--autoplay-policy=no-user-gesture-required',
    ...(PREFERS_REDUCED_MOTION ? ['--force-prefers-reduced-motion'] : []),
  ];

  console.log(`[browser] Launching Chrome: ${CHROME_EXECUTABLE}`);
  if (PREFERS_REDUCED_MOTION)
    console.log('[browser] prefers-reduced-motion enabled');

  await chromium.launchPersistentContext(USER_DATA_DIR, {
    executablePath: CHROME_EXECUTABLE,
    headless: true,
    locale: BROWSER_LOCALE,
    args,
    // (23/09/2026 v9) NGUYEN NHAN GOC THU HAI, va la cai chan tuyet doi:
    // Playwright TU DONG them "--mute-audio" vao tham so mac dinh cua Chrome.
    // Da xac minh bang chinh dong lenh that cua tien trinh Chrome dang chay
    // (ps aux). Hau qua do duoc: PulseAudio bao sink RUNNING, sink-input cua
    // Chrome "Corked: no / Mute: no / Volume 100%" — nhin dau cung binh
    // thuong — nhung noi dung Chrome ghi vao la SO 0 TUYET DOI (do bang
    // volumedetect: max_volume = -91.0 dB, tuc digital silence). Moi thu da
    // xay dung phia sau (sink ao, ffmpeg, jitter buffer, hang doi/task rieng
    // o firmware) deu dung nhung chi cho IM LANG.
    // ignoreDefaultArgs chi go DUNG mot co nay, giu nguyen cac mac dinh khac.
    ignoreDefaultArgs: ['--mute-audio'],
  });

  const t0 = Date.now();
  for (;;) {
    const j = await fetchJsonVersionAsync();
    if (j?.webSocketDebuggerUrl) return;
    if (Date.now() - t0 > 10000) throw new Error('Timed out waiting for CDP /json/version');
    await new Promise(r => setTimeout(r, 200));
  }
}

// (15/09/2026) Ép Chromium VẼ LẠI dù trang không đổi: chèn 1 điểm 2x2px gần như trong suốt
// rồi đổi màu -> compositor phát sinh frame mới -> screencast gửi được frame cho thiết bị.
// Cần khi thiết bị xin hiển lại trang mà URL không đổi (trang tĩnh: không có frame nào để
// tự vẽ lại -> màn hình có thể kẹt ảnh cũ / ảnh đen dù đèn nền vẫn sáng).
import type { CDPSession } from 'playwright-core';

export async function nudgeRepaintAsync(cdp: CDPSession): Promise<void> {
  const expr = `(() => {
    let d = document.getElementById('__rwv_nudge');
    if (!d) {
      d = document.createElement('div');
      d.id = '__rwv_nudge';
      d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;z-index:2147483647;pointer-events:none;opacity:0.004';
      (document.body || document.documentElement).appendChild(d);
    }
    const on = d.style.background === 'rgb(255, 0, 0)';
    d.style.background = on ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)';
    return true;
  })()`;
  try {
    await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  } catch {
    /* trang có thể đang chuyển hướng - bỏ qua */
  }
}

export async function bootstrapAsync(): Promise<void> {
  await startHeadlessIfNeededAsync();

  const info = await fetchJsonVersionAsync();
  if (!info?.webSocketDebuggerUrl) throw new Error('CDP not available');

  await initCdpRootAsync(info.webSocketDebuggerUrl);
  await waitForCdpReadyAsync();
  console.log('[cdp] ready:', info.webSocketDebuggerUrl);
}
