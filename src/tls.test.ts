// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (21/11/2026) GD13 — test cho HTTPS TU KY cua add-on (src/tls.ts).
//
// Ba nhom:
//  1. THUAN (khong cham dia/mang): chon SAN, tach IP/DNS, noi dung san.cnf, kiem tra han + cap khoa + SAN.
//  2. Sinh chung chi THAT bang openssl trong thu muc tam: sinh lan dau -> dung lai lan sau; doi IP trong SAN ->
//     sinh lai; chung chi het han -> bi coi la khong dung.
//  3. Route HTTPS dung CHUNG handler (createHttpsServer): cung mot handler, HTTP va HTTPS tra CUNG mot ket qua.
//
// Nhom 2/3 can `openssl` trong PATH (co san trong image Ubuntu jammy) — may nao thieu thi tu bo qua, khong lam do
// `npm test`.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CERT_DAYS,
  MIN_DAYS_LEFT,
  certState,
  createHttpsServer,
  defaultTlsDir,
  ensureSelfSignedCert,
  extraSanFromEnv,
  hasOpenssl,
  opensslConfig,
  sanHosts,
  splitSan,
  tlsStartupLine,
  type TlsMaterial,
} from './tls.js';

const OPENSSL = hasOpenssl();

const tmpDirs: string[] = [];
function tmpDir(tag: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `tls-${tag}-`));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────── 1) PHAN THUAN

describe('sanHosts — chon host dua vao SAN', () => {
  const ifaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [
      { address: '192.168.10.2', family: 'IPv4', internal: false },
      { address: '172.30.32.1', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;

  it('gom moi IPv4 cua may + localhost + hostname, bo IPv6', () => {
    expect(sanHosts(ifaces, 'hass-box')).toEqual([
      '127.0.0.1',
      'localhost',
      'hass-box',
      '192.168.10.2',
      '172.30.32.1',
      '172.17.0.1',
    ]);
  });

  it('bo hostname khong phai ten mien hop le, khong trung lap', () => {
    expect(sanHosts({ eth0: [{ address: '10.0.0.5', family: 'IPv4' }] } as never, 'may cua toi'))
      .toEqual(['127.0.0.1', 'localhost', '10.0.0.5']);
    const dup = sanHosts({ a: [{ address: '10.0.0.5', family: 'IPv4' }, { address: '10.0.0.5', family: 4 as never }] } as never, 'x');
    expect(dup.filter((h) => h === '10.0.0.5')).toHaveLength(1);
  });

  it('them host tu TLS_SAN (Tailscale MagicDNS / ten mien noi bo)', () => {
    expect(extraSanFromEnv(' hass.ts.net , 100.64.0.7 ,')).toEqual(['hass.ts.net', '100.64.0.7']);
    expect(extraSanFromEnv('')).toEqual([]);
    expect(extraSanFromEnv(undefined)).toEqual([]);
    expect(sanHosts({} as never, 'box', ['hass.ts.net'])).toEqual(['127.0.0.1', 'localhost', 'box', 'hass.ts.net']);
  });

  it('tach IP va DNS cho openssl', () => {
    expect(splitSan(['127.0.0.1', 'localhost', '192.168.10.2', 'hass.local'])).toEqual({
      ip: ['127.0.0.1', '192.168.10.2'],
      dns: ['localhost', 'hass.local'],
    });
  });

  it('san.cnf co du IP:/DNS: va CA:FALSE (chung chi la self-signed, khong phai CA)', () => {
    const cfg = opensslConfig(['127.0.0.1', 'localhost', '192.168.10.2', 'hass.ts.net']);
    expect(cfg).toContain('subjectAltName = @alt_names');
    expect(cfg).toContain('IP.1 = 127.0.0.1');
    expect(cfg).toContain('IP.2 = 192.168.10.2');
    expect(cfg).toContain('DNS.1 = localhost');
    expect(cfg).toContain('DNS.2 = hass.ts.net');
    expect(cfg).toContain('basicConstraints = critical,CA:FALSE');
    expect(cfg).toContain('extendedKeyUsage = serverAuth');
    // Danh sach rong: van phai co mot DNS de openssl khong loi.
    expect(opensslConfig([])).toContain('DNS.1 = localhost');
  });

  it('thu muc mac dinh la /data/tls khi co /data, nguoc lai <cwd>/data/tls; TLS_DIR ghi de', () => {
    const old = process.env.TLS_DIR;
    delete process.env.TLS_DIR;
    expect(defaultTlsDir()).toBe(fs.existsSync('/data') ? '/data/tls' : path.join(process.cwd(), 'data', 'tls'));
    process.env.TLS_DIR = '/tmp/tls-test-dir';
    expect(defaultTlsDir()).toBe('/tmp/tls-test-dir');
    if (old === undefined) delete process.env.TLS_DIR;
    else process.env.TLS_DIR = old;
  });
});

// ─────────────────────────────────────────────── 2) SINH + KIEM TRA CHUNG CHI THAT

describe.skipIf(!OPENSSL)('ensureSelfSignedCert — sinh mot lan vao <dir>', () => {
  it('sinh cert.pem/key.pem, SAN dung, han 10 nam, lan sau dung lai (khong sinh moi)', () => {
    const dir = tmpDir('once');
    const hosts = ['127.0.0.1', 'localhost', '192.168.10.2'];
    const m = ensureSelfSignedCert({ dir, hosts, log: () => {} });

    expect(m.generated).toBe(true);
    expect(m.source).toBe('openssl');
    expect(fs.existsSync(m.certPath)).toBe(true);
    expect(fs.existsSync(m.keyPath)).toBe(true);
    expect(m.cert.toString()).toContain('BEGIN CERTIFICATE');
    expect(m.key.toString()).toContain('PRIVATE KEY');
    // Khoa rieng khong duoc de nguoi khac doc (chmod 600).
    if (process.platform !== 'win32') {
      expect(fs.statSync(m.keyPath).mode & 0o777).toBe(0o600);
    }
    // SAN dung: co ca IP LAN va localhost; han ~CERT_DAYS ngay.
    const check = certState(m.cert, m.key, hosts);
    expect(check.ok).toBe(true);
    expect(check.daysLeft).toBeGreaterThan(CERT_DAYS - 2);
    expect(m.notAfter).toBeInstanceOf(Date);

    // Lan thu hai: doc lai tu dia, KHONG sinh lai (doi cert = app phai chap nhan lai).
    const m2 = ensureSelfSignedCert({ dir, hosts, log: () => {} });
    expect(m2.generated).toBe(false);
    expect(m2.source).toBe('existing');
    expect(m2.cert.toString()).toBe(m.cert.toString());
  });

  it('doi IP (DHCP cap IP khac) -> SAN thieu -> sinh lai', () => {
    const dir = tmpDir('san');
    const first = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1', '192.168.10.2'], log: () => {} });
    const moved = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1', '192.168.10.99'], log: () => {} });
    expect(moved.generated).toBe(true);
    expect(moved.cert.toString()).not.toBe(first.cert.toString());
    expect(certState(moved.cert, moved.key, ['127.0.0.1', '192.168.10.99']).ok).toBe(true);
    // CERT cu khong con dung cho IP moi.
    expect(certState(first.cert, first.key, ['192.168.10.99']).ok).toBe(false);
  });

  it('chung chi sap het han -> coi la khong dung (sinh lai, khong dung cert cu)', () => {
    const dir = tmpDir('expire');
    // 40 ngay: con hon MIN_DAYS_LEFT nen lan dau hop le, nhung 15 ngay sau thi duoi nguong -> phai sinh lai.
    const m = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1'], days: 40, log: () => {} });
    expect(certState(m.cert, m.key, ['127.0.0.1']).ok).toBe(true);

    const later = new Date(Date.now() + 15 * 86_400_000);
    const check = certState(m.cert, m.key, ['127.0.0.1'], later);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('het han');
    expect(MIN_DAYS_LEFT).toBeGreaterThan(0);

    const regenerated = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1'], now: later, log: () => {} });
    expect(regenerated.generated).toBe(true);
    expect(certState(regenerated.cert, regenerated.key, ['127.0.0.1'], later).ok).toBe(true);
  });

  it('tep hong (cert.pem khong phai PEM) -> sinh lai thay vi chet', () => {
    const dir = tmpDir('broken');
    fs.writeFileSync(path.join(dir, 'cert.pem'), 'khong phai pem');
    fs.writeFileSync(path.join(dir, 'key.pem'), 'khong phai key');
    const m = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1'], log: () => {} });
    expect(m.generated).toBe(true);
    expect(certState(m.cert, m.key, ['127.0.0.1']).ok).toBe(true);
  });

  it('certState: key khong khop cert / du lieu rac deu tra ok=false', () => {
    const dir = tmpDir('mismatch');
    const a = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1'], log: () => {} });
    const other = ensureSelfSignedCert({ dir: tmpDir('other'), hosts: ['127.0.0.1'], log: () => {} });
    const mismatch = certState(a.cert, other.key, ['127.0.0.1']);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toContain('khong khop');
    expect(certState('rac', 'rac', ['127.0.0.1']).ok).toBe(false);
  });

  it('dong log khoi dong co duong dan cert + SAN + han', () => {
    const m = ensureSelfSignedCert({ dir: tmpDir('log'), hosts: ['127.0.0.1', 'localhost'], log: () => {} });
    const line = tlsStartupLine(18443, m);
    expect(line.startsWith('[tls] https://0.0.0.0:18443 (cert ')).toBe(true);
    expect(line).toContain(m.certPath);
    expect(line).toContain('san 127.0.0.1,localhost');
    expect(line).toContain('het han');
  });
});

// ─────────────────────────────────────────────── 3) ROUTE HTTPS DUNG CHUNG HANDLER

describe.skipIf(!OPENSSL)('createHttpsServer — cung handler voi HTTP', () => {
  function listen(server: http.Server | https.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
  }

  function get(port: number, secure: boolean): Promise<{ code: number; body: string }> {
    return new Promise((resolve, reject) => {
      const fn = secure ? https : http;
      const req = fn.get(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { host: '127.0.0.1', port, path: '/app/ping', rejectUnauthorized: false } as any,
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ code: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('error', reject);
    });
  }

  it('HTTP va HTTPS tra CUNG mot ket qua cho cung mot handler', async () => {
    const dir = tmpDir('serve');
    const material: TlsMaterial = ensureSelfSignedCert({ dir, hosts: ['127.0.0.1'], log: () => {} });
    const handler: http.RequestListener = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, service: 'dashboard-os', path: req.url, secure: !!(req.socket as never as { encrypted?: boolean }).encrypted }));
    };

    const plain = http.createServer(handler);
    const secure = createHttpsServer(handler, material);
    const plainPort = await listen(plain);
    const securePort = await listen(secure);
    try {
      const a = await get(plainPort, false);
      const b = await get(securePort, true);
      expect(a.code).toBe(200);
      expect(b.code).toBe(200);
      expect(JSON.parse(a.body)).toEqual({ ok: true, service: 'dashboard-os', path: '/app/ping', secure: false });
      expect(JSON.parse(b.body)).toEqual({ ok: true, service: 'dashboard-os', path: '/app/ping', secure: true });
    } finally {
      await new Promise<void>((r) => plain.close(() => r()));
      await new Promise<void>((r) => secure.close(() => r()));
    }
  });
});
