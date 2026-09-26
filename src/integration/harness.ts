// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (26/09/2026) HA TANG THU TICH HOP: chay SERVER THAT (src/index.ts qua tsx) + Chromium that, dong vai panel bang mot
// client WebSocket gia (FakeDevice), va soi Chromium qua cong DevTools (danh sach tab, Runtime.evaluate trong tung
// tab). Dung de bat nhung loi chi lo ra khi cac phan that chay cung nhau — vd race tao trung tab o 2.9.48, thu da
// khong the thay bang unit test.
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Chromium de chay thu: CHROME_EXECUTABLE, Chrome he thong (runner GitHub co san), hoac ban Playwright cai san. */
export function findChrome(): string | null {
  const cands = [process.env.CHROME_EXECUTABLE, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(pw)) if (/^chromium-\d+$/.test(d)) cands.push(path.join(pw, d, 'chrome-linux', 'chrome'));
  } catch { /* khong co */ }
  return cands.find((c) => !!c && fs.existsSync(c)) ?? null;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

async function waitUntil<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, what: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* chua san sang */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`Het ${timeoutMs} ms cho: ${what}`);
    await sleep(100);
  }
}

export interface PageTarget { id: string; url: string; type: string; webSocketDebuggerUrl: string }

export class TestServer {
  private logBuf = '';
  private constructor(private proc: ChildProcess, private dataDir: string,
                      readonly wsPort: number, readonly healthPort: number, readonly debugPort: number) {
    proc.stdout?.on('data', (d) => { this.logBuf += d; });
    proc.stderr?.on('data', (d) => { this.logBuf += d; });
  }

  /** Khoi dong server that; tra ve khi cong health da tra loi (tuc Chromium da len — index.ts cho bootstrapAsync). */
  static async start(env: Record<string, string> = {}): Promise<TestServer> {
    const chrome = findChrome();
    if (!chrome) throw new Error('Khong tim thay Chromium (dat CHROME_EXECUTABLE)');
    const [wsPort, healthPort, debugPort] = [await freePort(), await freePort(), await freePort()];
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-itest-'));
    const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'src', 'index.ts')], {
      cwd: dataDir,
      detached: true,  // nhom tien trinh rieng -> stop() giet ca Chromium con
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WS_PORT: String(wsPort), HEALTH_PORT: String(healthPort), DEBUG_PORT: String(debugPort),
        CHROME_EXECUTABLE: chrome, USER_DATA_DIR: path.join(dataDir, 'pw'),
        LAUNCHER_CONFIG_FILE: path.join(dataDir, 'launcher.json'), TUNING_FILE: path.join(dataDir, 'tuning.json'),
        CCR_REFRESH_MS: '0',
        ...env,
      },
    });
    const srv = new TestServer(proc, dataDir, wsPort, healthPort, debugPort);
    let exited = false;
    proc.once('exit', () => { exited = true; });
    try {
      await waitUntil(async () => {
        if (exited) throw new Error('server da thoat');
        return (await fetch(`http://127.0.0.1:${healthPort}/`)).ok;
      }, 45_000, 'server khoi dong');
    } catch (e) {
      await srv.stop();
      throw new Error(`${(e as Error).message}\n--- log server ---\n${srv.log()}`);
    }
    return srv;
  }

  log(): string { return this.logBuf; }

  local(p: string): string { return `http://127.0.0.1:${this.healthPort}${p}`; }

  async pages(): Promise<PageTarget[]> {
    const r = await fetch(`http://127.0.0.1:${this.debugPort}/json/list`);
    return ((await r.json()) as PageTarget[]).filter((t) => t.type === 'page' && t.url !== 'about:blank');
  }

  /** Cac URL tab dang mo (bo about:blank mac dinh cua Chromium), sap xep de so sanh. */
  async pageUrls(): Promise<string[]> {
    return (await this.pages()).map((p) => p.url).sort();
  }

  /** Cho tab co URL khop xuat hien roi tra ve. */
  async waitPage(match: (url: string) => boolean, timeoutMs = 15_000): Promise<PageTarget> {
    return waitUntil(async () => (await this.pages()).find((p) => match(p.url)), timeoutMs, 'tab xuat hien');
  }

  /** Goi MOT lenh CDP trong MOT tab qua ket noi DevTools rieng (khong dung chung phien CDP cua server). */
  async cdp<T = any>(target: PageTarget, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
      ws.send(JSON.stringify({ id: 1, method, params }));
      const msg: any = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`${method} het gio`)), 10_000);
        ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.id === 1) { clearTimeout(t); res(m); } });
      });
      if (msg.error) throw new Error(msg.error.message);
      return msg.result as T;
    } finally { ws.close(); }
  }

  /** Runtime.evaluate trong MOT tab, tra ve gia tri (JSON). */
  async evaluate<T = unknown>(target: PageTarget, expression: string): Promise<T> {
    const r = await this.cdp(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'loi JS');
    return r?.result?.value as T;
  }

  /** Anh PNG cua tab (de xem giao dien khi phat trien — ITEST_SHOTS=<thu muc>). */
  async screenshot(target: PageTarget): Promise<Buffer> {
    const r = await this.cdp<{ data: string }>(target, 'Page.captureScreenshot', { format: 'png' });
    return Buffer.from(r.data, 'base64');
  }

  async stop(): Promise<void> {
    const pid = this.proc.pid;
    if (pid && this.proc.exitCode == null) {
      const gone = new Promise<void>((r) => this.proc.once('exit', () => r()));
      try { process.kill(-pid, 'SIGTERM'); } catch { /* da thoat */ }
      await Promise.race([gone, sleep(5_000)]);
      try { process.kill(-pid, 'SIGKILL'); } catch { /* da thoat */ }
    }
    fs.rmSync(this.dataDir, { recursive: true, force: true });
  }
}

/** Panel gia: ket noi WS nhu firmware, gui cham, ghi lai moi goi server gui xuong. */
export class FakeDevice {
  readonly msgs: Buffer[] = [];
  private constructor(private ws: WebSocket) {
    ws.on('message', (d, isBinary) => { if (isBinary) this.msgs.push(Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer)); });
  }

  static async connect(srv: TestServer, id: string, params: Record<string, string> = {}): Promise<FakeDevice> {
    const q = new URLSearchParams({ id, w: '1024', h: '600', ...params });
    const ws = new WebSocket(`ws://127.0.0.1:${srv.wsPort}/?${q}`);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new FakeDevice(ws);
  }

  /** Goi Touch: [type=2][ver=1][kind][pointer][x u16][y u16] — kind 1 xuong, 2 di chuyen, 3 nhac. */
  touch(kind: 1 | 2 | 3, x: number, y: number): void {
    const b = Buffer.alloc(8);
    b[0] = 2; b[1] = 1; b[2] = kind; b[3] = 0; b.writeUInt16LE(x, 4); b.writeUInt16LE(y, 6);
    this.ws.send(b);
  }

  /** Goi OpenURL nhu firmware (Go Home / thuc the "URL hien thi"): [4][1][flags u16][len u32][url utf8]. */
  openUrl(url: string): void {
    const u = Buffer.from(url, 'utf8'); const b = Buffer.alloc(8 + u.length);
    b[0] = 4; b[1] = 1; b.writeUInt16LE(0, 2); b.writeUInt32LE(u.length, 4); u.copy(b, 8);
    this.ws.send(b);
  }

  /** Cac URL server da bao qua goi CurrentURL (type 6: [6][1][len u32][utf8]). */
  currentUrls(): string[] {
    return this.msgs.filter((m) => m[0] === 6 && m.length >= 6).map((m) => m.subarray(6, 6 + m.readUInt32LE(2)).toString('utf8'));
  }

  frameCount(): number { return this.msgs.filter((m) => m[0] === 1).length; }

  async waitFor(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
    await waitUntil(async () => pred(), timeoutMs, what);
  }

  close(): void { this.ws.close(); }
}
