// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (21/11/2026) GD13 — "ADD-ON TU PHUC VU HTTPS BANG CHUNG CHI TU KY" (bo han phu thuoc ingress cua HA).
//
// BOI CANH DA KIEM CHUNG (3 ban sua van loi): WebView cua app Android CHI cap micro/camera trong SECURE CONTEXT,
// tuc trang phai la https. Duong duy nhat co https truoc day la ingress cua Home Assistant
// (`https://<domain>/api/hassio_ingress/<TOKEN>/...`), nhung phien ingress CHI duoc tao khi chinh HA frontend mo
// panel (xem KDoc `android/.../HaIngress.kt`). Nguoi dung dang nhap HA xong van khong vao duoc dashboard.
//
// Cach cat dut: add-on TU mo mot listener HTTPS (mac dinh 18443) phuc vu DUNG handler nhu HTTP 18080, bang mot
// chung chi TU KY sinh MOT LAN trong `/data/tls/`. Nho vay dien thoai chi can `https://<ip>:18443/...` la co secure
// context, khong can dang nhap HA, khong can ingress.
//
// Vi sao tu ky la du: trinh duyet khong co CA nao ky cho IP LAN (`192.168.x.x`) — moi chung chi cho IP deu phai tu
// ky. App Android chu dong chap nhan (`WebViewClient.onReceivedSslError` -> proceed) NHUNG CHI cho host da cau hinh
// (xem `android/.../TlsPolicy.kt`). Rui ro con lai: chi trong LAN/Tailscale, khong lo ra Internet (xem config.yaml:
// 18443/tcp chi map ra LAN, giong 18080).
//
// Rang buoc: KHONG them dependency npm (image build offline). Nen thu tu sinh chung chi la
//   1. `openssl` co san trong image (Ubuntu jammy — `/usr/bin/openssl`),
//   2. module `selfsigned` NEU co trong node_modules (khong bat buoc),
//   3. khong co cach nao -> nem loi ro rang, index.ts tat listener HTTPS va ghi log (HTTP 18080 van chay).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import type http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** Hieu luc cua chung chi (ngay). Chung chi tu ky trong LAN — het han thi tu sinh lai, khong can lam gi. */
export const CERT_DAYS = 3650;

/** Con it hon [MIN_DAYS_LEFT] ngay -> coi nhu sap het han va SINH LAI (tranh app bi chan giua luc dang dung). */
export const MIN_DAYS_LEFT = 30;

/** Ten tep trong thu muc TLS. */
export const CERT_FILE = 'cert.pem';
export const KEY_FILE = 'key.pem';

export type TlsSource = 'existing' | 'openssl' | 'selfsigned';

export interface TlsMaterial {
    key: Buffer;
    cert: Buffer;
    /** Thu muc chua cert/key (mac dinh `/data/tls` khi chay trong add-on). */
    dir: string;
    certPath: string;
    keyPath: string;
    /** Danh sach host da dua vao SAN (IPv4 + localhost + hostname). */
    san: string[];
    /** `true` = vua sinh trong lan goi nay (khong phai doc lai tu dia). */
    generated: boolean;
    source: TlsSource;
    notAfter: Date | null;
    daysLeft: number | null;
}

export interface CertCheck {
    ok: boolean;
    /** Ly do khi `ok = false` (ghi thang vao log: `regenerate=…`). */
    reason?: string;
    notAfter?: Date;
    daysLeft?: number;
}

export interface EnsureOptions {
    /** Thu muc chua cert/key. Mac dinh [defaultTlsDir]. */
    dir?: string;
    /** Host dua vao SAN. Mac dinh [sanHosts] (moi IPv4 cua may + localhost + hostname). */
    hosts?: string[];
    /** 'now' de test: coi nhu dang o thoi diem nay khi kiem tra han. */
    now?: Date;
    days?: number;
    /** Duong dan binary openssl (mac dinh 'openssl' -> PATH). */
    opensslPath?: string;
    /** Nhan log (mac dinh console.log). */
    log?: (line: string) => void;
}

const DAY_MS = 86_400_000;

/**
 * Dung sai dong ho khi xet `notBefore`. openssl dat notBefore theo dong ho cua may (do chinh xac 1 giay) SAU khi ta
 * lay `now`, nen tren may tai nang / dong ho nhay giay, notBefore co the "sau" now vai giay -> neu so sanh tuyet doi
 * thi chung chi VUA SINH bi coi la "chua hieu luc" va sinh lai mai mai.
 */
const SKEW_MS = 5 * 60_000;

// ────────────────────────────────────────────────────────────── thu muc + SAN (THUAN, test duoc)

/**
 * Thu muc chung chi: `/data/tls` khi chay trong add-on (`/data` do Supervisor cap, BEN qua update/restart — dung
 * nguyen tac voi `user_data_dir`/`notify-media` trong index.ts), nguoc lai `<cwd>/data/tls` khi chay Docker thuong.
 *
 * Ghi de duoc bang `TLS_DIR` (test / may khong co /data).
 */
export function defaultTlsDir(): string {
    const env = (process.env.TLS_DIR || '').trim();
    if (env) return env;
    const base = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
    return path.join(base, 'tls');
}

/**
 * Danh sach host dua vao SAN: `127.0.0.1`, `localhost`, hostname cua may, roi MOI dia chi IPv4 cua may.
 *
 * Vi sao ca ba loai: dien thoai trong LAN goi `https://<ip>:18443` (ip do DHCP cap cho may HA — co the doi khi doi
 * mang, nen khi doi thi [certState] thay SAN thieu va sinh lai), trinh duyet tren chinh may HA goi `localhost`, va
 * Tailscale/MagicDNS goi theo hostname.
 *
 * Chi lay IPv4: WebView cua app Android luon mo bang IPv4 (xem `ServerResolver.isLanHost`), con IPv6 link-local
 * (`fe80::…%eth0`) khong dua vao SAN duoc (co hau to `%`).
 */
export function sanHosts(
    ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
    hostname: string = os.hostname(),
    extra: string[] = [],
): string[] {
    const out: string[] = [];
    const add = (raw?: string | null): void => {
        const v = (raw || '').trim();
        if (!v) return;
        if (!out.includes(v)) out.push(v);
    };
    add('127.0.0.1');
    add('localhost');
    // hostname phai la ten mien hop le (may dat ten kieu "may-cua-toi" hoac co dau cach -> bo qua).
    if (/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test((hostname || '').trim())) add(hostname);
    for (const list of Object.values(ifaces || {})) {
        for (const a of list || []) {
            if (a.family !== 'IPv4') continue;
            add(a.address);
        }
    }
    // (21/11/2026) TLS_SAN=192.168.10.2,ha.local — them host ngoai danh sach tu dong (Tailscale/MagicDNS, domain noi bo).
    for (const v of extra) add(v);
    return out;
}

/** Tach danh sach SAN thanh IP va DNS (openssl can `IP:` va `DNS:` rieng). */
export function splitSan(hosts: string[]): { ip: string[]; dns: string[] } {
    const ip: string[] = [];
    const dns: string[] = [];
    for (const h of hosts) {
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) ip.push(h);
        else dns.push(h);
    }
    return { ip, dns };
}

/** Noi dung `san.cnf` cho `openssl req -x509 -config` (openssl 1.1.1+ va 3.x deu doc duoc). */
export function opensslConfig(hosts: string[], cn = 'Dashboard OS'): string {
    const { ip, dns } = splitSan(hosts);
    const alt: string[] = [];
    ip.forEach((v, i) => alt.push(`IP.${i + 1} = ${v}`));
    dns.forEach((v, i) => alt.push(`DNS.${i + 1} = ${v}`));
    if (alt.length === 0) alt.push('DNS.1 = localhost');
    return [
        '# (21/11/2026) GD13 — chung chi TU KY cua Dashboard OS Server. Sinh tu dong, dung sua tay.',
        '[req]',
        'distinguished_name = dn',
        'x509_extensions = v3',
        'prompt = no',
        'default_md = sha256',
        '',
        '[dn]',
        `CN = ${cn}`,
        'O = Dashboard OS',
        'OU = add-on',
        '',
        '[v3]',
        'basicConstraints = critical,CA:FALSE',
        'keyUsage = critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage = serverAuth',
        'subjectAltName = @alt_names',
        '',
        '[alt_names]',
        ...alt,
        '',
    ].join('\n');
}

// ────────────────────────────────────────────────────────────── kiem tra chung chi (THUAN, test duoc)

/** `IP Address:1.2.3.4` hoac `DNS:name` co nam trong chuoi SAN cua chung chi khong. */
function sanCovers(subjectAltName: string, host: string): boolean {
    const want = (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? `IP Address:${host}` : `DNS:${host}`).toLowerCase();
    return subjectAltName
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .includes(want);
}

/**
 * Chung chi con dung duoc khong: doc duoc, con han (>= [minDaysLeft] ngay), dung cap khoa, va SAN phu MOI host can.
 *
 * Vi sao phai kiem tra SAN: IP cua may HA do DHCP cap — doi router/mang la IP doi, chung chi cu khong con dung cho
 * IP moi thi WebView se bao loi khong the bo qua (host khong khop). Thay SAN thieu -> sinh lai (khong can nguoi dung).
 */
export function certState(
    certPem: Buffer | string,
    keyPem: Buffer | string,
    hosts: string[],
    now: Date = new Date(),
    minDaysLeft: number = MIN_DAYS_LEFT,
): CertCheck {
    let x: crypto.X509Certificate;
    try {
        x = new crypto.X509Certificate(certPem);
    } catch {
        return { ok: false, reason: 'cert.pem khong doc duoc' };
    }
    const notAfter = new Date(x.validTo);
    const notBefore = new Date(x.validFrom);
    if (Number.isNaN(notAfter.getTime())) return { ok: false, reason: 'validTo hong' };
    const daysLeft = Math.floor((notAfter.getTime() - now.getTime()) / DAY_MS);
    if (!Number.isNaN(notBefore.getTime()) && notBefore.getTime() > now.getTime() + SKEW_MS) {
        return { ok: false, reason: 'chua hieu luc', notAfter, daysLeft };
    }
    if (daysLeft < minDaysLeft) return { ok: false, reason: `het han (con ${daysLeft} ngay)`, notAfter, daysLeft };

    const san = x.subjectAltName || '';
    const missing = hosts.filter((h) => !sanCovers(san, h));
    if (missing.length > 0) {
        return { ok: false, reason: `SAN thieu ${missing.join(',')}`, notAfter, daysLeft };
    }
    try {
        const key = crypto.createPrivateKey(keyPem);
        if (!x.checkPrivateKey(key)) return { ok: false, reason: 'key.pem khong khop cert.pem', notAfter, daysLeft };
    } catch {
        return { ok: false, reason: 'key.pem khong doc duoc', notAfter, daysLeft };
    }
    return { ok: true, notAfter, daysLeft };
}

/** `openssl` co trong PATH khong (image dua tren Ubuntu jammy: co san). Dung de test tu bo qua khi may thieu. */
export function hasOpenssl(cmd = 'openssl'): boolean {
    try {
        execFileSync(cmd, ['version'], { stdio: 'pipe', timeout: 10_000 });
        return true;
    } catch {
        return false;
    }
}

// ────────────────────────────────────────────────────────────── sinh + doc chung chi

/**
 * Bao dam `/data/tls/{key.pem,cert.pem}` ton tai va CON DUNG: doc lai khi hop le, sinh moi khi thieu / het han /
 * SAN thieu / cap khoa lech. Tra ve [TlsMaterial] da nap san (index.ts dua thang cho `https.createServer`).
 *
 * Nem loi khi khong sinh duoc (thieu openssl VA khong co `selfsigned`) — index.ts bat loi nay, ghi log va TAT
 * listener HTTPS, HTTP 18080 van chay binh thuong.
 */
export function ensureSelfSignedCert(opts: EnsureOptions = {}): TlsMaterial {
    const dir = opts.dir || defaultTlsDir();
    const hosts = opts.hosts || sanHosts(undefined, undefined, extraSanFromEnv());
    const days = opts.days ?? CERT_DAYS;
    const now = opts.now ?? new Date();
    const log = opts.log ?? ((line: string) => console.log(line));
    const certPath = path.join(dir, CERT_FILE);
    const keyPath = path.join(dir, KEY_FILE);

    fs.mkdirSync(dir, { recursive: true });

    // 1) Da co chung chi dung -> dung lai (khong sinh lai moi lan khoi dong: doi cert lam app da "chap nhan" phai
    //    chap nhan lai, va nguoi dung nhin thay canh bao moi).
    try {
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            const cert = fs.readFileSync(certPath);
            const key = fs.readFileSync(keyPath);
            const check = certState(cert, key, hosts, now);
            if (check.ok) {
                return {
                    key, cert, dir, certPath, keyPath, san: hosts, generated: false, source: 'existing',
                    notAfter: check.notAfter ?? null, daysLeft: check.daysLeft ?? null,
                };
            }
            log(`[tls] chung chi cu khong dung (${check.reason}) -> sinh lai`);
        }
    } catch (e) {
        log(`[tls] khong doc duoc chung chi cu (${(e as Error).message}) -> sinh lai`);
    }

    // 2) Sinh moi: openssl (co san trong image) -> selfsigned (neu co trong node_modules) -> loi ro rang.
    const openssl = opts.opensslPath || process.env.OPENSSL_BIN || 'openssl';
    let cert: Buffer | null = null;
    let key: Buffer | null = null;
    let source: TlsSource = 'openssl';
    try {
        generateWithOpenssl(openssl, dir, keyPath, certPath, hosts, days);
        key = fs.readFileSync(keyPath);
        cert = fs.readFileSync(certPath);
    } catch (e) {
        log(`[tls] openssl khong dung duoc (${(e as Error).message}) -> thu selfsigned`);
        const pems = generateWithSelfsigned(hosts, days);
        if (!pems) {
            throw new Error(
                `khong tao duoc chung chi tu ky: thieu openssl (${(e as Error).message}) va khong co module selfsigned`,
            );
        }
        cert = Buffer.from(pems.cert);
        key = Buffer.from(pems.key);
        source = 'selfsigned';
        writeFileAtomic(certPath, cert, 0o644);
        writeFileAtomic(keyPath, key, 0o600);
    }

    const check = certState(cert, key, hosts, now);
    if (!check.ok) throw new Error(`chung chi vua sinh khong hop le: ${check.reason}`);
    return {
        key, cert, dir, certPath, keyPath, san: hosts, generated: true, source,
        notAfter: check.notAfter ?? null, daysLeft: check.daysLeft ?? null,
    };
}

/** `TLS_SAN=a,b` -> them host vao SAN (Tailscale MagicDNS / ten mien noi bo). */
export function extraSanFromEnv(raw: string | undefined = process.env.TLS_SAN): string[] {
    return (raw || '')
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
}

/** Ghi tep kieu "atomic": ghi tep tam roi rename (khong bao gio de lai cert.pem nua voi). */
function writeFileAtomic(file: string, data: Buffer, mode: number): void {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
}

/** `openssl req -x509 -newkey rsa:2048 …` voi `san.cnf` sinh tu [opensslConfig]. */
function generateWithOpenssl(
    openssl: string, dir: string, keyPath: string, certPath: string, hosts: string[], days: number,
): void {
    const cfgPath = path.join(dir, 'san.cnf');
    fs.writeFileSync(cfgPath, opensslConfig(hosts), { mode: 0o600 });
    execFileSync(openssl, [
        'req', '-x509', '-newkey', 'rsa:2048', '-sha256',
        '-days', String(days), '-nodes',
        '-keyout', keyPath, '-out', certPath,
        '-config', cfgPath,
    ], { stdio: 'pipe', timeout: 60_000 });
    try {
        fs.chmodSync(keyPath, 0o600);
    } catch {
        // Windows / filesystem khong ho tro chmod: khong sao
    }
}

/** Du phong khi image KHONG co openssl: dung module `selfsigned` neu node_modules co (khong bat buoc phai co). */
function generateWithSelfsigned(hosts: string[], days: number): { key: string; cert: string } | null {
    try {
        const require = createRequire(import.meta.url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const selfsigned = require('selfsigned') as any;
        const attrs = [{ name: 'commonName', value: 'Dashboard OS' }];
        const altNames = hosts.map((h) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)
            ? { type: 7, ip: h }
            : { type: 2, value: h }));
        const pems = selfsigned.generate(attrs, {
            days, keySize: 2048, algorithm: 'sha256',
            extensions: [
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                { name: 'extKeyUsage', serverAuth: true },
                { name: 'subjectAltName', altNames },
            ],
        });
        if (!pems?.cert || !pems?.private) return null;
        return { key: String(pems.private), cert: String(pems.cert) };
    } catch {
        return null;
    }
}

// ────────────────────────────────────────────────────────────── listener HTTPS

/**
 * (21/11/2026) GD13 — listener HTTPS dung CHUNG handler voi HTTP 18080.
 *
 * Vi sao phai chung handler: moi route cua add-on (`/app/*`, `/launcher-config.html`, `/control.html`, WebSocket
 * `/calls/web`…) da duoc viet mot lan trong index.ts. Chep lai cho HTTPS la cho phep hai duong lech nhau (dung loi
 * da gap voi ingress: WS qua ingress bi huy socket). Nen chi boc `https.createServer(options, handler)`.
 *
 * `minVersion: TLSv1.2`: Android 10+ (minSdk 29) va WebView deu ho tro; tat TLS 1.0/1.1 cho gon.
 */
export function createHttpsServer(
    handler: http.RequestListener,
    material: Pick<TlsMaterial, 'key' | 'cert'>,
): https.Server {
    return https.createServer({ key: material.key, cert: material.cert, minVersion: 'TLSv1.2' }, handler);
}

/** Dong log khoi dong của listener HTTPS: `[tls] https://0.0.0.0:18443 (cert /data/tls/cert.pem, …)`. */
export function tlsStartupLine(port: number, m: TlsMaterial): string {
    const exp = m.notAfter ? m.notAfter.toISOString().slice(0, 10) : '?';
    const san = m.san.join(',');
    return `[tls] https://0.0.0.0:${port} (cert ${m.certPath}, san ${san}, het han ${exp}` +
        `${m.generated ? ', vua sinh moi' : ''}, nguon ${m.source})`;
}
