// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).
//
// Moi file ma nguon duoc git theo doi phai co dong SPDX-License-Identifier o ~14 dong dau. Chay: `npm run check:spdx`.
// File cau hinh du lieu (package.json, config.yaml cua addon...) khong can — xem SKIP.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SKIP = /^(package(-lock)?\.json|tsconfig.*\.json|\.vscode\/|\.gitignore|LICENSE|NOTICE|THIRD-PARTY|TRADEMARKS|CONTRIBUTING|README|.*\.md$|.*\.png$|hassio\/remote_webview_server\/(config|build)\.yaml|hassio\/remote_webview_server\/translations\/|repository\.yaml|self-test\/)/;
const EXT = /\.(ts|js|mjs|css|html|sh|ya?ml)$|(^|\/)[dD]ockerfile$/;
const bad = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n')
  .filter((f) => f && !SKIP.test(f) && EXT.test(f))
  .filter((f) => !fs.readFileSync(f, 'utf8').split('\n').slice(0, 14).join('\n').includes('SPDX-License-Identifier'));
if (bad.length) { console.error('Thieu SPDX-License-Identifier:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('SPDX: tat ca file ma nguon deu co tieu de giay phep.');
