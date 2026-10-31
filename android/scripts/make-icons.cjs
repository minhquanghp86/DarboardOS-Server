#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).
//
// (26/11/2026) Tao icon launcher DU MAT DO tu hassio/remote_webview_server/icon.png (1024×1024, RGBA).
// Truoc day chi co mipmap-xxxhdpi/ic_launcher.png 1024×1024 (~1 MB) nen APK to va cac mat do khac khong co icon.
//
// Chay (tu goc repo, can `sharp` trong node_modules):
//   node android/scripts/make-icons.cjs
//
// Ket qua: android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
//   48 / 72 / 96 / 144 / 192 px — resize lanczos3, giu ti le (anh goc vuong), giu kenh alpha.
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('Thieu "sharp" — chay `npm install` o goc repo (hoac `npm i -D sharp`).');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'hassio', 'remote_webview_server', 'icon.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

(async () => {
  if (!fs.existsSync(SRC)) { console.error('Khong thay anh goc: ' + SRC); process.exit(1); }
  const meta = await sharp(SRC).metadata();
  console.log(`Nguon ${path.relative(ROOT, SRC)} — ${meta.width}×${meta.height}, alpha=${meta.hasAlpha}`);
  let total = 0;
  for (const [dpi, px] of Object.entries(SIZES)) {
    const dir = path.join(RES, `mipmap-${dpi}`);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'ic_launcher.png');
    const info = await sharp(SRC)
      .resize(px, px, { kernel: 'lanczos3', fit: 'fill' })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toFile(out);
    total += info.size;
    console.log(`  mipmap-${dpi}/ic_launcher.png  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(1)} KB`);
  }
  console.log(`Tong ${(total / 1024).toFixed(1)} KB (thay cho icon 1024×1024 ~995 KB truoc day)`);
})().catch((e) => { console.error(e); process.exit(1); });
