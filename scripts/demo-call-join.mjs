// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (GD3) CHAY THU KHONG CAN DIEN THOAI / TRINH DUYET: `npm run build && node scripts/demo-call-join.mjs`
// Dung server tu dist/ (chi /calls/* + /app/* + WS /calls/web, cong ngau nhien tren 127.0.0.1) roi gia lap 2 trang:
//   A = tab "Gọi" trong Dashboard (nguoi goi — thay cho man P4)
//   B = call-web.html?call=<id> ma app Android mo sau khi bam "Nghe" (doc tham so bang chinh public/call-join.js)
// Kiem tra: /app/incoming -> /app/answer -> {type:'join'} -> tieng 2 chieu (khung 0x01) -> /app/hangup -> 'ended'.
// Khong dung toi cau hinh Home Assistant, khong mo cong ra ngoai, khong ghi tep nao.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (name) => path.join(ROOT, 'dist', name);
for (const f of ['index.js', 'calls.js', 'phones.js', 'phoneStore.js']) {
  if (!fs.existsSync(dist(f))) {
    console.error(`[demo] thieu ${dist(f)} — chay "npm run build" truoc.`);
    process.exit(2);
  }
}

const callsMod = await import(dist('calls.js'));
const phonesMod = await import(dist('phones.js'));
const store = await import(dist('phoneStore.js'));

const PHONE = 'phone-demo';
store.setPhoneStore(new store.PhoneStore(null));
store.phones.register({ id: PHONE, name: 'Pixel 8 (demo)', url: 'https://hass.local/x/call-web.html' }, 1000);
callsMod.setCallHooks({ name: (id) => (id === 'p4-bep' ? 'Màn hình bếp' : undefined) });

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (callsMod.handleCallsApi(req, res, url)) return;
  if (phonesMod.handlePhoneApi(req, res, url)) return;
  res.writeHead(404); res.end();
});
server.on('upgrade', (req, socket, head) => { if (!callsMod.handleCallsUpgrade(req, socket, head)) socket.destroy(); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const log = (...a) => console.log('[demo]', ...a);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const post = (p) => fetch(base + p, { method: 'POST' }).then((r) => r.json());
const get = (p) => fetch(base + p, { cache: 'no-store' }).then((r) => r.json());

/** Mot "trang web" = WS /calls/web (giong call-web.html) + hop thu den. */
async function page(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/calls/web?name=` + encodeURIComponent(name));
  ws.binaryType = 'arraybuffer';
  const box = [];
  ws.on('message', (d, bin) => { box.push(bin ? { bin: Buffer.from(d) } : JSON.parse(d.toString())); });
  await new Promise((ok) => ws.on('open', ok));
  await sleep(80);
  return { ws, box, id: box.find((m) => m.type === 'hello').id, take: (t) => box.filter((m) => m.type === t) };
}

// public/call-join.js — dung CHINH phan doc tham so cua trang that
const W = {};
new Function('window', 'globalThis', fs.readFileSync(path.join(ROOT, 'public', 'call-join.js'), 'utf8'))(W, W);
const QP = W.RwvCallJoin.parse(`?call=${process.argv[2] || 'demo'}`);
log('trang B doc URL (parse) ->', JSON.stringify(QP));

// 1) nguoi goi (A) goi dien thoai
const A = await page('Dashboard · máy tính (P4)');
A.ws.send(JSON.stringify({ type: 'start', to: PHONE }));
await sleep(150);
const callId = A.take('started')[0].call;
log('A goi dien thoai -> call =', callId);
log('GET /app/incoming ->', JSON.stringify(await get(`/app/incoming?phone=${PHONE}`)));

// 2) app bam "Nghe" roi mo call-web.html?call=<id>
log('POST /app/answer ->', JSON.stringify(await post(`/app/answer?phone=${PHONE}&call=${callId}`)));

// 3) trang B: /calls/state (ten nguoi goi) -> {type:'join'}
const B = await page('Dashboard · điện thoại');
const st = await get(`/calls/state?call=${callId}`);
log('/calls/state ->', JSON.stringify(st));
const phoneId = W.RwvCallJoin.phoneOf(st, QP.phone);
const peer = W.RwvCallJoin.peerOf(st);
log('phoneId =', phoneId, '| ten nguoi goi hien tren man goi =', JSON.stringify(peer.name));
B.ws.send(JSON.stringify({ type: 'join', call: callId, phone: phoneId }));
await sleep(150);
log('B nhan ->', JSON.stringify(B.take('joined')[0]));
log('/calls/state sau join ->', JSON.stringify(await get(`/calls/state?call=${callId}`)));

// 4) tieng 2 chieu: PCM s16le mono 16 kHz trong khung 0x01
B.ws.send(Buffer.concat([Buffer.from([1]), Buffer.alloc(640, 7)]));      // dien thoai -> nguoi goi
A.ws.send(Buffer.concat([Buffer.from([1]), Buffer.alloc(640, 3)]));      // nguoi goi -> dien thoai
await sleep(150);
const gotA = A.box.filter((m) => m.bin && m.bin[0] === 1).length;
const gotB = B.box.filter((m) => m.bin && m.bin[0] === 1).length;
log(`tieng: B->A ${gotA} khung, A->B ${gotB} khung`);

// 5) "Kết thúc" tren dien thoai
log('POST /app/hangup ->', JSON.stringify(await post(`/app/hangup?phone=${PHONE}&call=${callId}`)));
await sleep(150);
log('A nhan ->', JSON.stringify(A.take('ended')[0] || null));
log('B nhan ->', JSON.stringify(B.take('ended')[0] || null));
log('/calls/state cuoi ->', JSON.stringify(await get(`/calls/state?call=${callId}`)));
log('danh ba con bao dien thoai ban?', (await get('/calls/contacts?self=web-khac')).find((c) => c.id === PHONE)?.busy);

A.ws.close(); B.ws.close(); server.close();
const okAll = gotA > 0 && gotB > 0 && B.take('joined')[0]?.ok === true;
log(okAll ? 'KET LUAN: OK — join + tieng 2 chieu + ket thuc chay tren HTTP/WS that' : 'KET LUAN: THAT BAI');
process.exit(okAll ? 0 : 1);
