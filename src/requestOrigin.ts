// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (12/11/2026) "AI DANG GOI" — MOT cho duy nhat de phan loai request, thay vi moi module tu chep lai
// dieu kien `remoteAddress === '127.0.0.1'` / `=== 172.30.32.2`.
//
// Vi sao can: add-on chay host_network nen dien thoai / tablet trong nha mo THANG
// `http://192.168.10.2:18080/<trang>.html` (app Android, WebView) — request den bang IP LAN chu khong phai
// 127.0.0.1 (tien trinh cua add-on) hay 172.30.32.2 (Supervisor/ingress). Cac API cu chi nhan 2 dia chi do nen
// trang mo truc tiep bao "Chỉ dùng được từ trang Dashboard trong Home Assistant" va khong tai duoc du lieu.
//
// Cach sua: van chi mo cho MANG NOI BO (loopback / LAN / Tailscale), nhung them dieu kien CUNG ORIGIN —
// request phai do chinh trang cua add-on phat ra (Origin/Referer/Sec-Fetch-Site tro ve dung host:port dang goi).
// Nho vay:
//   - trang mo truc tiep trong LAN (cung origin)      -> duoc phep,
//   - trang khac (cross-origin) goi len server        -> van 403 (Origin la host khac),
//   - may ngoai mang (Internet)                       -> van 403 (khong phai IP noi bo).
import type http from 'node:http';

/** Phan cua `http.IncomingMessage` ma cac ham o day can doc (de test khong phai dung ca doi tuong). */
export interface ReqLike {
    socket?: { remoteAddress?: string | null } | null;
    headers?: http.IncomingHttpHeaders;
}

/** Dia chi cua Supervisor khi request di qua ingress cua Home Assistant (da buoc dang nhap HA). */
export const INGRESS_IP = '172.30.32.2';

/** IP cua may goi, bo tien to `::ffff:` cua dia chi IPv4-mapped IPv6. */
export function peerIp(req: ReqLike): string {
    return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

/** 127.0.0.1 / ::1 — tien trinh cua chinh add-on (Chromium cua panel, tich hop HA). */
export function isLoopback(req: ReqLike): boolean {
    return /^(127\.0\.0\.1|::1)$/.test(peerIp(req));
}

/** Request di qua ingress cua Home Assistant (hoac cau hinh mo khoa LAUNCHER_CONFIG_OPEN=1). */
export function isIngress(req: ReqLike): boolean {
    if (process.env.LAUNCHER_CONFIG_OPEN === '1') return true;
    return peerIp(req) === INGRESS_IP;
}

/**
 * Mang noi bo: LAN nha (192.168.x / 10.x), Tailscale (100.64/10 nam trong 100.64-127 -> khong thuoc day),
 * mang docker cua HA (172.16-31.x).
 */
export function isLanIp(ip: string): boolean {
    return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

function hostOf(req: ReqLike): string {
    const h = req.headers?.host;
    return typeof h === 'string' ? h.trim().toLowerCase() : '';
}

/**
 * true = request phat ra tu CHINH trang cua add-on (cung scheme/host/port voi request nay).
 * Ba dau vet trinh duyet tu dat, JavaScript khong sua duoc:
 *   - `sec-fetch-site: same-origin` cho fetch/XHR (Chromium 76+),
 *   - `Origin: <scheme>//<host:port>` cho POST / WebSocket,
 *   - `Referer: <scheme>//<host:port>/<trang>` cho GET, ảnh, iframe.
 */
export function isSameOrigin(req: ReqLike): boolean {
    const host = hostOf(req);
    if (!host) return false;
    const site = req.headers?.['sec-fetch-site'];
    if (typeof site === 'string' && site.trim().toLowerCase() === 'same-origin') return true;
    for (const k of ['origin', 'referer'] as const) {
        const v = req.headers?.[k];
        if (typeof v !== 'string' || !v) continue;
        if (v.trim().toLowerCase() === 'null') continue;      // iframe sandbox / file:// -> khong tin
        try {
            if (new URL(v).host.toLowerCase() === host) return true;
        } catch {
            // Referer hong / khong phai URL -> bo qua
        }
    }
    return false;
}

/**
 * Trinh duyet trong LAN mo THANG trang cua add-on (khong qua ingress, khong phai 127.0.0.1):
 * phai la IP noi bo VA cung origin. Dung rieng khi can phan biet "trang tu mo" voi "tien trinh add-on".
 */
export function isLanBrowser(req: ReqLike): boolean {
    return isLanIp(peerIp(req)) && isSameOrigin(req);
}

/**
 * true = request den tu mot trinh duyet "cua nha minh" dang mo trang cua add-on:
 * loopback (Chromium cua panel / HA), ingress (thanh ben HA) hoac trang mo truc tiep trong LAN cung origin.
 * Van TU CHOI request tu mang ngoai va request cross-origin.
 */
export function isLocalBrowser(req: ReqLike): boolean {
    return isLoopback(req) || isIngress(req) || isLanBrowser(req);
}
