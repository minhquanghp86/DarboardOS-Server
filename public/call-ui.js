// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) GIAO DIEN CUOC GOI VIDEO kieu dien thoai — dung chung cho call.html (man P4, trong Chromium cua add-on) va
// call-web.html (tab "Gọi" trong Darboard). Trang goi CallUI.mount(root, adapter):
//   adapter = { self, base, contacts(): Promise<list>, start(to), accept(), decline(), hangup(), mute(on), cam(on),
//               selfVideo(el?): gan hinh cua minh vao khung nho (man: WS /call/video; web: <video> getUserMedia) }
//   va goi ui.set(state) moi khi trang thai doi: {view:'contacts'|'out'|'in'|'active'|'ended', call, peer, peerName,
//   since, peerMuted, peerCamOff, reason}.
// Chi DOM API (khong innerHTML). Khong hoat anh lien tuc (bang thong toi panel): chi dong ho 1 lan / giay.
(function () {
  'use strict';
  var IC = window.RwvIcons || {};
  function svg(n) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', IC[n] || ''); s.appendChild(p); return s;
  }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function initials(n) {
    var w = String(n || '?').replace(/[()[\]]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }
  var HUES = [262, 199, 152, 28, 340, 222, 12, 174];
  function hue(n) { var h = 0; for (var i = 0; i < String(n).length; i++) h = (h * 31 + String(n).charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; }
  function avatar(name, big) {
    var a = el('div', 'av' + (big ? ' big' : ''), initials(name));
    a.style.background = 'linear-gradient(140deg, hsl(' + hue(name) + ' 70% 55%), hsl(' + ((hue(name) + 40) % 360) + ' 70% 40%))';
    return a;
  }
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  function fmt(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600); return (h ? h + ':' + p2(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + p2(s % 60); }

  /** Hinh qua WS /call/video: H.264 (WebCodecs) hoac JPEG -> canvas. Tra { close() }. */
  function videoInto(canvas, wsUrl, onFirst) {
    var g = canvas.getContext('2d'), dec = null, busy = false, closed = false, ws = null, first = true;
    function draw(img, w, h) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      g.drawImage(img, 0, 0);
      if (first) { first = false; if (onFirst) onFirst(); }
    }
    function open() {
      ws = new WebSocket(wsUrl); ws.binaryType = 'arraybuffer';
      var codec = '';
      ws.onmessage = function (e) {
        if (typeof e.data === 'string') {
          var c = JSON.parse(e.data); codec = c.codec;
          if (codec === 'jpeg' || !('VideoDecoder' in window)) return;
          var bin = atob(c.avcc), a = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          if (dec) { try { dec.close(); } catch (x) { /* */ } }
          dec = new VideoDecoder({ output: function (fr) { draw(fr, fr.displayWidth, fr.displayHeight); fr.close(); }, error: function () { /* doi khung khoa */ } });
          dec.configure({ codec: c.codec, description: a, optimizeForLatency: true });
          return;
        }
        if (codec === 'jpeg') {
          if (busy) return; busy = true;
          createImageBitmap(new Blob([new Uint8Array(e.data, 5)], { type: 'image/jpeg' })).then(function (bm) { draw(bm, bm.width, bm.height); bm.close(); busy = false; })
            .catch(function () { busy = false; });
          return;
        }
        if (!dec || dec.state !== 'configured') return;
        var d = new DataView(e.data), key = d.getUint8(0) === 1;
        if (dec.decodeQueueSize > 6 && !key) return;           // giai ma khong kip: bo khung thuong (khong de tre)
        try { dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: d.getUint32(1, true) * 1000, data: new Uint8Array(e.data, 5) })); } catch (x) { /* */ }
      };
      ws.onclose = function () { if (!closed) setTimeout(open, 1500); };
    }
    open();
    return { close: function () { closed = true; try { ws.close(); } catch (x) { /* */ } if (dec) { try { dec.close(); } catch (x) { /* */ } } } };
  }

  // (14/10/2026) NHAC CHUONG: cuoc goi den = tep nhac chuong (A.ringUrl — /ringtone/call, tep trong media HA, vd zalo.mp3);
  // goi di = tieng tut cho 425 Hz (1 s keu / 3 s nghi, nhu tong dai Viet Nam). Doi trang thai -> tat.
  var tones = { audio: null, ctx: null, t: 0 };
  function stopTones() {
    if (tones.audio) { tones.audio.pause(); tones.audio = null; }
    clearInterval(tones.t); tones.t = 0;
    if (tones.ctx) { tones.ctx.close(); tones.ctx = null; }
  }
  function ringTone(url) {
    stopTones();
    var a = new Audio(url); a.loop = true; tones.audio = a; window.__rwvRingAudio = a;
    a.play().catch(function () { /* trinh duyet chan tu phat: khong sao */ });
  }
  function ringback() {
    stopTones();
    try { tones.ctx = new AudioContext(); } catch (e) { return; }
    var c = tones.ctx;
    var beep = function () { var o = c.createOscillator(), g = c.createGain(); o.frequency.value = 425; g.gain.value = 0.08; o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 1); };
    beep(); tones.t = setInterval(beep, 4000);
  }

  function mount(root, A) {
    root.replaceChildren();
    root.className = 'call';
    // Lop nen: hinh cua minh (cuoc goi di / den) hoac hinh ben kia (dang goi)
    var bigCv = el('canvas', 'big-v'), bigVid = el('video', 'big-v'); bigVid.muted = true; bigVid.playsInline = true; bigVid.autoplay = true;
    var shade = el('div', 'shade');
    var pip = el('div', 'pip'), pipCv = el('canvas'), pipVid = el('video'); pipVid.muted = true; pipVid.playsInline = true; pipVid.autoplay = true;
    pip.append(pipCv, pipVid);
    var camOffBox = el('div', 'camoff');
    var top = el('div', 'top'), topName = el('div', 'tname'), topSub = el('div', 'tsub');
    top.append(topName, topSub);
    var center = el('div', 'center');
    var bar = el('div', 'bar');
    var list = el('div', 'contacts');
    var toast = el('div', 'toast'); toast.hidden = true;
    root.append(bigCv, bigVid, shade, camOffBox, pip, top, center, bar, list, toast);

    var S = { view: '' }, remote = null, selfFeed = null, tickT = 0, hideT = 0, muted = false, camOff = false, toastT = 0;
    function say(t) { toast.textContent = t; toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toast.hidden = true; }, 2600); }
    function rbtn(cls, ic, label, fn) {
      var w = el('div', 'rb ' + cls), b = el('button'); b.type = 'button'; b.setAttribute('aria-label', label); b.append(svg(ic));
      b.onclick = function (e) { e.stopPropagation(); fn(b); };
      w.append(b, el('span', '', label)); return w;
    }
    function showSelf(where) {
      // where: 'big' (nen cuoc goi di / den) | 'pip' | null
      if (selfFeed) { selfFeed.close(); selfFeed = null; }
      bigVid.hidden = pipVid.hidden = true; pipCv.hidden = true;
      if (!where) return;
      selfFeed = A.selfVideo(where === 'big' ? { canvas: bigCv, video: bigVid } : { canvas: pipCv, video: pipVid });
    }
    function chrome(on) {
      root.classList.toggle('bare', !on); clearTimeout(hideT);
      if (on && S.view === 'active') hideT = setTimeout(function () { chrome(false); }, 4500);
    }
    root.addEventListener('click', function () { if (S.view === 'active') chrome(root.classList.contains('bare')); });

    function renderContacts() {
      list.replaceChildren(el('div', 'lt', 'Gọi video'));
      var box = el('div', 'cl'); list.append(box);
      A.contacts().then(function (l) {
        if (S.view !== 'contacts') return;
        if (!l.length) { box.append(el('div', 'empty', 'Chưa có màn hình hoặc trình duyệt nào khác để gọi.')); return; }
        l.forEach(function (c) {
          var r = el('button', 'ct'); r.type = 'button'; r.disabled = !!c.busy;
          var m = el('span', 'cm'); m.append(el('b', '', c.name), el('small', '', c.busy ? 'Đang bận' : c.kind === 'web' ? 'Trình duyệt' : 'Màn hình'));
          var call = el('span', 'cb'); call.append(svg('phone'));
          r.append(avatar(c.name), m, call);
          r.onclick = function () { A.start(c.id, c.name); };
          box.append(r);
        });
      }).catch(function () { box.append(el('div', 'empty', 'Không tải được danh bạ.')); });
    }

    function render() {
      clearInterval(tickT);
      if (S.view === 'in' && A.ringUrl) ringTone(A.ringUrl); else if (S.view === 'out') ringback(); else stopTones();
      root.dataset.view = S.view;
      list.hidden = S.view !== 'contacts';
      top.hidden = center.hidden = bar.hidden = S.view === 'contacts';
      camOffBox.hidden = true; pip.hidden = true; bigCv.hidden = false;
      center.replaceChildren(); bar.replaceChildren();
      if (S.view !== 'active' && remote) { remote.close(); remote = null; }
      if (S.view === 'contacts') { showSelf(null); bigCv.hidden = true; renderContacts(); chrome(true); return; }
      if (S.view === 'out' || S.view === 'in') {
        showSelf('big');
        center.append(avatar(S.peerName, true), el('div', 'cname', S.peerName || ''), el('div', 'csub', S.view === 'out' ? 'Đang gọi…' : 'Cuộc gọi video đến'));
        if (S.view === 'in') bar.append(rbtn('red', 'phone-hangup', 'Từ chối', function () { A.decline(); }), rbtn('green', 'phone', 'Nghe', function (b) { b.disabled = true; A.accept(); }));
        else bar.append(rbtn('red', 'phone-hangup', 'Hủy', function () { A.hangup(); }));
        top.hidden = true; chrome(true); return;
      }
      if (S.view === 'ended') {
        showSelf(null); bigCv.hidden = true;
        center.append(avatar(S.peerName, true), el('div', 'cname', S.peerName || ''), el('div', 'csub', S.reason || 'Cuộc gọi đã kết thúc'));
        top.hidden = true; chrome(true); return;
      }
      // active
      if (!remote) {
        S.gotVideo = false;
        remote = videoInto(bigCv, A.base + 'call/video?dev=' + encodeURIComponent(S.peer) + '&call=' + encodeURIComponent(S.call),
          function () { S.gotVideo = true; if (!S.peerCamOff) camOffBox.hidden = true; });
      }
      showSelf('pip'); pip.hidden = false;
      topName.textContent = S.peerName || '';
      var tick = function () { topSub.textContent = (S.peerMuted ? 'Đã tắt mic · ' : '') + fmt((Date.now() - (S.since || Date.now())) / 1000); };
      tick(); tickT = setInterval(tick, 1000);
      if (S.peerCamOff || !S.gotVideo) {
        camOffBox.replaceChildren(avatar(S.peerName, true), el('div', 'csub', S.peerCamOff ? 'Camera đã tắt' : 'Đang kết nối hình…'));
        camOffBox.hidden = false; if (S.peerCamOff) bigCv.hidden = true;
      }
      bar.append(
        rbtn('glass' + (muted ? ' on' : ''), muted ? 'microphone-off' : 'microphone', muted ? 'Bật mic' : 'Tắt mic', function () { muted = !muted; A.mute(muted); render(); }),
        rbtn('glass' + (camOff ? ' on' : ''), camOff ? 'video-off' : 'video', camOff ? 'Bật camera' : 'Tắt camera', function () { camOff = !camOff; A.cam(camOff); render(); }),
        rbtn('red', 'phone-hangup', 'Kết thúc', function () { A.hangup(); }));
      chrome(true);
    }
    return {
      set: function (st) {
        var changed = st.view !== S.view || st.peerCamOff !== S.peerCamOff || st.peerMuted !== S.peerMuted || st.call !== S.call;
        if (st.view !== 'active') { muted = false; camOff = false; }
        S = Object.assign({}, S, st);
        if (changed) render();
      },
      get: function () { return S; },
      toast: say,
    };
  }

  window.CallUI = { mount: mount, videoInto: videoInto, avatar: avatar };
})();
