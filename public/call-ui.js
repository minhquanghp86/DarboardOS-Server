// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// (14/10/2026) GIAO DIEN CUOC GOI VIDEO kieu dien thoai — dung chung cho call.html (man P4, trong Chromium cua add-on) va
// call-web.html (tab "Gọi" trong Dashboard). Trang goi CallUI.mount(root, adapter):
//   adapter = { self, base, contacts(): Promise<list>, start(to), accept(), decline(), hangup(), mute(on), cam(on),
//               selfVideo(el?): gan hinh cua minh vao khung nho (man: WS /call/video; web: <video> getUserMedia),
//               rename?(id, name), remove?(id, name): (GD8) SUA TEN / XOA thiet bi "Điện thoại" trong danh ba —
//               trang nao khong co 2 ham nay (vd call.html cua man) thi khong hien 2 nut nho,
//               log?(): (01/12/2026) NHAT KY CUOC GOI — chi co o call-web.html. Co `log` -> man danh ba co 2 TAB:
//               "Nhật ký" (mac dinh, tu cap nhat 5 s/lan) va "Thiết bị" (danh ba nhu cu). Trang khong co `log` (man P4,
//               call.html) giu nguyen giao dien cu (khong tab). }
//   va goi ui.set(state) moi khi trang thai doi: {view:'contacts'|'out'|'in'|'active'|'ended'|'join', call, peer, peerName,
//   since, peerMuted, peerCamOff, reason}. Sau khi sua/xoa thiet bi, trang goi ui.refresh() de ve lai danh ba.
//   (GD3) view 'join' = DIEN THOAI dang vao cuoc goi co san (call-web.html?call=<id>): hien ten nguoi goi + `sub`
//   (dang ket noi / loi quyen micro), nut "Kết thúc" va nut "Thử lại" khi `retry:true` (adapter.retry()).
//   `rev` (so bat ky): doi -> ve lai man hinh dang hien (vd co hinh camera cua minh sau khi xin quyen muon hon).
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
    // (01/12/2026) HAI TAB duoi header (chi trang co adapter.log): "Nhật ký" (mac dinh) + "Thiết bị".
    // Trang khong co `log` (call.html cua man P4) khong doi gi: danh ba cu, khong tab.
    var hasTabs = typeof A.log === 'function';
    var tabs = null, tabBar = [], logBox = null, tab = 'log', logT = 0, logSig = '';
    if (hasTabs) {
      root.classList.add('has-tabs');
      tabs = el('div', 'tabs');
      tabs.setAttribute('role', 'tablist');
      [['log', 'Nhật ký'], ['devices', 'Thiết bị']].forEach(function (kv) {
        var b = el('button', 'tb', kv[1]);
        b.type = 'button'; b.dataset.tab = kv[0]; b.setAttribute('role', 'tab');
        b.onclick = function () { pickTab(kv[0]); };
        tabBar.push(b); tabs.append(b);
      });
      logBox = el('div', 'loglist');
      logBox.hidden = true;
    }
    root.append(bigCv, bigVid, shade, camOffBox, pip, top, center, bar, list);
    if (hasTabs) root.append(tabs, logBox);
    root.append(toast);

    var S = { view: '' }, remote = null, remoteKey = '', selfFeed = null, tickT = 0, hideT = 0, muted = false, camOff = false, toastT = 0, waitT = 0;
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
      list.replaceChildren(el('div', 'lt', hasTabs ? 'Thiết bị' : 'Gọi video'));
      var box = el('div', 'cl'); list.append(box);
      A.contacts().then(function (l) {
        if (S.view !== 'contacts') return;
        if (!l.length) { box.append(el('div', 'empty', 'Chưa có màn hình hoặc trình duyệt nào khác để gọi.')); return; }
        l.forEach(function (c) {
          var r = el('button', 'ct'); r.type = 'button'; r.disabled = !!c.busy;
          var m = el('span', 'cm');
          // (30/10/2026) Phien web = "Trình duyệt" + CHAM XANH online (server tra `online: true` trong /calls/contacts):
          // thay ro day la thiet bi dang mo trang goi va goi duoc ngay (truoc day phu de la "Màn hình").
          var sub = el('small', '');
          if (c.kind === 'web' && c.online !== false) sub.append(el('i', 'on'));
          sub.append(document.createTextNode(c.busy ? 'Đang bận' : kindLabel(c.kind)));
          m.append(el('b', '', c.name), sub);
          var call = el('span', 'cb'); call.append(svg('phone'));
          r.append(avatar(c.name), m, call);
          r.onclick = function () { A.start(c.id, c.name); };
          // (GD8) Thiet bi "Điện thoại" (app Android da dang ky): them nut SUA TEN / XOA ngay trong danh ba.
          box.append(c.kind === 'phone' && A.rename && A.remove ? phoneRow(r, c) : r);
        });
      }).catch(function () { box.append(el('div', 'empty', 'Không tải được danh bạ.')); });
    }

    /** Nhan phu duoi ten: loai thiet bi. */
    function kindLabel(kind) {
      return kind === 'web' ? 'Trình duyệt' : kind === 'phone' ? 'Điện thoại' : 'Màn hình';
    }

    /** Mot dong danh ba cua DIEN THOAI: nut goi + 2 nut nho (but chi = sua ten, thung rac = xoa). */
    function phoneRow(main, c) {
      var w = el('div', 'ctw'), act = el('div', 'cact');
      var ed = el('button', 'ed'); ed.type = 'button'; ed.title = 'Đổi tên thiết bị';
      ed.setAttribute('aria-label', 'Đổi tên ' + c.name); ed.append(svg('pencil-outline'));
      ed.onclick = function (e) { e.stopPropagation(); A.rename(c.id, c.name); };
      var del = el('button', 'del'); del.type = 'button'; del.title = 'Xoá thiết bị';
      del.setAttribute('aria-label', 'Xoá ' + c.name); del.append(svg('delete-outline'));
      del.onclick = function (e) { e.stopPropagation(); A.remove(c.id, c.name); };
      act.append(ed, del);
      w.append(main, act);
      return w;
    }

    // ── (01/12/2026) TAB "Nhật ký" / "Thiết bị" ────────────────────────────────────────────────────────────
    /** Chon tab (nut bam). Chi ve lai khi dang o man danh ba. */
    function pickTab(k) {
      tab = k === 'devices' ? 'devices' : 'log';
      if (S.view === 'contacts') showTab();
    }
    /** Ve noi dung tab dang chon + bat/tat tu cap nhat nhat ky (5 s/lan, chi khi dang mo tab Nhật ký). */
    function showTab() {
      if (!tabs) { renderContacts(); return; }
      tabBar.forEach(function (b) {
        var on = b.dataset.tab === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var isLog = tab === 'log';
      list.hidden = isLog;
      logBox.hidden = !isLog;
      clearInterval(logT); logT = 0;
      if (isLog) {
        renderLog(false);
        logT = setInterval(function () { if (S.view === 'contacts' && tab === 'log') renderLog(true); }, 5000);
      } else {
        renderContacts();
      }
    }
    /** Nhat ky cuoc goi (server: GET /calls/log?self=<id>) — moi nhat truoc; `quiet` = cap nhat ngam, chi ve khi doi. */
    function renderLog(quiet) {
      if (!logBox) return;
      Promise.resolve().then(function () { return A.log(); }).then(function (items) {
        items = items || [];
        if (S.view !== 'contacts' || tab !== 'log') return;
        var sig = items.map(function (i) { return i.id + i.state + i.endedAt + i.peerId; }).join('|');
        if (quiet && sig === logSig) return;
        logSig = sig;
        logBox.replaceChildren(el('div', 'lt', 'Nhật ký'));
        if (!items.length) {
          logBox.append(el('div', 'empty', 'Chưa có cuộc gọi nào. Mở tab “Thiết bị” để gọi màn hình, điện thoại hoặc trình duyệt khác.'));
          return;
        }
        var boxL = el('div', 'lg');
        items.forEach(function (it) { boxL.append(logRow(it)); });
        logBox.append(boxL);
      }).catch(function () {
        if (quiet || S.view !== 'contacts' || tab !== 'log') return;
        logBox.replaceChildren(el('div', 'lt', 'Nhật ký'), el('div', 'empty', 'Không tải được nhật ký.'));
      });
    }
    /** Mot dong nhat ky: mui ten (goi di ↖ xanh / goi den ↙ xanh la / nho ↙ do), ten thiet bi, thoi gian, thoi luong. */
    function logRow(it) {
      var answered = it.state === 'answered';
      var cls = it.dir === 'out' ? 'out' : (answered ? 'in' : 'missed');
      var row = el('button', 'lr');
      row.type = 'button';
      row.title = (it.peerName || it.peerId) + ' · ' + whenOf(it.endedAt || it.startedAt) + ' · ' + stateText(it);
      var ico = el('span', 'li ' + cls);
      ico.append(svg(it.dir === 'out' ? 'arrow-top-right' : 'arrow-bottom-left'));
      var m = el('span', 'lm'), sub = el('small', '');
      sub.append(el('i', 'st ' + it.state), document.createTextNode(whenOf(it.endedAt || it.startedAt) + ' · ' + kindLabel(it.peerKind)));
      m.append(el('b', '', it.peerName || it.peerId || '?'), sub);
      row.append(ico, m, el('span', 'lv' + (answered ? '' : ' bad'), stateText(it)));
      if (it.peerId) row.onclick = function () { A.start(it.peerId, it.peerName); };   // bam 1 muc = GOI LAI thiet bi do
      else row.disabled = true;
      return row;
    }
    /** Thoi luong 00:42 (hoac 1:02:03) / "Nhỡ" / "Từ chối" / "Đã huỷ" / "Lỗi". */
    function stateText(it) {
      if (it.state === 'answered') return dur(it.durationMs || (it.endedAt - it.startedAt));
      if (it.state === 'missed') return 'Nhỡ';
      if (it.state === 'declined') return 'Từ chối';
      if (it.state === 'cancelled') return 'Đã huỷ';
      return 'Lỗi';
    }
    function dur(ms) {
      var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
      return (h ? h + ':' : '') + p2(m) + ':' + p2(x);
    }
    /** Thoi gian tuong doi: "Hôm nay 14:32" / "Hôm qua 14:32" / "05/03". */
    function whenOf(ts) {
      var t = Number(ts) || 0;
      if (!t) return '';
      var d = new Date(t), now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      var hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
      if (t >= today) return 'Hôm nay ' + hm;
      if (t >= today - 86400000) return 'Hôm qua ' + hm;
      return p2(d.getDate()) + '/' + p2(d.getMonth() + 1);
    }

    function render() {
      clearInterval(tickT);
      clearTimeout(waitT);
      clearInterval(logT); logT = 0;                       // (01/12/2026) chi chay khi dang mo tab "Nhật ký"
      if (S.view === 'in' && A.ringUrl) ringTone(A.ringUrl); else if (S.view === 'out') ringback(); else stopTones();
      root.dataset.view = S.view;
      list.hidden = S.view !== 'contacts';
      if (tabs) { tabs.hidden = S.view !== 'contacts'; logBox.hidden = true; }
      top.hidden = center.hidden = bar.hidden = S.view === 'contacts';
      camOffBox.hidden = true; pip.hidden = true; bigCv.hidden = false;
      center.replaceChildren(); bar.replaceChildren();
      if (S.view !== 'active' && remote) { remote.close(); remote = null; remoteKey = ''; }
      if (S.view === 'contacts') {
        // (01/12/2026) Man danh ba co 2 tab: "Nhật ký" (mac dinh) | "Thiết bị" (danh ba nhu cu).
        showSelf(null); bigCv.hidden = true; showTab(); chrome(true); return;
      }
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
      // (GD3) DIEN THOAI vao cuoc goi co san: ten nguoi goi + trang thai (dang bat micro / bi chan quyen).
      if (S.view === 'join') {
        showSelf(null); bigCv.hidden = true;
        center.append(avatar(S.peerName, true), el('div', 'cname', S.peerName || 'Cuộc gọi đến'), el('div', 'csub', S.sub || 'Đang kết nối…'));
        bar.append(rbtn('red', 'phone-hangup', 'Kết thúc', function () { A.hangup(); }));
        if (S.retry && A.retry) bar.append(rbtn('green', 'microphone', 'Thử lại', function (b) { b.disabled = true; A.retry(); }));
        top.hidden = true; chrome(true); return;
      }
      // active
      // (17/11/2026) GD9 — SUA LOI P4 KHONG HIEN HINH khi goi dien thoai: `S.peer` doi tu ID MAY sang phien web
      // (`web-…`) ngay sau khi trang cua dien thoai `join`. Truoc day khung hinh chi tao MOT lan (theo id may) nen
      // socket bi server dong (4004) roi noi lai mai mai voi dia chi CU -> chi thay "Đang kết nối hình…".
      // Nay: doi nguon (peer/call) -> dong ket noi cu, mo lai voi dia chi MOI.
      var vsrc = A.base + 'call/video?dev=' + encodeURIComponent(S.peer) + '&call=' + encodeURIComponent(S.call);
      if (remote && remoteKey !== vsrc) { remote.close(); remote = null; }
      if (!remote) {
        S.gotVideo = false;
        remoteKey = vsrc;
        remote = videoInto(bigCv, vsrc,
          function () { S.gotVideo = true; if (!S.peerCamOff) camOffBox.hidden = true; clearTimeout(waitT); });
        // Khong nhan duoc khung nao sau 8 s: noi ro ly do thay vi de "Đang kết nối hình…" vo han.
        clearTimeout(waitT);
        waitT = setTimeout(function () {
          if (S.view !== 'active' || S.gotVideo || S.peerCamOff) return;
          camOffBox.replaceChildren(avatar(S.peerName, true),
            el('div', 'csub', 'Chưa nhận được hình từ bên kia'), el('div', 'csub', 'Máy bên kia cần bật camera (chỉ có tiếng thì vẫn nghe được).'));
          camOffBox.hidden = false;
        }, 8000);
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
        var changed = st.view !== S.view || st.peerCamOff !== S.peerCamOff || st.peerMuted !== S.peerMuted || st.call !== S.call
          || st.peer !== S.peer        // (17/11/2026) GD9: nguon hinh doi (id may -> phien web) -> noi lai /call/video
          || st.rev !== S.rev;   // (GD3) `rev` = ve lai man hinh dang hien (vd hinh camera cua minh den muon)
        if (st.view !== 'active') { muted = false; camOff = false; }
        S = Object.assign({}, S, st);
        if (changed) render();
      },
      get: function () { return S; },
      /** (GD8) Ve lai danh ba (sau khi sua ten / xoa thiet bi — set() chi ve lai khi trang thai DOI). */
      refresh: function () { if (S.view === 'contacts') showTab(); },
      toast: say,
    };
  }

  window.CallUI = { mount: mount, videoInto: videoInto, avatar: avatar };
})();
