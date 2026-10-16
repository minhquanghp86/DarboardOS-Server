// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).
//
// Sinh THIRD-PARTY-NOTICES.md: moi thu vien npm (production, da cai trong node_modules) + giay phep + toan van thong bao
// ban quyen / giay phep cua tung thu vien. Chay: `npm run licenses` (sau `npm ci`), roi commit file ket qua.
// Anh Docker kem file nay (Apache-2.0 §4, LGPL cua libvips trong sharp).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages;
const pk = [];
for (const [dir, v] of Object.entries(lock)) {
  if (!dir || v.dev || !fs.existsSync(path.join(dir, 'package.json'))) continue;   // chi goi that su da cai
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = fs.readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
  const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n');
  const repo = typeof j.repository === 'string' ? j.repository : j.repository?.url || j.homepage || '';
  pk.push({ name: j.name, version: j.version, license: j.license || (j.licenses ? j.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN'),
    url: repo.replace(/^git\+/, '').replace(/\.git$/, ''), text });
}
pk.sort((a, b) => a.name.localeCompare(b.name));

let md = '# Third-party notices\n\n' +
  'Máy chủ này dùng các thư viện mã nguồn mở dưới đây (bản chạy thật trong ảnh Docker). Mỗi thư viện giữ **giấy phép riêng của nó**,\n' +
  'không chịu giấy phép của dự án (xem `LICENSE`, `NOTICE`). File này do `scripts/gen-third-party.mjs` sinh ra — đừng sửa tay.\n\n' +
  '| Thư viện | Phiên bản | Giấy phép | Nguồn |\n|---|---|---|---|\n' +
  pk.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.url || '—'} |`).join('\n') + '\n\n';
const groups = new Map();
for (const p of pk) {
  if (!p.text) continue;
  const h = crypto.createHash('sha1').update(p.text).digest('hex');
  if (!groups.has(h)) groups.set(h, { text: p.text, names: [] });
  groups.get(h).names.push(`${p.name}@${p.version}`);
}
md += '## Toàn văn giấy phép / thông báo bản quyền\n\n';
for (const g of groups.values()) md += `### ${g.names.join(', ')}\n\n\`\`\`text\n${g.text.replace(/```/g, "'''")}\n\`\`\`\n\n`;
const noText = pk.filter((p) => !p.text).map((p) => p.name);
if (noText.length) md += `Không kèm tệp giấy phép trong gói (theo trường \`license\` ở bảng trên): ${noText.join(', ')}.\n`;
fs.writeFileSync('THIRD-PARTY-NOTICES.md', md);
console.log(`THIRD-PARTY-NOTICES.md: ${pk.length} thu vien, ${groups.size} van ban giay phep, ${md.length} ky tu`);
