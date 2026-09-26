// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (27/09/2026) TRUYEN YOUTUBE TU DIEN THOAI — giao thuc DIAL (nhu Smart TV / Roku), KHONG phai Chromecast (Chromecast
// doi chung chi phan cung cua Google — khong the gia lap).
//   1. App YouTube tren dien thoai phat M-SEARCH (SSDP, UDP 239.255.255.250:1900) tim "urn:dial-multiscreen-org:
//      service:dial:1". Moi panel bat "Nhan truyen YouTube" tra loi nhu mot TV rieng (ten = ten panel).
//   2. Dien thoai doc mo ta thiet bi (dd.xml) -> dia chi ung dung (header Application-URL) -> GET .../apps/YouTube.
//   3. Nguoi dung chon panel trong nut truyen -> POST .../apps/YouTube (than: pairingCode=...&theme=...) -> server mo
//      youtube.com/tv?<tham so do> tren panel (tab rieng, User-Agent Smart TV). Giao dien YouTube TV tu ghep voi dien
//      thoai bang pairingCode; tu do dien thoai dieu khien (phat/dung/tua/am luong/danh sach cho).
//   4. Dien thoai ngat -> DELETE .../apps/YouTube/run -> dong tab, quay ve ung dung truoc.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';

export const DIAL_ST = 'urn:dial-multiscreen-org:service:dial:1';
const SSDP_ADDR = '239.255.255.250';

export interface DialDevice { id: string; name: string }
export interface DialHooks {
  /** Panel dang bat nhan truyen (ten hien tren dien thoai). */
  devices(): DialDevice[];
  launch(id: string, url: string): void;
  stop(id: string): void;
  running(id: string): boolean;
}

/** uuid on dinh cho moi panel (dien thoai nho TV theo uuid). */
export function dialUuid(deviceId: string): string {
  const h = crypto.createHash('md5').update('rwv-dial:' + deviceId).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

/** Goi M-SEARCH co tim DIAL khong (ST dial hoac ssdp:all). Tra ve MX (giay) hoac null. */
export function parseMSearch(msg: string): { st: string; mx: number } | null {
  if (!/^M-SEARCH \* HTTP\/1\.1\r?\n/i.test(msg)) return null;
  const h: Record<string, string> = {};
  for (const line of msg.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  if (!/ssdp:discover/i.test(h.man ?? '')) return null;
  const st = h.st ?? '';
  if (st !== DIAL_ST && st !== 'ssdp:all') return null;
  return { st, mx: Math.min(5, Math.max(0, Number(h.mx) || 1)) };
}

export function ssdpResponse(location: string, uuid: string): string {
  return ['HTTP/1.1 200 OK', 'CACHE-CONTROL: max-age=1800', `DATE: ${new Date().toUTCString()}`, 'EXT:',
    `LOCATION: ${location}`, 'SERVER: Linux/5 UPnP/1.1 Darboard/1.0', `ST: ${DIAL_ST}`, `USN: uuid:${uuid}::${DIAL_ST}`,
    'BOOTID.UPNP.ORG: 1', 'CONFIGID.UPNP.ORG: 1', '', ''].join('\r\n');
}

export function deviceXml(name: string, uuid: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:dial-multiscreen-org:device:dial:1</deviceType>
    <friendlyName>${xmlEsc(name)}</friendlyName>
    <manufacturer>Darboard</manufacturer>
    <modelName>Darboard Panel</modelName>
    <UDN>uuid:${uuid}</UDN>
    <serviceList><service>
      <serviceType>urn:dial-multiscreen-org:service:dial:1</serviceType>
      <serviceId>urn:dial-multiscreen-org:serviceId:dial</serviceId>
      <controlURL>/ssdp/notfound</controlURL><eventSubURL>/ssdp/notfound</eventSubURL><SCPDURL>/ssdp/notfound</SCPDURL>
    </service></serviceList>
  </device>
</root>`;
}

export function appXml(running: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<service xmlns="urn:dial-multiscreen-org:schemas:dial" dialVer="2.1">
  <name>YouTube</name>
  <options allowStop="true"/>
  <state>${running ? 'running' : 'stopped'}</state>${running ? '\n  <link rel="run" href="run"/>' : ''}
</service>`;
}

/**
 * URL mo tren panel tu than POST cua dien thoai (pairingCode, theme, v...). Chi giu tham so ten/gia tri an toan — khong
 * cho dien thoai (hay may la trong LAN) dieu huong panel toi trang tuy y.
 */
export function launchUrl(base: string, body: string): string {
  const src = new URLSearchParams(body.slice(0, 2000));
  const out = new URLSearchParams();
  for (const [k, v] of src) {
    if (/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k) && v.length <= 200 && /^[\w.:\-]*$/.test(v)) out.append(k, v);
  }
  const q = out.toString();
  return q ? `${base}?${q}` : base;
}

/** Dia chi IPv4 cua may nay cung mang voi `peer` (de LOCATION tro dung card mang). */
export function localIpFor(peer: string): string {
  if (process.env.DIAL_HOST) return process.env.DIAL_HOST;
  const all = Object.values(os.networkInterfaces()).flat().filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal);
  if (peer === '127.0.0.1') return '127.0.0.1';
  const p = peer.split('.').map(Number);
  const same = all.find((a) => {
    const ip = a.address.split('.').map(Number), m = a.netmask.split('.').map(Number);
    return ip.every((x, i) => (x & m[i]) === (p[i] & m[i]));
  });
  return (same ?? all[0])?.address ?? '127.0.0.1';
}

export interface DialServer { close(): void; port: number }

/** HTTP (mo ta + ung dung YouTube) + SSDP (tra loi M-SEARCH). */
export function startDial(hooks: DialHooks, opts: { httpPort: number; ssdpPort?: number; ytUrl: string }): DialServer {
  const find = (id: string) => hooks.devices().find((d) => d.id === id);
  const server = http.createServer((req, res) => {
    const m = /^\/dial\/([\w-]{1,64})\/(dd\.xml|apps\/YouTube(\/run)?|apps\/[\w.-]+)$/.exec((req.url || '').split('?')[0]);
    const dev = m ? find(m[1]) : undefined;
    if (!m || !dev) { res.writeHead(404); res.end(); return; }
    const base = `http://${req.headers.host}/dial/${dev.id}`;
    if (m[2] === 'dd.xml' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'Application-URL': `${base}/apps/`, 'Access-Control-Expose-Headers': 'Application-URL' });
      res.end(deviceXml(dev.name, dialUuid(dev.id)));
      return;
    }
    if (m[2] === 'apps/YouTube' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' });
      res.end(appXml(hooks.running(dev.id)));
      return;
    }
    if (m[2] === 'apps/YouTube' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        const url = launchUrl(opts.ytUrl, body);
        console.log(`[cast] ${dev.id}: dien thoai ${req.socket.remoteAddress} truyen YouTube -> mo YouTube TV`);
        hooks.launch(dev.id, url);
        res.writeHead(201, { Location: `${base}/apps/YouTube/run`, 'content-type': 'text/plain' });
        res.end();
      });
      return;
    }
    if (m[2] === 'apps/YouTube/run' && req.method === 'DELETE') {
      console.log(`[cast] ${dev.id}: dien thoai ngat truyen`);
      hooks.stop(dev.id);
      res.writeHead(200); res.end();
      return;
    }
    res.writeHead(404); res.end();   // ung dung khac (Netflix...) — khong ho tro
  });
  server.on('error', (e) => console.warn(`[cast] khong mo duoc cong DIAL ${opts.httpPort}: ${e.message}`));
  server.listen(opts.httpPort);

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', (e) => console.warn(`[cast] SSDP loi: ${e.message} — dien thoai se khong tu thay panel`));
  sock.on('message', (buf, rinfo) => {
    const q = parseMSearch(buf.toString('utf8'));
    if (!q) return;
    const ip = localIpFor(rinfo.address);
    for (const d of hooks.devices()) {
      const msg = Buffer.from(ssdpResponse(`http://${ip}:${opts.httpPort}/dial/${d.id}/dd.xml`, dialUuid(d.id)));
      // Tra loi trong khoang MX (spec) — nhieu panel khong gui dong loat
      setTimeout(() => sock.send(msg, rinfo.port, rinfo.address), Math.floor(Math.random() * Math.min(1000, q.mx * 1000)));
    }
  });
  sock.bind(opts.ssdpPort ?? 1900, () => {
    try { sock.addMembership(SSDP_ADDR); } catch (e) { console.warn(`[cast] khong tham gia nhom SSDP: ${(e as Error).message}`); }
    console.log(`[cast] DIAL san sang: SSDP cong ${opts.ssdpPort ?? 1900}, HTTP cong ${opts.httpPort}`);
  });
  return { port: opts.httpPort, close: () => { server.close(); try { sock.close(); } catch { /* */ } } };
}
