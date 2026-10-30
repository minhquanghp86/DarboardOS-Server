// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (12/11/2026) Ai duoc goi API cua add-on: 127.0.0.1 (tien trinh add-on), ingress 172.30.32.2 (trang Dashboard
// trong HA), va trang mo TRUC TIEP trong LAN *cung origin* (app Android: http://192.168.10.2:18080/<trang>.html).
// Test nay khoa lai 3 dieu do, va khoa ca phan CHAN: mang ngoai + request cross-origin van bi tu choi.
import { describe, expect, it } from 'vitest';
import { INGRESS_IP, isIngress, isLanBrowser, isLanIp, isLocalBrowser, isLoopback, isSameOrigin, peerIp, type ReqLike } from './requestOrigin.js';

const HOST = '192.168.10.2:18080';

function req(remoteAddress: string, headers: Record<string, string> = {}): ReqLike {
  return { socket: { remoteAddress }, headers: { host: HOST, ...headers } };
}

describe('peerIp / loopback / ingress', () => {
  it('bo tien to ::ffff: cua IPv4-mapped IPv6', () => {
    expect(peerIp(req('::ffff:192.168.10.30'))).toBe('192.168.10.30');
    expect(peerIp({ socket: null })).toBe('');
  });

  it('127.0.0.1 va ::1 la loopback', () => {
    expect(isLoopback(req('127.0.0.1'))).toBe(true);
    expect(isLoopback(req('::1'))).toBe(true);
    expect(isLoopback(req('192.168.10.30'))).toBe(false);
  });

  it('ingress = dia chi Supervisor', () => {
    expect(isIngress(req(INGRESS_IP))).toBe(true);
    expect(isIngress(req('192.168.10.30'))).toBe(false);
  });

  it('LAN: 10.x / 192.168.x / 172.16-31.x', () => {
    expect(isLanIp('192.168.10.30')).toBe(true);
    expect(isLanIp('10.1.2.3')).toBe(true);
    expect(isLanIp('172.20.0.5')).toBe(true);
    expect(isLanIp('172.40.0.5')).toBe(false);
    expect(isLanIp('203.0.113.9')).toBe(false);
    expect(isLanIp('127.0.0.1')).toBe(false);
  });
});

describe('isSameOrigin', () => {
  it('Origin trung host:port -> cung origin (POST / WebSocket)', () => {
    expect(isSameOrigin(req('192.168.10.30', { origin: 'http://' + HOST }))).toBe(true);
  });

  it('Referer trung host:port -> cung origin (GET / anh / iframe)', () => {
    expect(isSameOrigin(req('192.168.10.30', { referer: `http://${HOST}/chat.html?x=1` }))).toBe(true);
  });

  it('sec-fetch-site: same-origin (Chromium tu dat, JS khong sua duoc)', () => {
    expect(isSameOrigin(req('192.168.10.30', { 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(req('192.168.10.30', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });

  it('Origin/Referer la host KHAC -> cross-origin', () => {
    expect(isSameOrigin(req('192.168.10.30', { origin: 'http://evil.example' }))).toBe(false);
    expect(isSameOrigin(req('192.168.10.30', { referer: 'http://evil.example/x.html' }))).toBe(false);
    // Cung IP nhung KHAC port = khac origin.
    expect(isSameOrigin(req('192.168.10.30', { origin: 'http://192.168.10.2:8123' }))).toBe(false);
  });

  it('Origin: null / khong co header / header hong -> khong tin', () => {
    expect(isSameOrigin(req('192.168.10.30', { origin: 'null' }))).toBe(false);
    expect(isSameOrigin(req('192.168.10.30'))).toBe(false);
    expect(isSameOrigin(req('192.168.10.30', { referer: 'khong-phai-url' }))).toBe(false);
    expect(isSameOrigin({ socket: { remoteAddress: '192.168.10.30' }, headers: {} })).toBe(false);
  });
});

describe('isLocalBrowser: mo truc tiep trong LAN cung origin', () => {
  it('trang mo thang trong LAN (cung origin) duoc phep', () => {
    expect(isLocalBrowser(req('192.168.10.30', { referer: `http://${HOST}/files.html` }))).toBe(true);
    expect(isLocalBrowser(req('192.168.10.30', { origin: 'http://' + HOST }))).toBe(true);
  });

  it('loopback va ingress van duoc phep (khong doi hanh vi cu)', () => {
    expect(isLocalBrowser(req('127.0.0.1'))).toBe(true);
    expect(isLocalBrowser(req('::1'))).toBe(true);
    expect(isLocalBrowser(req(INGRESS_IP))).toBe(true);
  });

  it('LAN nhung KHAC origin (trang khac goi len) bi tu choi', () => {
    expect(isLocalBrowser(req('192.168.10.30', { origin: 'http://evil.example' }))).toBe(false);
    expect(isLocalBrowser(req('192.168.10.30', { referer: 'http://hai-may-khac:18080/x.html' }))).toBe(false);
    // curl / script trong LAN khong gui Origin/Referer -> khong duoc coi la "trang cua add-on".
    expect(isLocalBrowser(req('192.168.10.30'))).toBe(false);
  });

  it('mang NGOAI bi tu choi ke ca khi gia Origin trung host', () => {
    expect(isLocalBrowser(req('203.0.113.9', { origin: 'http://' + HOST }))).toBe(false);
    expect(isLocalBrowser(req('203.0.113.9', { 'sec-fetch-site': 'same-origin' }))).toBe(false);
  });
});

describe('isLanBrowser: dung rieng cho nhanh "trang tu mo trong LAN" cua chat.ts', () => {
  it('chi dung khi IP noi bo VA cung origin', () => {
    expect(isLanBrowser(req('192.168.10.30', { referer: `http://${HOST}/chat.html` }))).toBe(true);
    expect(isLanBrowser(req('192.168.10.30'))).toBe(false);
    expect(isLanBrowser(req('127.0.0.1', { referer: `http://${HOST}/chat.html` }))).toBe(false);
    // 172.30.32.2 (Supervisor) nam trong 172.16/12 nen cung duoc coi la "noi bo" — vo hai: nhanh ingress da duoc
    // phep tu truoc (isIngress), con lai van doi hoi cung origin.
    expect(isLanBrowser(req(INGRESS_IP, { referer: `http://${HOST}/chat.html` }))).toBe(true);
  });
});
