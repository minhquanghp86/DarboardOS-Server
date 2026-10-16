// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (30/09/2026) Ha chat luong screencast khi phat video (2.9.72/2.9.74): trang co hoat anh lien tuc -> Chrome chuyen sang
// chat luong cua thiet bi; hoat anh dung -> ve 90, khung van den. Loi that 30/09: goi lai startScreencast khi dang chay
// bi Chrome tu choi ("Screencast is already active") -> tinh nang khong bao gio chay ma khong test nao bat duoc.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;
beforeEach(async () => { srv = await TestServer.start({ PASSTHROUGH_MIN_FPS: '3' }); });  // Chrome may test chi ~5 khung/s
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server ---\n${log}`);
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

// Canvas doi mau toan man hinh moi khung trong 4 s roi dung han (nhu mot doan video).
const ANIM = 'data:text/html,' + encodeURIComponent(`<body style="margin:0"><canvas id=c width=1024 height=600></canvas><script>
var c=document.getElementById('c').getContext('2d'),t0=Date.now();
(function f(){ if(Date.now()-t0>7000) return; c.fillStyle='hsl('+((Date.now()/5)%360)+',70%,50%)';c.fillRect(0,0,1024,600); requestAnimationFrame(f); })();</script></body>`);

it('video -> chat luong thiet bi; het video -> ve 90; khung van den', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-vq', { home, q: '40', mfi: '33' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.openUrl(ANIM);
  await sleep(1500);
  const f0 = dev.frameCount(); await sleep(2000); console.log(`[test] khung/2s trong luc hoat anh: ${dev.frameCount() - f0}`);
  for (let i = 0; i < 60 && !/chat luong 40 \(video/.test(srv.log()); i++) await sleep(100);
  expect(srv.log()).toMatch(/\[screencast\] it-vq: chat luong 40 \(video/);
  for (let i = 0; i < 80 && !/chat luong 90 \(het video\)/.test(srv.log()); i++) await sleep(100);
  expect(srv.log()).toMatch(/\[screencast\] it-vq: chat luong 90 \(het video\)/);
  expect(srv.log()).not.toMatch(/doi chat luong .* that bai/);
  // Sau khi bat lai screencast o 90: trang tinh van phai ve duoc (repaint ep them khung).
  const before = dev.frameCount();
  dev.repaintRect(0, 0, 1024, 600);
  await dev.waitFor(() => dev!.frameCount() > before, 8_000, 'khung sau khi ve lai 90');
});

// Nhieu hat toan man hinh: o chat luong thiet bi khung van qua to (nhu trang YouTube thuong: video + nhieu chu).
const NOISE = 'data:text/html,' + encodeURIComponent(`<body style="margin:0"><canvas id=c width=1024 height=600></canvas><script>
var x=document.getElementById('c').getContext('2d'),t0=Date.now(),im=x.createImageData(1024,600);
(function f(){ if(Date.now()-t0>15000) return; for(var i=0;i<im.data.length;i++) im.data[i]=Math.random()*255; x.putImageData(im,0,0);
requestAnimationFrame(f); })();</script></body>`);

it('ha chat luong ma khung van qua to -> tu tra ve 90, tam ngung thu lai', async () => {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, 'it-vq2', { home, q: '40', mfi: '33', mbpm: '8192' });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'ket noi');
  dev.openUrl(NOISE);
  for (let i = 0; i < 200 && !/it-vq2: chat luong 90 \(van qua to/.test(srv.log()); i++) await sleep(100);
  expect(srv.log()).toMatch(/it-vq2: chat luong 40 \(video/);
  expect(srv.log()).toMatch(/it-vq2: chat luong 90 \(van qua to o q40/);
  const n40 = (srv.log().match(/it-vq2: chat luong 40/g) ?? []).length;
  await sleep(3000);  // hoat anh van chay: KHONG duoc ha xuong lai (tam ngung 5 phut)
  expect((srv.log().match(/it-vq2: chat luong 40/g) ?? []).length).toBe(n40);
});
