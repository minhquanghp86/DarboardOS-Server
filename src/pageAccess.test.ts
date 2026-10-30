// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (12/11/2026) LOI "mo trang con TRUC TIEP trong app Android thi bao loi": app mo WebView toi
// http://192.168.10.2:18080/<trang>.html (IP LAN, khong qua ingress, khong phai 127.0.0.1) nen cac API chi nhan
// 127.0.0.1 / 172.30.32.2 tra 403. Test nay khoa lai hanh vi MOI:
//   - trang mo truc tiep trong LAN *cung origin* -> duoc phep (khong con 403),
//   - request cross-origin / tu mang ngoai      -> van 403.
import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import { handleDoorApi } from './door.js';
import { handleChatApi } from './chat.js';
import { handleCallsApi } from './calls.js';

const HOST = '192.168.10.2:18080';
const LAN = '::ffff:192.168.10.30';          // dien thoai trong nha di qua IPv6-mapped socket (nhu that te)

interface FakeRes { code: number; body: string }

function res(): http.ServerResponse & FakeRes {
  const r = {
    code: 0,
    body: '',
    headersSent: false,
    writeHead(c: number) { r.code = c; r.headersSent = true; return r; },
    end(b?: string) { r.body = typeof b === 'string' ? b : ''; return r; },
    on() { return r; },
    destroy() { },
  };
  return r as unknown as http.ServerResponse & FakeRes;
}

function req(method: string, remote: string, headers: Record<string, string> = {}): http.IncomingMessage {
  return { method, socket: { remoteAddress: remote }, headers: { host: HOST, ...headers } } as unknown as http.IncomingMessage;
}

const sameOrigin = { referer: `http://${HOST}/x.html` };
const crossOrigin = { origin: 'http://evil.example' };

describe('/door/log (trang Chuông cổng — door-log.html)', () => {
  const url = new URL(`http://${HOST}/door/log`);

  it('mo truc tiep trong LAN cung origin -> 200 (truoc day 403 "Không tải được nhật ký")', () => {
    const r = res();
    expect(handleDoorApi(req('GET', LAN, sameOrigin), r, url)).toBe(true);
    expect(r.code).toBe(200);
    expect(Array.isArray((JSON.parse(r.body) as { items: unknown[] }).items)).toBe(true);
  });

  it('man hinh (127.0.0.1) van nhu cu', () => {
    const r = res();
    handleDoorApi(req('GET', '127.0.0.1'), r, url);
    expect(r.code).toBe(200);
  });

  it('cross-origin va mang ngoai van bi chan 403', () => {
    const a = res();
    handleDoorApi(req('GET', LAN, crossOrigin), a, url);
    expect(a.code).toBe(403);

    const b = res();
    handleDoorApi(req('GET', '203.0.113.9', sameOrigin), b, url);
    expect(b.code).toBe(403);
  });
});

describe('/chat/* (trang Tin nhắn — chat.html)', () => {
  // GET vao duong dan la -> di qua duoc cong kiem tra thi tra 405 (chi nhan POST), bi chan thi 403.
  const url = new URL(`http://${HOST}/chat/khong-co`);

  it('trang mo truc tiep trong LAN cung origin khong con bi 403', () => {
    const r = res();
    expect(handleChatApi(req('GET', LAN, sameOrigin), r, url)).toBe(true);
    expect(r.code).toBe(405);
  });

  it('cross-origin va mang ngoai van bi chan 403', () => {
    const a = res();
    handleChatApi(req('GET', LAN, crossOrigin), a, url);
    expect(a.code).toBe(403);

    const b = res();
    handleChatApi(req('GET', '203.0.113.9', sameOrigin), b, url);
    expect(b.code).toBe(403);
  });
});

describe('/calls/contacts (trang Cuộc gọi — call-web.html)', () => {
  const url = new URL(`http://${HOST}/calls/contacts`);

  it('trang mo truc tiep trong LAN cung origin doc duoc danh ba', () => {
    const r = res();
    expect(handleCallsApi(req('GET', LAN, sameOrigin), r, url)).toBe(true);
    expect(r.code).toBe(200);
    expect(Array.isArray(JSON.parse(r.body))).toBe(true);
  });

  it('cross-origin va mang ngoai van bi chan 403', () => {
    const a = res();
    handleCallsApi(req('GET', LAN, crossOrigin), a, url);
    expect(a.code).toBe(403);

    const b = res();
    handleCallsApi(req('GET', '203.0.113.9', sameOrigin), b, url);
    expect(b.code).toBe(403);
  });
});
