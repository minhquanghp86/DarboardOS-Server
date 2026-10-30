// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (17/11/2026) GD9 — BO TIEN TO INGRESS/PROXY O MOT CHO DUY NHAT.
//
// Boi canh (da kiem chung that): khi trang cua add-on duoc mo qua ingress cua Home Assistant, MOI duong dan tuyet
// doi ma trang goi deu mang tien to:
//   https://<domain>/api/hassio_ingress/<TOKEN>/chat.html          <- trang
//   https://<domain>/api/hassio_ingress/<TOKEN>/chat/list?dev=...  <- fetch (public/ui.js tu gan goc trang)
//   https://<domain>/api/hassio_ingress/<TOKEN>/app/register        <- app Android (sau khi gop 1 o dia chi)
// Truoc day chi /app/ping so khop theo HAU TO (endsWith), con lai so khop theo DAU (`startsWith('/app/')`,
// `startsWith('/chat/')`, `STATIC_PAGES.includes(...)`) nen qua ingress chung deu truot -> tra "ok" 2 byte hoac 404:
//   - POST /app/register qua ingress  -> app khong dang ky duoc (khong nhan duoc cuoc goi),
//   - /chat/*, /fm/*, /api/cam/* -> trang Tin nhan / Quan ly file / Thu vien bao "khong tai duoc du lieu",
//   - /chat.html, /files.html ... -> trinh duyet TAI VE tep "ok" thay vi mo trang.
//
// Cach sua: [routeOf] cat cac tien to da biet (giu nguyen phan con lai) va index.ts dung duong dan da chuan hoa cho
// MOI handler (HTTP + nang cap WebSocket). Tren panel (goc '/') ket qua KHONG DOI.
//
// Ham thuan (khong mang, khong phu thuoc http) de test duoc — xem src/routePath.test.ts.

/** Tien to ingress cua Home Assistant (kem TOKEN) — HA giu nguyen tien to khi chuyen tiep vao add-on. */
const INGRESS_PREFIXES: RegExp[] = [
  /^\/api\/hassio_ingress\/[^/]+\/?/i,
  /^\/api\/hassio\/ingress\/[^/]+\/?/i,
  /^\/hassio\/ingress\/[^/]+\/?/i,
  /^\/hassio_ingress\/[^/]+\/?/i,
  // Reverse proxy giu ten add-on (khong co TOKEN).
  /^\/b39feb53_remote_webview_server\//i,
];

/**
 * `/api/hassio_ingress/<TOKEN>/app/register` -> `/app/register`; `/` -> `/`; `/chat/list` -> `/chat/list`.
 * Bo duoc NHIEU tien to lien tiep (proxy long nhau). Khong bao gio tra ve chuoi rong.
 */
export function routeOf(pathname: string | null | undefined): string {
  let p = pathname || '/';
  if (p.charAt(0) !== '/') p = '/' + p;
  for (let guard = 0; guard < 4; guard++) {
    let hit = false;
    for (const re of INGRESS_PREFIXES) {
      const m = re.exec(p);
      if (!m) continue;
      const rest = p.slice(m[0].length);
      p = '/' + rest;
      hit = true;
      break;
    }
    if (!hit) break;
  }
  return p;
}

/** true = duong dan nay co tien to ingress/proxy (tuc la request di qua HA chu khong phai goc add-on). */
export function hasIngressPrefix(pathname: string | null | undefined): boolean {
  return routeOf(pathname) !== (pathname || '/');
}
