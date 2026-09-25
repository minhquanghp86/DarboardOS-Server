// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import { CDPSession } from "playwright-core";
import sharp from "sharp";
import { DeviceConfig, deviceConfigsEqual } from "./config.js";
import { getRoot } from "./cdpRoot.js";
import { FrameProcessor } from "./frameProcessor.js";
import { DeviceBroadcaster } from "./broadcaster.js";
import { hash32 } from "./util.js";
import { metrics } from "./metrics.js";
import { AdaptiveState, DEFAULT_ADAPTIVE_CFG, LinkEstimate, decideAdaptive, initialAdaptiveState, updateLinkEstimate } from "./adaptive.js";
import { SelfTestRunner } from "./selfTest.js";
import { tuning } from "./tuning.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLauncherApps, GROUP_TITLES, LAUNCHER_TIMER_URL, LAUNCHER_WEATHER_URL } from "./launcherApps.js";
import { getWeatherMini, onWeatherMiniUpdate } from "./weatherMini.js";
import { ControlField, DeviceStateInfo, Encoding, FRAME_HEADER_BYTES, TILE_HEADER_BYTES, parseDeviceStatePacket } from "./protocol.js";

// ── Type-safe interface cho CDP root (thay thế cast `any`) ────────────────────
interface CDPRoot {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  session(sessionId: string): CDPSession;
}

export type DeviceSession = {
  id: string;
  deviceId: string;
  cdp: CDPSession;
  cfg: DeviceConfig;
  url: string;
  lastActive: number;
  frameId: number;
  prevFrameHash: number;
  processor: FrameProcessor;
  selfTestRunner: SelfTestRunner;

  pendingB64?: string;
  throttleTimer?: NodeJS.Timeout;
  lastProcessedMs?: number;
  /** (17/09/2026) han che tan suat log canh bao ap luc nguoc */
  lastBacklogLogMs?: number;
  /**
   * (23/09/2026) KHOA MOT KHUNG MOT LUC.
   *
   * `flushPending` la ham async khong he tu loai tru. Nhip duoc ep bang
   * `lastProcessedMs` — danh moc NGAY KHI BAT DAU (sua loi 17/09) — nhung moc
   * do chi bao dam KHOANG CACH GIUA HAI LAN BAT DAU, khong bao dam lan truoc
   * da xong. Khi nen mot khung ton 146ms ma nhip dieu tiet la 50ms thi cu
   * 50ms lai co them mot flushPending chay CHONG LEN cai dang chay.
   *
   * Do that tren addon 2.9.18 (P4, 571 giay): encodeMsTotal = 629 giay tren
   * uptime 400 giay — hon 100% thoi gian tuong, chi co the giai thich bang
   * chong cheo. Hai hau qua: (1) 2-3 duong ong sharp tranh CPU nen khung nao
   * cung cham hon; (2) `processor._prev` (bang bam tile) bi hai lan chay cung
   * sua -> vi sai tinh sai -> khung rach.
   */
  flushInFlight?: boolean;

  // (17/09/2026) GIA TRI DA DIEU TIET — TACH HAN khoi `cfg`.
  //
  // Truoc day runAdaptiveTick ghi thang vao `device.cfg.minFrameInterval`. Hai
  // hau qua nghiem trong, do duoc tren thiet bi that:
  //   1. `cfg` la ban sao DUY NHAT cua "thiet bi yeu cau gi" (tu tham so URI).
  //      Ghi de no lam deviceConfigsEqual() o ensureDeviceAsync SAI ngay lan noi
  //      lai ke tiep (cfg=400 vs URI=100) -> di nhanh "Reconfiguring" ->
  //      deleteDeviceAsync() -> DUNG LAI CA TARGET CHROMIUM. Tuc la chinh hanh
  //      dong dieu tiet tu bao dam phien thiet bi se bi pha huy khi noi lai.
  //   2. Phien moi lay lai cfg goc (100ms/q70) trong khi adaptiveStates van nho
  //      "da kich san" -> decideAdaptive tra changed=false -> gia tri da ha
  //      KHONG BAO GIO duoc ap lai. Thiet bi chay full tai vinh vien con vong
  //      dieu khien thi tuong minh da ha tai xong.
  // Nay `cfg` bat bien; moi dieu tiet nam o day.
  tunedMinFrameIntervalMs?: number;

  // (17/09/2026) Thoi diem cuoi cung nhan su kien cham tu thiet bi.
  // Do muot CHI thuc su quan trong khi nguoi dung DANG thao tac — vuot, cuon,
  // bam. Tab camera treo tuong thi 2.5fps khong ai de y. Trong
  // INTERACTION_BOOST_MS sau moi lan cham, bo qua nhip da dieu tiet va chay o
  // nhip GOC (tran fps thiet bi yeu cau), sau do tra ve muc da dieu tiet.
  lastInputMs?: number;

  // Cải tiến: theo dõi lỗi frame liên tiếp để tự phục hồi
  consecutiveFrameErrors: number;

  // (16/09/2026) Đường tắt "chuyển thẳng JPEG của Chrome" — xem flushPending
  recentFrameMs: number[];
  passthroughFrames: number;
  passthroughOn: boolean;

  // (24/09/2026) Khung VIDEO nua do phan giai cho thiet bi bao ?half=1 — xem flushPending.
  halfOn: boolean;
  halfFrames: number;
  /** Anh Chrome cua khung video gan nhat — dung de gui lai ban NET khi video dung. */
  lastVideoB64?: string;
  sharpTimer?: NodeJS.Timeout;
  /** Khung dang xu ly la ban "lam net lai" (khong tinh vao nhip, khong di nhanh video). */
  forceSharp: boolean;
  /** Anh thu nho xam 64x38 cua khung truoc — do ti le dien tich thay doi (nhan dien video). */
  prevThumb?: Buffer;
  /** Lan cuoi mot khung THOA dieu kien video (nhip + dien tich) — de giu che do video mot luc. */
  halfLastQualifyMs?: number;
  /** Moc bat dau chuoi khung LIEN TIEP thoa dieu kien video (chua bat che do) — can keo dai HALF_SUSTAIN_MS. */
  halfStreakStartMs?: number;
  /** Gui NGAY ban net cua khung video cuoi (goi khi nguoi dung cham luc dang o che do video). */
  sharpenNow?: () => void;
  /** Ti le man hinh cua the <video> DANG PHAT lon nhat (hoi Chrome qua CDP, cache) — nhan dien video chac chan. */
  videoElArea?: number;
  videoProbeMs?: number;
  videoProbeBusy?: boolean;

  // (23/09/2026 v3) Id cua script launcher da dang ky qua
  // Page.addScriptToEvaluateOnNewDocument — can de GO BO va DANG KY LAI khi
  // homeUrl doi (xem nhanh "equal config" trong ensureDeviceAsync). homeUrl
  // KHONG nam trong deviceConfigsEqual() (co y, xem config.ts) nen doi no
  // khong lam "Reconfiguring"/pha Target — nhung cung vi vay phai tu tay
  // cap nhat script, server khong tu lam lai viec nay.
  launcherScriptId?: string;
  /** (25/09/2026) Trang thai thiet bi bao len (DeviceState): do sang, am luong, gio — cho menu va dong ho. */
  devState?: DeviceStateInfo & { receivedAt: number };
  /** (25/09/2026) Hen gio cua menu — giu o SERVER nen van reo khi nguoi dung da chuyen trang. */
  timer?: { endsAt: number; label: string; handle: NodeJS.Timeout };
};

// (23/09/2026) SUA LOI: "man ngu tu bat lai nhung khong hien gi, phai vuot
// lan 2" — chi xay ra sau khi da xem camera (che do passthrough) roi Go Home
// ve dashboard tinh, ngu, roi thuc.
//
// Nguyen nhan: flushPending() lay `dev.prevFrameHash` de BO QUA khung TRUNG
// HET VOI KHUNG TRUOC (xem check `if (dev.prevFrameHash === h32) return;`
// ngay dau flushPending, o TREN CA nhanh passthrough lan nhanh thuong). Khung
// "nudge" ma server tu ve khi thiet bi resume() (mot the <div> 2x2px, opacity
// 0.004 doi mau — xem nudgeRepaintAsync) qua nho: sau khi Chrome nen JPEG,
// xac suat cao no round-trip ve BYTE Y HET khung tinh truoc luc ngu -> h32
// TRUNG -> flushPending tra ve SOM, khong bao gio cham toi doan
// requestFullFrame() da dat san -> thiet bi ket "man den" cho toi khi nguoi
// dung tu tay cham that (tao ra thay doi diem anh lon, khong the trung hash).
//
// Sua tan goc: MOI LAN xin full frame, VO HIEU HOA LUON prevFrameHash bang
// gia tri khong bao gio trung that (-1 — hash32() luon >>> 0 nen >= 0). Nho
// vay khung ke tiep, du trung byte tuyet doi voi khung cu, VAN duoc xu ly.
export function requestFullFrameFor(dev: DeviceSession): void {
  dev.processor.requestFullFrame();
  dev.prevFrameHash = -1;
}

const PREFERS_REDUCED_MOTION = /^(1|true|yes|on)$/i.test(process.env.PREFERS_REDUCED_MOTION ?? '');
const BROWSER_LOCALE = process.env.BROWSER_LOCALE || 'en-US';

// Cải tiến: giới hạn số device đồng thời, đọc từ env, mặc định 8
const MAX_DEVICES = Math.max(1, parseInt(process.env.MAX_DEVICES ?? '8', 10) || 8);

// Cải tiến: số lỗi frame liên tiếp trước khi tự restart device
const MAX_CONSECUTIVE_FRAME_ERRORS = 10;

// Cải tiến: JPEG quality cho Chrome screencast (giảm tải CPU encode phía server)
// PNG → JPEG: Chrome encode JPEG trực tiếp, bỏ bước sharp decode PNG → raw RGBA
const SCREENCAST_JPEG_QUALITY = Math.min(100, Math.max(1,
  parseInt(process.env.SCREENCAST_JPEG_QUALITY ?? '90', 10) || 90
));
// (16/09/2026) Đường tắt "chuyển thẳng JPEG của Chrome" — xem giải thích đầy đủ
// trong flushPending. Bật khi nhịp screencast đủ cao (nội dung động kiểu video),
// vì khi đó khung nào cũng sẽ là full-frame.
//
// TẮT HẲN tính năng này: đặt PASSTHROUGH_MIN_FPS = 0 (không phải một số rất
// lớn như 99999). Một ngưỡng cực cao chỉ khiến điều kiện chuyển mạch thực tế
// (dòng "fps >= PASSTHROUGH_MIN_FPS" bên dưới) không bao giờ đạt được, nhưng
// `canPassthrough` (dùng để chọn screencastQuality — xem flushPending) vẫn
// coi là true vì nó chỉ kiểm tra "> 0". Kết quả: ảnh vẫn bị encode ở chất
// lượng đích của thiết bị (cfg.jpegQuality) thay vì SCREENCAST_JPEG_QUALITY,
// dù đường tắt không bao giờ thực sự kích hoạt — khác hành vi so với tắt
// thật bằng 0. (Phát hiện khi debug sống trên addon 17/09/2026.)
const PASSTHROUGH_MIN_FPS = Math.max(0, parseFloat(process.env.PASSTHROUGH_MIN_FPS ?? '8') || 0);
const PASSTHROUGH_RATE_WINDOW = 6; // số khung gần nhất dùng để tính nhịp
// (24/09/2026) Video dung bao lau (khong co khung moi) thi gui lai khung cuoi o do phan giai day du.
const SHARP_REFRESH_MS = Math.max(100, parseInt(process.env.SHARP_REFRESH_MS ?? '700', 10) || 700);
// (24/09/2026) 5/3 -> 2,5/1,5: tieu chi video THAT la dien tich thay doi (ben duoi); nhip chi de loai trang tinh.
// Do that: sau khi thiet bi khoi dong lai, server bat dau o nhip than trong 200-275 ms (< 4 fps) -> khong bao
// gio dat 5 fps -> khong vao che do video -> thiet bi xu ly cham -> nhip khong tang (vong luan quan).
const HALF_ON_FPS = Math.max(0.5, parseFloat(process.env.HALF_ON_FPS ?? '2.5') || 2.5);
const HALF_OFF_FPS = Math.max(0.5, parseFloat(process.env.HALF_OFF_FPS ?? '1.5') || 1.5);
// Ti le dien tich man hinh thay doi giua hai khung: > HALF_ON_AREA moi coi la video; dang o che do video thi
// giu toi khi <= HALF_KEEP_AREA.
const HALF_ON_AREA = 0.35;
const HALF_KEEP_AREA = 0.2;
// (24/09/2026 toi) Dien tich thay doi KHONG du tin cay: trang xem YouTube 1024x600, khung video chi ~39% man hinh,
// giua 2 khung lien tiep chi 0-22% diem anh doi ro (canh san khau cham), cong don 1 s cung chi 3-39% -> video test
// khong bao gio vao che do nua. Hoi thang Chrome: co the <video> DANG PHAT chiem >= HALF_VIDEO_EL_AREA man hinh
// thi la video. Anh dong/GIF tren dashboard khong phai <video> nen van net. Dien tich giu lai cho video trong iframe.
const HALF_VIDEO_EL_AREA = 0.2;
const VIDEO_PROBE_MS = 500;
const VIDEO_PROBE_JS = `(() => {
  const W = innerWidth, H = innerHeight; let best = 0;
  for (const v of document.querySelectorAll('video')) {
    if (v.paused || v.ended || v.readyState < 3) continue;
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    best = Math.max(best, (w * h) / (W * H));
  }
  return best;
})()`;
// (25/09/2026) Nguoi dung chon DU DO PHAN GIAI (do net cao) -> mac dinh KHONG gui khung video 1/2 nua, ke ca khi
// thiet bi bao ?half=1 (firmware P4 van bat half_scale_video vi ly do khac — xem YAML). Bat lai: HALF_SCALE_VIDEO=1.
const HALF_SCALE_VIDEO = process.env.HALF_SCALE_VIDEO === '1';
const HALF_HOLD_MS = Math.max(0, parseInt(process.env.HALF_HOLD_MS ?? '3000', 10) || 3000);
// Thay doi lon phai keo dai lien tuc bao lau moi coi la video (loai hieu ung chuyen tab).
const HALF_SUSTAIN_MS = Math.max(0, parseInt(process.env.HALF_SUSTAIN_MS ?? '1000', 10) || 1000);
// Sau moi lan cham man hinh, bao lau KHONG dung nua do phan giai.
const HALF_AFTER_TOUCH_MS = Math.max(0, parseInt(process.env.HALF_AFTER_TOUCH_MS ?? '2000', 10) || 2000);

// (17/09/2026) Ngưỡng áp lực ngược: số byte còn kẹt trong bộ đệm gửi của
// WebSocket mà trên mức đó thì BỎ khung mới thay vì dồn thêm. Một full-frame
// 1024x600 ở quality 70 vào khoảng 100-150KB, nên 192KB ~ "đang nợ hơn một
// khung" — đủ rộng để không phản ứng thái quá với biến động bình thường.
// (17/09/2026) Cua so "dang thao tac" sau moi su kien cham.
const INTERACTION_BOOST_MS = Math.max(0,
  parseInt(process.env.CCR_INTERACTION_BOOST_MS ?? '2000', 10) || 0
);

// (17/09/2026) KHOI DONG THAN TRONG.
//
// Tu khi min_frame_interval doi vai tro thanh "TRAN fps mong muon" (33ms =
// 30fps), moi lan thiet bi HOAC server khoi dong lai deu bat dau o ngay tran do
// va doi 30fps cho toi khi vong dieu tiet keo xuong (~55 giay). Trong khoang do
// loopTask cua ESPHome bi doi, thiet bi khong phuc vu noi API -> ket noi HA don
// day 10 khe max_connections -> thiet bi "mat tich" tren HASS. Da xay ra that.
//
// Nguyen tac: BAT DAU CHAM, TU KIEM CHUNG ROI MOI NHANH LEN. Phien moi khoi dau
// o muc an toan nay; nhanh hoi phuc (LIFO) se rut dan ve tran ma thiet bi yeu
// cau khi no chung minh duoc la theo kip.
const SAFE_START_INTERVAL_MS = Math.max(0,
  parseInt(process.env.CCR_SAFE_START_MS ?? '200', 10) || 0
);

const WS_HIGH_WATER_BYTES = Math.max(
  16_384,
  parseInt(process.env.CCR_WS_HIGH_WATER ?? '196608', 10) || 196608
);

const devices = new Map<string, DeviceSession>();
let _cleanupRunning = false;
let _codecVerified = false;
export const broadcaster = new DeviceBroadcaster();

// ============================================================
// Keyboard + Telex IME — embedded as TS template literal.
// Rules: no backticks inside JS, CSS uses string concat,
//        backslash chars use \\u005C unicode escape.
//
// Cải tiến:
//   - Thay window.__vkb* global bằng closure-private _shield object
//     → tránh xung đột với script khác trong trang HA
//   - Thay document.execCommand (deprecated) bằng Selection/Range API
//     cho insertText và delete trong contentEditable
//   - Cải thiện tonePos() để xử lý đúng vị trí thanh cho các vần
//     có nhiều nguyên âm liên tiếp (uyên, oai, uya, ươi...)
//     theo quy tắc: ưu tiên nguyên âm "chính" (vị trí âm tiết chuẩn)
// ============================================================
const KIOSK_KEYBOARD_SCRIPT = `(function(){
  var VKB_WIDTH  = '100%';
  var VKB_HEIGHT = '196px';
  if (window.__kioskKeyboardInitialized) return;
  window.__kioskKeyboardInitialized = true;

  // Cải tiến: dùng closure-private object thay vì window.__vkb* globals
  var _shield = { closing: 0, opening: 0, lastTap: 0 };

  var keyboardContainer = null;
  var currentLayout    = 'default';
  var activeInput      = null;
  var isShifted        = false;
  var isVietnamese     = false;
  var telexWord        = '';
  var commitOnEnterOnly = true;

  function commitInput(){
    if(!activeInput) return;
    activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    console.log('[VKB] Commit input');
  }

  var layouts = {
    default: [
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l'],
      ['\\u21E7','z','x','c','v','b','n','m','\\u232B'],
      ['\\u25BC','?123','VN','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ],
    shift: [
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['\\u21E7','Z','X','C','V','B','N','M','\\u232B'],
      ['\\u25BC','?123','VN','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ],
    symbols: [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['@','#','$','%','&','*','-','+','(',')'],
      ['ABC','!','"',"'",':', ';','/','?','\\u232B'],
      ['\\u25BC','=\\u005C<',',','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ],
    extended: [
      ['~','|','^','_','=','{','}','[',']','\\u2713'],
      ['<','>','\\u00A3','\\u20AC','\\u00A2','\\u00B0','\\u00B1','\\u00F7','\\u00D7','\\u005C'],
      ['?123','\\u21B9','\\u00A9','\\u00AE','\\u2122','\\u00BF','\\u00A1','\\u00A7','\\u232B'],
      ['\\u25BC','ABC',',','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ]
  };

  /* ---- Telex engine ----------------------------------------
     tone index: 0=flat 1=sac 2=huyen 3=hoi 4=nga 5=nang      */
  var TONE_KEYS = {s:1, f:2, r:3, x:4, j:5, z:0};

  var TONE_MAP = {
    'a'        :['a',        '\\u00E1','\\u00E0','\\u1EA3','\\u00E3','\\u1EA1'],
    '\\u0103'  :['\\u0103',  '\\u1EAF','\\u1EB1','\\u1EB3','\\u1EB5','\\u1EB7'],
    '\\u00E2'  :['\\u00E2',  '\\u1EA5','\\u1EA7','\\u1EA9','\\u1EAB','\\u1EAD'],
    'e'        :['e',        '\\u00E9','\\u00E8','\\u1EBB','\\u1EBD','\\u1EB9'],
    '\\u00EA'  :['\\u00EA',  '\\u1EBF','\\u1EC1','\\u1EC3','\\u1EC5','\\u1EC7'],
    'i'        :['i',        '\\u00ED','\\u00EC','\\u1EC9','\\u0129','\\u1ECB'],
    'o'        :['o',        '\\u00F3','\\u00F2','\\u1ECF','\\u00F5','\\u1ECD'],
    '\\u00F4'  :['\\u00F4',  '\\u1ED1','\\u1ED3','\\u1ED5','\\u1ED7','\\u1ED9'],
    '\\u01A1'  :['\\u01A1',  '\\u1EDB','\\u1EDD','\\u1EDF','\\u1EE1','\\u1EE3'],
    'u'        :['u',        '\\u00FA','\\u00F9','\\u1EE7','\\u0169','\\u1EE5'],
    '\\u01B0'  :['\\u01B0',  '\\u1EE9','\\u1EEB','\\u1EED','\\u1EEF','\\u1EF1'],
    'y'        :['y',        '\\u00FD','\\u1EF3','\\u1EF7','\\u1EF9','\\u1EF5']
  };

  var VI = {};
  (function(){
    for (var b in TONE_MAP) {
      var a = TONE_MAP[b];
      for (var t = 0; t < a.length; t++) VI[a[t]] = {b:b, t:t};
    }
  })();

  function vi(c) { return VI[c] || null; }

  function modVowel(oldCh, newBase) {
    var v = vi(oldCh);
    var t = v ? v.t : 0;
    return TONE_MAP[newBase] ? TONE_MAP[newBase][t] : newBase;
  }

  function strip(word) {
    var t=0, w='';
    for (var i=0; i<word.length; i++) {
      var v=vi(word[i]);
      if(v){ if(v.t>0) t=v.t; w+=v.b; } else w+=word[i];
    }
    return {w:w, t:t};
  }

  // Cải tiến: tonePos() theo quy tắc vị trí thanh chuẩn tiếng Việt
  // Ưu tiên: â,ê,ô,ơ,ư,ă (nguyên âm có dấu phụ) trước a,e,i,o,u,y
  // Với vần có nhiều nguyên âm: ưu tiên nguyên âm đứng trước âm cuối
  // Ví dụ: uyên → đặt thanh vào ê; uya → đặt vào y; ươi → đặt vào ơ
  var VOWEL_PRIORITY = {
    '\\u00E2':2,'\\u00EA':2,'\\u00F4':2,
    '\\u01A1':2,'\\u01B0':2,'\\u0103':2,
    'a':1,'e':1,'i':1,'o':1,'u':1,'y':1
  };

  function tonePos(word) {
    // Tìm tất cả vị trí nguyên âm
    var vowelPositions = [];
    for (var i=0; i<word.length; i++) {
      var v = vi(word[i]);
      var base = v ? v.b : word[i];
      if (VOWEL_PRIORITY[base] !== undefined) {
        vowelPositions.push({ idx: i, base: base, pri: VOWEL_PRIORITY[base] });
      }
    }
    if (vowelPositions.length === 0) return -1;
    if (vowelPositions.length === 1) return vowelPositions[0].idx;

    // Nếu có nguyên âm có dấu phụ (priority 2), ưu tiên nó
    var high = vowelPositions.filter(function(p){ return p.pri === 2; });
    if (high.length > 0) return high[0].idx;

    // Với vần thuần (a/e/i/o/u/y): áp dụng quy tắc âm tiết mở/đóng
    // Nếu nguyên âm cuối KHÔNG có phụ âm sau → đặt thanh ở nguyên âm cuối nhóm
    // Nếu có phụ âm cuối (âm tiết đóng) → đặt thanh ở nguyên âm đầu nhóm
    var lastVowelIdx = vowelPositions[vowelPositions.length - 1].idx;
    var hasConsonantAfter = lastVowelIdx < word.length - 1;
    if (hasConsonantAfter) {
      // Âm tiết đóng: đặt ở nguyên âm đầu nhóm
      return vowelPositions[0].idx;
    } else {
      // Âm tiết mở: đặt ở nguyên âm kế cuối nếu có 2+ nguyên âm, cuối nếu chỉ có 1
      if (vowelPositions.length >= 2) {
        return vowelPositions[vowelPositions.length - 2].idx;
      }
      return vowelPositions[vowelPositions.length - 1].idx;
    }
  }

  function telex(word, key) {
    var last  = word.length > 0 ? word[word.length-1] : '';
    var lv    = vi(last);
    var lBase = lv ? lv.b : last;

    if (key in TONE_KEYS) {
      var newT = TONE_KEYS[key];
      var s = strip(word);
      var pos = tonePos(s.w);
      if (pos < 0) return null;
      var applyT = (s.t === newT) ? 0 : newT;
      var vb = vi(s.w[pos]) ? vi(s.w[pos]).b : s.w[pos];
      var nc = TONE_MAP[vb] ? TONE_MAP[vb][applyT] : s.w[pos];
      return s.w.slice(0,pos) + nc + s.w.slice(pos+1);
    }

    if (key === 'd') {
      if (last === 'd')        return word.slice(0,-1) + '\\u0111';
      if (last === '\\u0111')  return word.slice(0,-1) + 'd';
      return null;
    }

    if (key === 'a' && lBase === 'a') {
      return word.slice(0,-1) + modVowel(last, (lv && lv.b==='\\u00E2') ? 'a' : '\\u00E2');
    }
    if (key === 'e' && lBase === 'e') {
      return word.slice(0,-1) + modVowel(last, (lv && lv.b==='\\u00EA') ? 'e' : '\\u00EA');
    }
    if (key === 'o' && lBase === 'o') {
      return word.slice(0,-1) + modVowel(last, (lv && lv.b==='\\u00F4') ? 'o' : '\\u00F4');
    }

    if (key === 'w') {
      if (word.length>=2 && lBase==='o') {
        var prev=word[word.length-2]; var pv=vi(prev);
        if (pv && pv.b==='u') return word.slice(0,-2) + modVowel(prev,'\\u01B0') + last;
      }
      if (lBase==='a')       return word.slice(0,-1)+modVowel(last,'\\u0103');
      if (lBase==='\\u0103') return word.slice(0,-1)+modVowel(last,'a');
      if (lBase==='o')       return word.slice(0,-1)+modVowel(last,'\\u01A1');
      if (lBase==='\\u01A1') return word.slice(0,-1)+modVowel(last,'o');
      if (lBase==='u')       return word.slice(0,-1)+modVowel(last,'\\u01B0');
      if (lBase==='\\u01B0') return word.slice(0,-1)+modVowel(last,'u');
      return null;
    }

    return null;
  }

  // Cải tiến: telexReplace dùng Selection/Range API thay execCommand (deprecated)
  function insertTextModern(el, text) {
    if (el.isContentEditable) {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      var val=el.value||'', s=el.selectionStart||0, e=el.selectionEnd||0;
      el.value=val.slice(0,s)+text+val.slice(e);
      el.selectionStart=el.selectionEnd=s+text.length;
    }
  }

  function deleteCharModern(el) {
    if (el.isContentEditable) {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      if (!range.collapsed) {
        range.deleteContents();
      } else if (range.startOffset > 0) {
        range.setStart(range.startContainer, range.startOffset - 1);
        range.deleteContents();
      }
    } else {
      var val2=el.value||'', s2=el.selectionStart||0, e2=el.selectionEnd||0;
      if(s2===e2&&s2>0){ el.value=val2.slice(0,s2-1)+val2.slice(e2); el.selectionStart=el.selectionEnd=s2-1; }
      else if(s2!==e2){ el.value=val2.slice(0,s2)+val2.slice(e2); el.selectionStart=el.selectionEnd=s2; }
    }
  }

  function telexReplace(newWord) {
    if (!activeInput) return;
    var dc = telexWord.length;
    if (activeInput.isContentEditable) {
      // Cải tiến: dùng Selection/Range thay execCommand
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        var range = sel.getRangeAt(0);
        // Xóa dc ký tự trước cursor
        for (var i=0; i<dc; i++) {
          if (range.startOffset > 0) {
            range.setStart(range.startContainer, range.startOffset - 1);
            range.deleteContents();
          }
        }
        var node = document.createTextNode(newWord);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      var val=activeInput.value||'', pos=activeInput.selectionStart||0;
      var from=Math.max(0,pos-dc);
      activeInput.value=val.slice(0,from)+newWord+val.slice(pos);
      activeInput.selectionStart=activeInput.selectionEnd=from+newWord.length;
    }
    telexWord=newWord;
  }

  function resetTelex(){ telexWord=''; }

  /* ---- DOM ------------------------------------------------- */
  function ensureDOM() {
    if(!document.body||!document.head) return false;
    if(!document.getElementById('kiosk-vkb-style')){
      var st=document.createElement('style');
      st.id='kiosk-vkb-style';
      st.textContent=
        '#kiosk-vkb-container{position:fixed !important;top:auto !important;bottom:-200vh !important;'+
        'left:0 !important;right:0 !important;margin:0 auto !important;'+
        'width:'+VKB_WIDTH+' !important;height:'+VKB_HEIGHT+' !important;'+
        'container-type:size;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;'+
        'display:flex;flex-direction:column;padding:4px;box-sizing:border-box;'+
        'user-select:none;-webkit-user-select:none;font-family:sans-serif;touch-action:manipulation;border:none;}'+
        '#kiosk-vkb-container:popover-open{display:flex;}'+
        '#kiosk-vkb-container.vkb-visible{bottom:0 !important;}'+
        '.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;flex:1;}'+
        '.vkb-row:last-child{margin-bottom:0;}'+
        '.vkb-key{flex:1;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;'+
        'font-size:11.5cqh;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}'+
        '.vkb-key:active{background:#555;}'+
        '.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:9cqh;}'+
        '.vkb-key-layout:active{background:#233544;}'+
        '.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:11cqh;}'+
        '.vkb-key-special:active{background:#364538;}'+
        '.vkb-key-large-icon{font-size:15cqh;}'+
        '.vkb-key-backspace{font-size:18cqh;}'+
        '.vkb-key-hide{background:#8b3a3a;color:#e2e8f0;font-size:12.5cqh;}'+
        '.vkb-key-hide:active{background:#6b2a2a;}'+
        '.vkb-key-enter{background:#E95420;color:#fff;border-color:#c94618;font-size:12.5cqh;}'+
        '.vkb-key-enter:active{background:#c94618;}'+
        '.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}'+
        '.vkb-key-vn{font-size:8.5cqh !important;}'+
        '.vkb-key-vn-on{background:#1a5c1a !important;color:#7fff7f !important;}';
      document.head.appendChild(st);
    }
    if(!keyboardContainer){
      keyboardContainer=document.createElement('div');
      keyboardContainer.id='kiosk-vkb-container';
      if(keyboardContainer.popover!==undefined) keyboardContainer.popover='manual';
      renderKeyboard();
    }
    if(!document.body.contains(keyboardContainer)) document.body.appendChild(keyboardContainer);
    return true;
  }

  function renderKeyboard(){
    if(!keyboardContainer) return;
    // Khong dung innerHTML='' — trang co Trusted Types CSP (vd accounts.google.com)
    // chan thang tay gan chuoi vao innerHTML, nem TypeError va lam crash showKeyboard()
    // giua chung (truoc khi kip them class vkb-visible) -> ban phim khong bao gio hien.
    while(keyboardContainer.firstChild) keyboardContainer.removeChild(keyboardContainer.firstChild);
    layouts[currentLayout].forEach(function(row){
      var rd=document.createElement('div');
      rd.className='vkb-row';
      row.forEach(function(key){
        var btn=document.createElement('button');
        btn.className='vkb-key';
        btn.textContent=(key==='Space')?'':key;
        btn.dataset.key=key;
        if(['?123','ABC','=\\u005C<'].includes(key)) btn.classList.add('vkb-key-layout');
        if(['\\u21E7','\\u232B','\\u25C4','\\u25BA','\\u21B9'].includes(key)) btn.classList.add('vkb-key-special');
        if(['\\u21E7','\\u21B9'].includes(key)) btn.classList.add('vkb-key-large-icon');
        if(key==='\\u232B') btn.classList.add('vkb-key-backspace');
        if(key==='\\u25BC') btn.classList.add('vkb-key-hide');
        if(key==='Space')   btn.classList.add('vkb-key-space');
        if(key==='\\u25C4'||key==='\\u25BA') btn.classList.add('vkb-key-arrow');
        if(key==='\\u23CE') btn.classList.add('vkb-key-enter');
        if(key==='\\u21E7'&&isShifted){btn.style.background='#e2e8f0';btn.style.color='#121212';}
        if(key==='VN'){
          btn.classList.add('vkb-key-layout','vkb-key-vn');
          btn.textContent=isVietnamese?'VN\\u2713':'VN';
          if(isVietnamese) btn.classList.add('vkb-key-vn-on');
        }
        rd.appendChild(btn);
      });
      keyboardContainer.appendChild(rd);
    });
  }

  /* ---- Text insertion -------------------------------------- */
  function insertText(text){
    if(!activeInput) return;
    insertTextModern(activeInput, text);
  }

  /* ---- Process key ----------------------------------------- */
  function processKey(key){
    if(!activeInput) return;
    if(typeof activeInput.focus==='function') activeInput.focus();

    switch(key){
      case '\\u25BC': hideKeyboard(); resetTelex(); break;

      case '\\u21E7':
        isShifted=!isShifted; currentLayout=isShifted?'shift':'default'; renderKeyboard(); break;

      case 'VN':
        isVietnamese=!isVietnamese; resetTelex(); renderKeyboard(); break;

      case '?123':
        currentLayout='symbols'; isShifted=false; resetTelex(); renderKeyboard(); break;
      case 'ABC':
        currentLayout='default'; isShifted=false; resetTelex(); renderKeyboard(); break;
      case '=\\u005C<':
        currentLayout='extended'; isShifted=false; resetTelex(); renderKeyboard(); break;

      case '\\u21B9': insertText('\\t'); resetTelex(); break;

      case '\\u232B':
        // Cải tiến: dùng deleteCharModern thay execCommand
        deleteCharModern(activeInput);
        if(telexWord.length>0) telexWord=telexWord.slice(0,-1);
        break;

      case 'Space': insertText(' '); resetTelex(); break;

      case '\\u25C4':
        if(!activeInput.isContentEditable){ var s3=activeInput.selectionStart||0; if(s3>0) activeInput.selectionStart=activeInput.selectionEnd=s3-1; }
        resetTelex(); break;

      case '\\u25BA':
        if(!activeInput.isContentEditable){ var e3=activeInput.selectionEnd||0; if(e3<(activeInput.value||'').length) activeInput.selectionStart=activeInput.selectionEnd=e3+1; }
        resetTelex(); break;

      case '\\u23CE':
        if(activeInput.isContentEditable){
          // Cải tiến: dùng insertParagraph qua execCommand chỉ ở đây vì không có API tương đương
          // (insertParagraph vẫn còn được support tốt trong Chrome)
          document.execCommand('insertParagraph',false,null);
          activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
        } else if(activeInput.tagName==='TEXTAREA'){
          insertText('\\n');
        } else {
          var ev={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,composed:true,cancelable:true};
          activeInput.dispatchEvent(new KeyboardEvent('keydown',ev));
          activeInput.dispatchEvent(new KeyboardEvent('keypress',ev));
          activeInput.dispatchEvent(new KeyboardEvent('keyup',ev));
        }

        // ✅ CHỈ COMMIT Ở ĐÂY
        if (commitOnEnterOnly) {
          commitInput();
        }

        hideKeyboard();
        resetTelex();
        break;

      default:
        if(!key) break;
        var isLetter=/^[a-zA-Z]$/.test(key);
        if(isVietnamese&&(currentLayout==='default'||currentLayout==='shift')&&isLetter){
          var lk=key.toLowerCase();
          var nw=telex(telexWord,lk);
          if(nw!==null){ telexReplace(nw); }
          else { insertText(key); telexWord+=lk; }
        } else {
          if(!isLetter) resetTelex();
          insertText(key);
        }
        if(isShifted&&isLetter){ isShifted=false; currentLayout='default'; renderKeyboard(); }
        break;
    }

    // ❌ KHÔNG gửi event mỗi phím nữa
    if (!commitOnEnterOnly && key!=='\\u23CE'&&key!=='\\u25BC'){
      activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    }
  }

  /* ---- Show / Hide ----------------------------------------- */
  function showKeyboard(el){
    activeInput=el; renderKeyboard();
    // Cải tiến: dùng _shield thay window.__vkbOpeningShield
    _shield.opening=Date.now();
    if(keyboardContainer.showPopover){
      if(keyboardContainer.matches(':popover-open')) keyboardContainer.hidePopover();
      keyboardContainer.showPopover();
    }
    keyboardContainer.classList.add('vkb-visible');
    if(activeInput&&activeInput.scrollIntoView) activeInput.scrollIntoView({behavior:'auto',block:'center'});
  }

  function hideKeyboard(){
    // Cải tiến: dùng _shield thay window.__vkbClosingShield
    _shield.closing=Date.now();
    if(keyboardContainer){
      keyboardContainer.classList.remove('vkb-visible');
      if(keyboardContainer.hidePopover&&keyboardContainer.matches(':popover-open')) keyboardContainer.hidePopover();
    }
    if(activeInput&&activeInput.blur) activeInput.blur();
    activeInput=null; isShifted=false; currentLayout='default';
  }

  /* ---- Input resolver -------------------------------------- */
  var validTypes=['text','email','number','password','search','tel','url'];
  function resolveInput(path){
    for(var i=0;i<path.length;i++){
      var el=path[i]; if(!el||!el.tagName) continue;
      var t=el.tagName.toUpperCase();
      if(t==='INPUT'&&validTypes.includes(el.type)) return el;
      if(t==='TEXTAREA'||el.isContentEditable||(el.classList&&el.classList.contains('cm-content'))) return el;
      if(['HA-TEXTFIELD','HA-SEARCH-INPUT','HA-CODE-EDITOR','HA-SELECTOR-TEXT'].includes(t)){
        var inner=el.shadowRoot?el.shadowRoot.querySelector('input,textarea,[contenteditable="true"],.cm-content'):null;
        if(inner) return inner;
      }
    }
    return null;
  }

  function checkAndShow(e){
    var path=e.composedPath?e.composedPath():[e.target];
    var inp=resolveInput(path);
    if(inp&&ensureDOM()){
      var vis=keyboardContainer&&keyboardContainer.classList.contains('vkb-visible');
      if(activeInput!==inp||!vis) showKeyboard(inp);
    }
  }

  document.addEventListener('focusin',checkAndShow,true);
  document.addEventListener('click',checkAndShow,true);

  /* ---- Master event shield --------------------------------- */
  ['pointerdown','pointerup','mousedown','mouseup','click','touchstart','touchend'].forEach(function(ev){
    document.addEventListener(ev,function(e){
      // Cải tiến: dùng _shield thay window.__vkbClosingShield / __vkbOpeningShield / __vkbLastTap
      if(_shield.closing&&(Date.now()-_shield.closing<400)){
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return;
      }
      if(keyboardContainer&&keyboardContainer.classList.contains('vkb-visible')){
        var x=e.clientX,y=e.clientY;
        if(x===undefined&&e.changedTouches&&e.changedTouches.length>0){x=e.changedTouches[0].clientX;y=e.changedTouches[0].clientY;}
        if(x===undefined||y===undefined) return;
        var rect=keyboardContainer.getBoundingClientRect();
        if(y>=rect.top&&y<=rect.bottom&&x>=rect.left&&x<=rect.right){
          e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
          if(_shield.opening&&(Date.now()-_shield.opening<400)) return;
          if(['pointerdown','touchstart','mousedown','click'].includes(ev)){
            if(_shield.lastTap&&(Date.now()-_shield.lastTap<250)) return;
            _shield.lastTap=Date.now();
            var keys=keyboardContainer.querySelectorAll('.vkb-key'),found=null;
            for(var i=0;i<keys.length;i++){
              var kr=keys[i].getBoundingClientRect();
              if(y>=kr.top&&y<=kr.bottom&&x>=kr.left&&x<=kr.right){found=keys[i];break;}
            }
            if(found){
              var k=found.dataset.key;
              found.style.background='#555';
              setTimeout(function(){found.style.background='';},100);
              processKey(k);
            }
          }
          return;
        }
        if(ev==='pointerdown'){
          var p2=e.composedPath?e.composedPath():[e.target];
          if(!resolveInput(p2)) hideKeyboard();
        }
      }
    },true);
  });

  console.log('[VKB] Ready — Telex Vietnamese IME active.');
})();`;

// (23/09/2026) CAM AM THANH cho thiet bi KHONG khai bao speaker_id (hien
// tai: ca hai panel S3). Ly do ton tai: kien truc dung CHUNG mot tien trinh
// Chrome cho ca ba thiet bi -> CHUNG mot sink PulseAudio duy nhat (xem
// AUDIO-FEATURE-PLAN-2026-09-23.md muc 7.2 — da xac minh KHONG co cach nao
// tach am thanh theo tung tab/target tu ben ngoai trang: setSinkId() can
// HTTPS + cu chi nguoi dung that, CDP hoan toan khong co lenh "mute theo
// target" nao — da doi chieu truc tiep voi JSON spec goc cua giao thuc,
// khong chi mot ket qua tim kiem). Neu thiet bi khong co loa (S3) lo mo
// YouTube, am thanh trang do van chay vao sink chung va bi tron lan, gui
// NHAM sang loa cua thiet bi CO loa (P4) — nghe duoc la am thanh la khong
// khop voi hinh dang xem.
//
// Giai phap: khong can tach tien trinh Chrome (dat, phuc tap). Vi thiet bi
// khong co speaker_id KHONG BAO GIO can nghe duoc gi ca, chi can dam bao
// trang cua NO khong bao gio tao ra am thanh o tang nguon — ghi de thang
// len HTMLMediaElement.prototype (muted luon doc ra true, gan gi cung bi
// bo qua; volume luon doc ra 0, gan gi cung bi bo qua). Ap dung cho MOI
// <video>/<audio> hien co lan se duoc tao sau nay, khong can theo doi tung
// phan tu rieng le.
function buildAudioMuteScript(): string {
  return `(function(){
  if (window.__rwvAudioMuted) return;
  window.__rwvAudioMuted = true;
  try {
    var proto = HTMLMediaElement.prototype;
    Object.defineProperty(proto, 'muted', {
      get: function(){ return true; }, set: function(){}, configurable: true
    });
    Object.defineProperty(proto, 'volume', {
      get: function(){ return 0; }, set: function(){}, configurable: true
    });
  } catch (e) {}
})();`;
}

// (23/09/2026) Launcher: nut xo xuong dropdown chon "ung dung" (Home ve dashboard,
// YouTube; Camera va URL cho san — 24/09/2026 doi nut thanh tab hinh thang dinh mep
// tren, can giua, xem ben duoi). Tiem CUNG CO CHE voi
// ban phim (Page.addScriptToEvaluateOnNewDocument -> ton tai tren MOI trang,
// ke ca sau khi Go Home/doi URL). Rieng cua no, khong phai cua dashboard —
// noi tren cung du dang xem trang nao.
//
// homeUrl la GIA TRI RIENG TUNG THIET BI, thiet bi tu gui len qua tham so
// ket noi ?home= (xem build_ws_uri_ ben firmware) — server khong tu biet
// duoc theo cach nao khac, vi day von la cai dat chi song tren ESP32 ("Home
// URL"). Neu thieu (thiet bi cu chua OTA ban co ?home=), nut Home tu an,
// chi con YouTube.
// (25/09/2026) URL cac ung dung cua menu: xem src/launcherApps.ts (Camera P4 = cam.html?src=p4_panel qua go2rtc,
// Thoi tiet = weather.html...). Am lich dung chung public/lunar.js.
const LUNAR_JS = (() => {
  try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'lunar.js'), 'utf8'); }
  catch (e) { console.warn('[launcher] khong doc duoc lunar.js:', (e as Error).message); return ''; }
})();
// Ten binding CDP ma o "URL" goi ve server (Runtime.addBinding) — xem handleUserEnteredUrl.
const URL_BINDING = '__rwvSetDisplayUrl';

/**
 * (25/09/2026) Nguoi dung go URL o nut mo rong + Enter. Trang web bat ky cung goi duoc binding nay, nen chi nhan
 * http(s) va do dai hop ly (viec toi da no lam duoc = dieu huong, dieu ma location.href vốn da lam duoc).
 * Thiet bi co ?urlset=1 -> gui SetDisplayURL: thiet bi dat "URL hien thi" (HA thay), set_action mo trang qua
 * OpenURL nhu moi lan khac. Thiet bi cu -> server tu mo trang.
 */
function handleUserEnteredUrl(id: string, session: CDPSession, payload: unknown): void {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 1024) return;
  let url: URL;
  try { url = new URL(payload); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const dev = devices.get(id);
  if (dev?.cfg.urlSet && broadcaster.sendSetDisplayURL(id, url.href)) {
    console.log(`[launcher] ${id}: nguoi dung nhap URL ${url.href} -> gui thiet bi dat "URL hien thi"`);
    return;
  }
  console.log(`[launcher] ${id}: nguoi dung nhap URL ${url.href} -> server tu mo (thiet bi chua ho tro urlset)`);
  session.send('Page.navigate', { url: url.href }).catch((e: unknown) =>
    console.warn(`[launcher] ${id}: mo URL that bai:`, e));
}

// (25/09/2026) Thanh truot trong menu goi window.__rwvControl(JSON). Chi nhan dung hai truong, gia tri 0..100 (trang
// web bat ky cung goi duoc binding nay: viec toi da no lam duoc la doi do sang/am luong cua chinh man hinh nay).
const CONTROL_BINDING = '__rwvControl';

function handleMenuControl(id: string, payload: unknown): void {
  if (typeof payload !== 'string' || payload.length > 200) return;
  let msg: any;
  try { msg = JSON.parse(payload); } catch { return; }
  const dev = devices.get(id);
  if (!dev) return;
  if (msg?.hello) { pushDeviceStateToPage(dev); return; }
  if (msg?.timer) { handleTimer(dev, msg.timer); return; }
  const v = Number(msg?.v);
  if (!Number.isFinite(v) || v < 0 || v > 100) return;
  const FIELDS: Record<string, ControlField> = {
    b: ControlField.Brightness, v: ControlField.Volume,
    ns: ControlField.NoSleep, mu: ControlField.Mute, aec: ControlField.Aec,
  };
  const field = typeof msg?.f === 'string' ? FIELDS[msg.f] : undefined;
  if (field == null || !dev.cfg.devControl) return;
  broadcaster.sendDeviceControl(id, field, field >= ControlField.NoSleep ? (v ? 1 : 0) : v);
}

// (25/09/2026) HEN GIO: timer.html goi {timer:{sec,label}} / {timer:{cancel:1}}. Het gio: danh thuc man hinh (bat den
// nen qua DeviceControl), roi trang dang mo hien bao thuc toan man hinh + chuong (am thanh trang -> loa P4).
function handleTimer(dev: DeviceSession, t: any): void {
  if (dev.timer) { clearTimeout(dev.timer.handle); dev.timer = undefined; }
  const sec = Math.round(Number(t?.sec));
  if (!t?.cancel && Number.isFinite(sec) && sec >= 1 && sec <= 24 * 3600) {
    const label = typeof t?.label === 'string' ? t.label.slice(0, 40) : '';
    const handle = setTimeout(() => fireTimer(dev), sec * 1000);
    dev.timer = { endsAt: Date.now() + sec * 1000, label, handle };
    console.log(`[timer] ${dev.deviceId}: hen ${sec} s${label ? ` (${label})` : ''}`);
  }
  pushDeviceStateToPage(dev);
}

function fireTimer(dev: DeviceSession): void {
  const label = dev.timer?.label || '';
  dev.timer = undefined;
  console.log(`[timer] ${dev.deviceId}: HET GIO${label ? ` (${label})` : ''}`);
  if (dev.cfg.devControl) broadcaster.sendDeviceControl(dev.deviceId, ControlField.Brightness, dev.devState?.brightness ?? 100);
  pushDeviceStateToPage(dev);
  // Doi den nen bat + remote_webview resume (~0,5 s) roi moi hien bao thuc, de man hinh nhan duoc khung do.
  setTimeout(() => {
    dev.cdp.send('Runtime.evaluate', {
      expression: `window.__rwvAlarm && window.__rwvAlarm(${JSON.stringify(label)})`,
    }).catch(() => { });
  }, 1500);
}

onWeatherMiniUpdate(() => { for (const d of devices.values()) pushDeviceStateToPage(d); });

/** Thiet bi bao DeviceState -> luu lai, dua vao trang dang mo. */
export function onDeviceStatePacket(dev: DeviceSession, buf: Buffer): void {
  const st = parseDeviceStatePacket(buf);
  if (!st) return;
  dev.devState = { ...st, receivedAt: Date.now() };
  pushDeviceStateToPage(dev);
}

/**
 * Dua trang thai thiet bi vao launcher cua trang dang mo. Gio: gui DO LECH so voi dong ho server (skewMs) + mui gio
 * cua thiet bi -> trang tu tinh gio THIET BI moi giay ma khong can thiet bi gui lien tuc.
 */
function pushDeviceStateToPage(dev: DeviceSession): void {
  const s = dev.devState;
  const payload = {
    b: s?.brightness ?? null, v: s?.volume ?? null, on: s?.backlightOn ?? false, ctl: !!s && !!dev.cfg.devControl,
    tv: !!s?.timeValid, skewMs: s?.timeValid ? s.epoch * 1000 - s.receivedAt : 0, tz: s?.tzOffsetMin ?? 0,
    tg: s?.toggles ?? null,
    wx: getWeatherMini(),
    tm: dev.timer ? { endsAt: dev.timer.endsAt, label: dev.timer.label } : null,
  };
  dev.cdp.send('Runtime.evaluate', {
    expression: `window.__rwvDeviceState && window.__rwvDeviceState(${JSON.stringify(payload)})`,
  }).catch(() => { });
}

export function buildLauncherScript(homeUrl: string | undefined): string {
  const homeUrlJson = JSON.stringify(homeUrl || '');
  const apps = buildLauncherApps(homeUrl);
  return `${LUNAR_JS}
(function(){
  if (window.__launcherInitialized) return;
  window.__launcherInitialized = true;

  var HOME_URL = ${homeUrlJson};
  var URL_BINDING = ${JSON.stringify(URL_BINDING)};
  var CONTROL_BINDING = ${JSON.stringify(CONTROL_BINDING)};
  var WEATHER_URL = ${JSON.stringify(LAUNCHER_WEATHER_URL)};
  var TIMER_URL = ${JSON.stringify(LAUNCHER_TIMER_URL)};
  // (25/09/2026) Danh sach ung dung tinh o SERVER (src/launcherApps.ts): 3 nhom, nguoi dung them/an trong cau hinh addon.
  var APPS = ${JSON.stringify(apps)};
  var GROUPS = ${JSON.stringify(Object.entries(GROUP_TITLES))};

  var Z = 2147483647;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Ve icon bang DOM API (createElementNS), KHONG dung innerHTML — trang co
  // Trusted Types CSP (vd accounts.google.com) chan gan chuoi HTML truc tiep,
  // nem TypeError (khop loi da gap voi ban phim ao — xem renderKeyboard()).
  // Icon don sac (stroke/fill=currentColor), nen trong suot cho hop dropdown toi.
  function svgEl(tag, attrs){
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function makeAppIcon(app){
    var box = document.createElement('div');
    box.style.cssText = 'width:var(--rwv-ic);height:var(--rwv-ic);border-radius:24%;background:' + app.color +
      ';display:flex;align-items:center;justify-content:center;flex:none;' +
      'box-shadow:0 2px 6px rgba(0,0,0,0.35),inset 0 0 0 1px rgba(255,255,255,0.16)';
    var svg = svgEl('svg', { viewBox: '0 0 24 24', width: '60%', height: '60%' });
    svg.style.cssText = 'display:block;overflow:visible';
    function line(tag, attrs){
      var a = { fill: 'none', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      for (var k in attrs) a[k] = attrs[k];
      svg.appendChild(svgEl(tag, a));
    }
    var k = app.kind;
    if (k === 'home') {
      line('path', { d: 'M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' });
    } else if (k === 'youtube') {
      line('path', { d: 'M9 7v10l8.5-5z', fill: '#fff', stroke: 'none' });
    } else if (k === 'tiktok') {
      // Not nhac voi bong xanh/hong lech — nhan ra ngay tren nen toi.
      var shades = [['#25f4ee', '-0.9 -0.9'], ['#fe2c55', '0.9 0.9'], ['#fff', '0 0']];
      shades.forEach(function(sh){
        line('path', { d: 'M14 3v11.5a3.5 3.5 0 11-3.5-3.5', stroke: sh[0], transform: 'translate(' + sh[1] + ')' });
        line('path', { d: 'M14 3c0.6 2.6 2.4 4.2 5 4.4', stroke: sh[0], transform: 'translate(' + sh[1] + ')' });
      });
    } else if (k === 'camera') {
      line('path', { d: 'M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z' });
      line('circle', { cx: '12', cy: '13', r: '3.5' });
    } else if (k === 'browser') {
      line('circle', { cx: '12', cy: '12', r: '9' });
      line('path', { d: 'M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z' });
    } else if (k === 'weather') {
      // Mat troi nho sau dam may
      line('circle', { cx: '8', cy: '8', r: '3' });
      line('path', { d: 'M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7' });
      line('path', { d: 'M7 19a4 4 0 010-8 5 5 0 019.6 1.5A3.25 3.25 0 0117 19z', fill: app.color });
    } else if (k === 'cams') {
      line('rect', { x: '2.5', y: '4', width: '8.5', height: '7', rx: '1.5' });
      line('rect', { x: '13', y: '4', width: '8.5', height: '7', rx: '1.5' });
      line('rect', { x: '2.5', y: '13', width: '8.5', height: '7', rx: '1.5' });
      line('rect', { x: '13', y: '13', width: '8.5', height: '7', rx: '1.5' });
    } else if (k === 'scenes') {
      line('path', { d: 'M12 3l2.2 5.2L20 9l-4.3 3.8L17 18.5 12 15.6 7 18.5l1.3-5.7L4 9l5.8-.8z' });
    } else if (k === 'energy') {
      line('path', { d: 'M13 2L4 14h7l-1 8 9-12h-7z', fill: '#fff' });
    } else if (k === 'music') {
      line('circle', { cx: '12', cy: '12', r: '9' });
      line('path', { d: 'M10 8.5v7l5.5-3.5z', fill: '#fff' });
    } else if (k === 'radio') {
      line('rect', { x: '3', y: '8', width: '18', height: '12', rx: '2' });
      line('path', { d: 'M7 8l10-5' });
      line('circle', { cx: '15.5', cy: '14', r: '2.5' });
      line('path', { d: 'M6.5 12.5h4M6.5 15.5h4' });
    } else if (k === 'news') {
      line('rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' });
      line('path', { d: 'M7 8h10M7 12h10M7 16h6' });
    } else if (k === 'calendar') {
      line('rect', { x: '3', y: '5', width: '18', height: '16', rx: '2' });
      line('path', { d: 'M3 10h18M8 3v4M16 3v4' });
      line('path', { d: 'M12 13.5a2.5 2.5 0 11-1.2 4.7', stroke: '#fff' });
    } else if (k === 'timer') {
      line('circle', { cx: '12', cy: '13.5', r: '7.5' });
      line('path', { d: 'M12 9.5v4l2.5 2M9.5 2.5h5M19 6l1.5-1.5' });
    } else if (k === 'generic') {
      var tx = svgEl('text', { x: '12', y: '16.5', 'text-anchor': 'middle', fill: '#fff',
        'font-size': '13', 'font-weight': '700', 'font-family': 'system-ui,sans-serif' });
      tx.textContent = (app.label || '?').charAt(0).toUpperCase();
      svg.appendChild(tx);
    } else if (k === 'media') {
      line('path', { d: 'M9 18V5.5l11-2V16' });
      line('circle', { cx: '6', cy: '18', r: '3' });
      line('circle', { cx: '17', cy: '16', r: '3' });
    } else {
      line('rect', { x: '4', y: '4', width: '16', height: '16', rx: '3' });
    }
    box.appendChild(svg);
    return box;
  }

  // (24/09/2026) Nut dang GIOT NUOC treo tu mep tren, can giua (truoc: o vuong 34x34 goc
  // tren-phai). Hinh ve bang SVG path toan duong cong: hai ben bat dau TIEP TUYEN voi mep
  // tren roi cong mem vao trong, day tron — khong con goc nao. Mong (18px) ma van de nhin.
  // Phan tu bao ngoai cao 32px va trong suot: vung cham rong hon hinh ve.
  // (25/09/2026) 96x18 -> 104x22: du cho dong ho HH:MM (gio THIET BI, xem __rwvDeviceState) thay mui ten.
  var TAB_W = 104, TAB_H = 22;
  var btn = document.createElement('div');
  btn.id = '__rwv_launcher_btn';
  btn.style.cssText = [
    'position:fixed', 'top:0', 'left:50%', 'transform:translateX(-50%)',
    'width:' + (TAB_W + 24) + 'px', 'height:32px',
    'display:flex', 'align-items:flex-start', 'justify-content:center',
    'background:transparent', 'color:#fff',
    'z-index:' + Z, 'user-select:none',
    '-webkit-user-select:none', 'touch-action:manipulation'
  ].join(';');
  var tab = svgEl('svg', { viewBox: '0 0 ' + TAB_W + ' ' + TAB_H, width: String(TAB_W), height: String(TAB_H) });
  tab.style.cssText = 'display:block;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35))';
  // Giot nuoc: mep tren (0,0)-(96,0); hai ben uon tu tiep tuyen ngang -> doc xuong -> day tron
  // (dinh thap nhat (48,18)). Cac doan Bezier noi tiep co tiep tuyen lien tuc nen khong gay goc.
  tab.appendChild(svgEl('path', {
    d: 'M0 0H104C91 0 86 4 79 11C72 18 64 22 52 22C40 22 32 18 25 11C18 4 13 0 0 0Z',
    fill: 'rgba(20,20,20,0.6)'
  }));
  var chevron = svgEl('path', {
    d: 'M46 8l6 5 6-5', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  });
  tab.appendChild(chevron);
  btn.appendChild(tab);
  var clockEl = document.createElement('div');
  clockEl.style.cssText = ['position:absolute', 'top:1px', 'left:0', 'right:0', 'text-align:center', 'display:none',
    'font:600 14px/19px system-ui,-apple-system,Segoe UI,Roboto,sans-serif', 'letter-spacing:0.5px',
    'font-variant-numeric:tabular-nums', 'color:#fff', 'pointer-events:none'].join(';');
  btn.appendChild(clockEl);

  // (25/09/2026) POPUP: chiem 2/3 man hinh, cach deu 4 canh (le 1/6), tren lop phu mo. Cham ra ngoai popup -> an;
  // chon ung dung -> an roi mo. Kich thuoc theo vmin de vua ca P4 1024x600 lan panel 480x272. KHONG hieu ung dong:
  // moi khung hinh dong deu phai truyen qua mang toi man hinh. Nen popup DUC HOAN TOAN: 0,97 van de lo chu dashboard
  // toi phia sau (do that: chenh 4 muc sang, thay duoc tren nen HA toi).
  var overlay = document.createElement('div');
  overlay.id = '__rwv_launcher_overlay';
  overlay.style.cssText = ['position:fixed', 'inset:0', 'display:none', 'background:rgba(0,0,0,0.55)',
    'z-index:' + Z, 'touch-action:manipulation', '-webkit-user-select:none', 'user-select:none'].join(';');
  var popup = document.createElement('div');
  popup.id = '__rwv_launcher_popup';
  popup.style.cssText = ['position:absolute', 'left:16.667vw', 'top:16.667vh', 'width:66.667vw', 'height:66.667vh',
    'box-sizing:border-box', 'display:flex', 'flex-direction:column', 'gap:clamp(4px,2vmin,14px)',
    'padding:clamp(8px,3.5vmin,26px)', 'background:#181a20', 'border-radius:clamp(10px,3vmin,20px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.5)', 'color:#fff', 'font-family:sans-serif', 'overflow:hidden'].join(';');
  popup.style.setProperty('--rwv-ic', 'clamp(26px, 10vmin, 62px)');
  // (25/09/2026) BO CUC POPUP (tren -> duoi):
  //   1. HANG THONG TIN: gio lon + thu/ngay/am lich | chip hen gio | chip thoi tiet (cham -> ung dung)
  //   2. HANG DIEU KHIEN: thanh truot do sang/am luong + 3 nut tron (Luon sang, Tat tieng, Khu vong)
  //   3. UNG DUNG theo nhom (Nha / Giai tri / Tien ich), cuon duoc.
  // Hang 1-2 an cho toi khi co du lieu (panel cu khong bao trang thai -> chi con luoi ung dung nhu truoc).
  function el(tag, css){ var e = document.createElement(tag); if (css) e.style.cssText = css; return e; }
  function iconSvg(size, draw){
    var s = svgEl('svg', { viewBox: '0 0 24 24', width: '24', height: '24' });
    s.style.cssText = 'display:block;flex:none;width:' + size + ';height:' + size + ';pointer-events:none';
    draw(function(tag, attrs){
      var a = { fill: 'none', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      for (var k in attrs) a[k] = attrs[k];
      s.appendChild(svgEl(tag, a));
    });
    return s;
  }
  var CHIP_CSS = 'flex:none;display:none;align-items:center;gap:6px;padding:clamp(4px,1.3vmin,8px) clamp(8px,2.2vmin,14px);' +
    'border-radius:999px;background:rgba(255,255,255,0.09);cursor:pointer;font:600 clamp(11px,2.8vmin,17px) system-ui,sans-serif;' +
    'font-variant-numeric:tabular-nums;white-space:nowrap';

  var infoRow = el('div', 'flex:none;display:flex;align-items:center;gap:clamp(6px,1.8vmin,12px)');
  var timeBox = el('div', 'flex:none;display:none;min-width:0');
  var timeBig = el('div', 'font:600 clamp(18px,6.4vmin,40px)/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:0.5px');
  var dateEl = el('div', 'font-size:clamp(10px,2.4vmin,15px);opacity:0.65;margin-top:clamp(2px,0.6vmin,5px);white-space:nowrap');
  timeBox.appendChild(timeBig); timeBox.appendChild(dateEl);
  var timerChip = el('div', CHIP_CSS);
  timerChip.style.background = 'rgba(249,115,22,0.22)';
  timerChip.appendChild(iconSvg('1.1em', function(line){
    line('circle', { cx: '12', cy: '13.5', r: '7.5' }); line('path', { d: 'M12 9.5v4l2.5 2M9.5 2.5h5' });
  }));
  var timerTxt = el('span', ''); timerChip.appendChild(timerTxt);
  var wxChip = el('div', CHIP_CSS);
  var wxIcon = el('span', 'display:flex'); var wxTxt = el('span', '');
  wxChip.appendChild(wxIcon); wxChip.appendChild(wxTxt);
  infoRow.appendChild(timeBox); infoRow.appendChild(el('div', 'flex:1'));
  infoRow.appendChild(timerChip); infoRow.appendChild(wxChip);
  function go(url){ hidePopup(); location.href = url; }
  timerChip.addEventListener('click', function(e){ e.stopPropagation(); go(TIMER_URL); });
  wxChip.addEventListener('click', function(e){ e.stopPropagation(); go(WEATHER_URL); });

  // Bieu tuong thoi tiet thu gon theo ma WMO
  function wxDraw(code, day){
    return function(line){
      var cloud = 'M7 18a4 4 0 010-8 5 5 0 019.6 1.5A3.3 3.3 0 0117 18z';
      if (code <= 1) {
        if (day) { line('circle', { cx: '12', cy: '12', r: '4.5', fill: '#fbbf24', stroke: '#fbbf24' });
          line('path', { d: 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4', stroke: '#fbbf24' }); }
        else line('path', { d: 'M16 4a8 8 0 104 12.5A7 7 0 0116 4z', fill: '#e2e8f0', stroke: '#e2e8f0' });
      } else if (code <= 3 || code === 45 || code === 48) {
        line('path', { d: cloud, fill: '#cbd5e1', stroke: '#cbd5e1' });
      } else if (code >= 95) {
        line('path', { d: cloud, fill: '#94a3b8', stroke: '#94a3b8' }); line('path', { d: 'M12.5 13l-2 4h3l-2 4', stroke: '#fbbf24' });
      } else {
        line('path', { d: 'M7 14a4 4 0 010-8 5 5 0 019.6 1.5A3.3 3.3 0 0117 14z', fill: '#cbd5e1', stroke: '#cbd5e1' });
        line('path', { d: 'M8 17l-1 3M12 17l-1 3M16 17l-1 3', stroke: '#60a5fa' });
      }
    };
  }

  var ctlRow = el('div', 'flex:none;display:none;align-items:center;gap:clamp(6px,2vmin,14px)');
  var devState = null;
  function sendControl(obj){
    if (typeof window[CONTROL_BINDING] === 'function') { try { window[CONTROL_BINDING](JSON.stringify(obj)); } catch (e) {} }
  }
  function makeSlider(field, color, drawIcon){
    var track = el('div', ['position:relative', 'flex:1', 'min-width:0', 'height:clamp(30px,8.5vmin,50px)',
      'border-radius:clamp(9px,2.6vmin,16px)', 'background:rgba(255,255,255,0.12)', 'overflow:hidden',
      'touch-action:none', 'cursor:pointer'].join(';'));
    var fill = el('div', 'position:absolute;left:0;top:0;bottom:0;width:0;background:' + color);
    var ic = iconSvg('clamp(14px,4.2vmin,24px)', drawIcon);
    ic.style.position = 'absolute'; ic.style.left = 'clamp(8px,2.4vmin,16px)'; ic.style.top = '50%'; ic.style.transform = 'translateY(-50%)';
    var pct = el('div', 'position:absolute;right:clamp(8px,2.4vmin,16px);top:50%;transform:translateY(-50%);' +
      'font:600 clamp(10px,2.8vmin,17px) system-ui,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none');
    track.appendChild(fill); track.appendChild(ic); track.appendChild(pct);
    var s = { el: track, value: 0, dragging: false, releasedAt: 0, lastSent: 0, timer: null };
    function show(v){ s.value = v; fill.style.width = v + '%'; pct.textContent = v + '%'; }
    function fromX(x){
      var r = track.getBoundingClientRect();
      return Math.max(0, Math.min(100, Math.round((x - r.left) / r.width * 100)));
    }
    function send(final){
      var now = Date.now();
      clearTimeout(s.timer);
      if (final || now - s.lastSent >= 150) { s.lastSent = now; sendControl({ f: field, v: s.value }); }
      else s.timer = setTimeout(function(){ send(true); }, 150 - (now - s.lastSent));
    }
    track.addEventListener('pointerdown', function(e){
      e.preventDefault(); e.stopPropagation();
      s.dragging = true;
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
      show(fromX(e.clientX)); send(false);
    });
    track.addEventListener('pointermove', function(e){ if (s.dragging) { show(fromX(e.clientX)); send(false); } });
    function end(){ if (!s.dragging) return; s.dragging = false; s.releasedAt = Date.now(); send(true); }
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('click', function(e){ e.stopPropagation(); });
    // Trang thai thiet bi bao ve: bo qua luc dang keo va 1,5 s sau khi tha (goi bao ve co the con gia tri cu).
    s.set = function(v){ if (v == null || s.dragging || Date.now() - s.releasedAt < 1500) return; show(v); };
    return s;
  }
  // Nut tron bat/tat nhanh. Bam -> doi mau ngay (lac quan), bo qua trang thai cu trong 1,5 s.
  function makeToggle(field, onColor, drawIcon){
    var b = el('div', ['flex:none', 'width:clamp(30px,8.5vmin,50px)', 'height:clamp(30px,8.5vmin,50px)', 'border-radius:50%',
      'display:flex', 'align-items:center', 'justify-content:center', 'cursor:pointer', 'background:rgba(255,255,255,0.12)'].join(';'));
    b.appendChild(iconSvg('55%', drawIcon));
    var t = { el: b, on: false, at: 0 };
    function show(on){ t.on = on; b.style.background = on ? onColor : 'rgba(255,255,255,0.12)'; }
    b.addEventListener('click', function(e){
      e.stopPropagation();
      show(!t.on); t.at = Date.now();
      sendControl({ f: field, v: t.on ? 1 : 0 });
    });
    t.set = function(on){ if (Date.now() - t.at < 1500) return; show(!!on); };
    return t;
  }
  var briSlider = makeSlider('b', '#f59e0b', function(line){
    line('circle', { cx: '12', cy: '12', r: '4' });
    line('path', { d: 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' });
  });
  var volSlider = makeSlider('v', '#3b82f6', function(line){
    line('path', { d: 'M4 9h4l5-4v14l-5-4H4z', fill: '#fff' });
    line('path', { d: 'M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12' });
  });
  var tgWrap = el('div', 'flex:none;display:none;gap:clamp(4px,1.4vmin,10px)');
  var tgNoSleep = makeToggle('ns', '#f59e0b', function(line){        // Luon sang: con mat
    line('path', { d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' });
    line('circle', { cx: '12', cy: '12', r: '3' });
  });
  var tgMute = makeToggle('mu', '#ef4444', function(line){           // Tat tieng: loa gach cheo
    line('path', { d: 'M4 9h4l5-4v14l-5-4H4z', fill: '#fff' });
    line('path', { d: 'M16 9l5 6M21 9l-5 6' });
  });
  var tgAec = makeToggle('aec', '#10b981', function(line){           // Khu vong mic
    line('rect', { x: '9', y: '3', width: '6', height: '11', rx: '3' });
    line('path', { d: 'M5.5 11a6.5 6.5 0 0013 0M12 17.5V21' });
  });
  [tgNoSleep, tgMute, tgAec].forEach(function(t){ tgWrap.appendChild(t.el); });
  ctlRow.appendChild(briSlider.el);
  ctlRow.appendChild(volSlider.el);
  ctlRow.appendChild(tgWrap);

  // Gio + ngay (duong, am) theo GIO THIET BI: server gui do lech + mui gio, trang tu dem. Chi doi DOM khi doi phut.
  var WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  function pad2(n){ return (n < 10 ? '0' : '') + n; }
  function setText(e, s){ if (e.textContent !== s) e.textContent = s; }
  function updateClock(){
    if (!devState || !devState.tv) { clockEl.style.display = 'none'; chevron.style.display = ''; timeBox.style.display = 'none'; }
    else {
      var t = new Date(Date.now() + devState.skewMs + devState.tz * 60000);
      var hm = pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes());
      setText(clockEl, hm);
      setText(timeBig, hm);
      var dd = t.getUTCDate(), mm = t.getUTCMonth() + 1, yy = t.getUTCFullYear();
      var dt = WD[t.getUTCDay()] + ', ' + pad2(dd) + '/' + pad2(mm);
      if (window.RwvLunar) {
        var l = window.RwvLunar.solar2lunar(dd, mm, yy, 7);
        dt += ' · ' + l.day + '/' + l.month + (l.leap ? ' nhuận' : '') + ' âm lịch';
      }
      setText(dateEl, dt);
      if (clockEl.style.display !== 'block') { clockEl.style.display = 'block'; chevron.style.display = 'none'; }
      timeBox.style.display = 'block';
    }
    // Hen gio con lai
    var tm = devState && devState.tm;
    if (tm && tm.endsAt > Date.now()) {
      var rem = Math.ceil((tm.endsAt - Date.now()) / 1000);
      var h = Math.floor(rem / 3600), m = Math.floor(rem % 3600 / 60), s = rem % 60;
      setText(timerTxt, (h ? h + ':' + pad2(m) : m) + ':' + pad2(s));
      timerChip.style.display = 'flex';
    } else timerChip.style.display = 'none';
  }
  window.__rwvDeviceState = function(st){
    devState = st;
    window.__rwvLastState = st;
    ctlRow.style.display = st.ctl ? 'flex' : 'none';
    tgWrap.style.display = st.ctl && st.tg ? 'flex' : 'none';
    briSlider.set(st.b);
    volSlider.set(st.v);
    if (st.tg) { tgNoSleep.set(st.tg.noSleep); tgMute.set(st.tg.muted); tgAec.set(st.tg.aec); }
    if (st.wx) {
      while (wxIcon.firstChild) wxIcon.removeChild(wxIcon.firstChild);
      wxIcon.appendChild(iconSvg('1.35em', wxDraw(st.wx.code, st.wx.day)));
      setText(wxTxt, st.wx.t + '°' + (st.wx.pp != null && st.wx.pp >= 30 ? '  ☂ ' + st.wx.pp + '%' : ''));
      wxChip.style.display = 'flex';
    } else wxChip.style.display = 'none';
    updateClock();
    try { window.dispatchEvent(new CustomEvent('rwv-state', { detail: st })); } catch (e) {}
  };
  setInterval(updateClock, 1000);

  // Luoi ung dung theo nhom, cuon duoc
  var appsBox = el('div', 'flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:clamp(4px,1.6vmin,12px);touch-action:pan-y');
  function hidePopup(){ overlay.style.display = 'none'; }
  function showPopup(){ overlay.style.display = 'block'; }
  GROUPS.forEach(function(g){
    var list = APPS.filter(function(a){ return a.group === g[0]; });
    if (!list.length) return;
    var head = el('div', 'font-size:clamp(9px,2.2vmin,13px);font-weight:600;opacity:0.55;letter-spacing:0.06em;text-transform:uppercase');
    head.textContent = g[1];
    var grid = el('div', ['display:grid', 'grid-template-columns:repeat(auto-fill,minmax(calc(var(--rwv-ic) + 22px),1fr))',
      'gap:clamp(4px,1.6vmin,12px)'].join(';'));
    list.forEach(function(app){
      var tile = el('div', ['display:flex', 'flex-direction:column', 'align-items:center', 'gap:clamp(3px,1vmin,6px)',
        'padding:clamp(2px,0.8vmin,6px) 2px', 'border-radius:12px', 'cursor:pointer', 'min-width:0'].join(';'));
      tile.setAttribute('data-app', app.kind);
      tile.appendChild(makeAppIcon(app));
      var label = el('div', ['font-size:clamp(10px,2.5vmin,15px)', 'line-height:1.2', 'text-align:center', 'max-width:100%',
        'display:-webkit-box', '-webkit-line-clamp:2', '-webkit-box-orient:vertical', 'overflow:hidden',
        'overflow-wrap:anywhere'].join(';'));
      label.textContent = app.label;
      tile.appendChild(label);
      tile.addEventListener('click', function(e){
        e.stopPropagation();
        hidePopup();
        if (app.action === 'url') { openUrlBox(); return; }
        if (app.url) location.href = app.url;
      });
      grid.appendChild(tile);
    });
    appsBox.appendChild(head);
    appsBox.appendChild(grid);
  });
  popup.appendChild(infoRow);
  popup.appendChild(ctlRow);
  popup.appendChild(appsBox);

  // BAO THUC (het hen gio): lop phu toan man hinh + chuong WebAudio (am thanh trang -> loa P4). Cham de tat;
  // tu tat sau 2 phut.
  window.__rwvAlarm = function(label){
    var old = document.getElementById('__rwv_alarm'); if (old) old.remove();
    var ov = el('div', ['position:fixed', 'inset:0', 'z-index:' + Z, 'background:rgba(10,12,18,0.94)', 'color:#fff',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:3vmin',
      'font-family:system-ui,sans-serif', 'cursor:pointer'].join(';'));
    ov.id = '__rwv_alarm';
    ov.appendChild(iconSvg('18vmin', function(line){
      line('circle', { cx: '12', cy: '13.5', r: '7.5', stroke: '#f97316' }); line('path', { d: 'M12 9.5v4l2.5 2M9.5 2.5h5', stroke: '#f97316' });
    }));
    var t1 = el('div', 'font-size:8vmin;font-weight:700'); t1.textContent = 'Hết giờ!';
    var t2 = el('div', 'font-size:4vmin;opacity:0.75'); t2.textContent = label || 'Hẹn giờ đã kết thúc';
    var t3 = el('div', 'margin-top:3vmin;padding:2vmin 7vmin;border-radius:999px;background:#f97316;font-size:4.5vmin;font-weight:600');
    t3.textContent = 'Tắt';
    ov.appendChild(t1); ov.appendChild(t2); ov.appendChild(t3);
    var ctx = null, beep = null, stopAt = Date.now() + 120000;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      beep = setInterval(function(){
        if (Date.now() > stopAt) { stop(); return; }
        [0, 0.25, 0.5].forEach(function(dt){
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = 880; o.type = 'sine';
          g.gain.setValueAtTime(0.0001, ctx.currentTime + dt);
          g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + dt + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dt + 0.18);
          o.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime + dt); o.stop(ctx.currentTime + dt + 0.2);
        });
      }, 1500);
    } catch (e) {}
    function stop(){ clearInterval(beep); try { ctx && ctx.close(); } catch (e) {} ov.remove(); }
    ov.addEventListener('click', function(e){ e.stopPropagation(); stop(); });
    document.body.appendChild(ov);
  };
  overlay.appendChild(popup);
  popup.addEventListener('click', function(e){ e.stopPropagation(); });
  overlay.addEventListener('click', function(e){ e.stopPropagation(); hidePopup(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hidePopup(); }, true);

  // (25/09/2026) O NHAP URL. Dat sat mep tren (ban phim ao cao 196px o day man hinh; panel 480x272 chi con
  // ~76px phia tren). input type=url -> ban phim ao (KIOSK_KEYBOARD_SCRIPT) tu bat khi focus; phim Enter cua no
  // phat keydown 'Enter'. Chi dung DOM API (khong innerHTML — Trusted Types).
  var urlBox = null, urlInput = null;
  function normalizeUrl(raw){
    var t = (raw || '').trim();
    if (!t) return '';
    if (/^https?:\\/\\//i.test(t)) return t;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^\\/]+:\\d+(\\/|$)/.test(t)) return '';  // javascript:, file:... -> bo
    if (/\\s/.test(t) || (t.indexOf('.') < 0 && !/^localhost(:\\d+)?(\\/|$)/i.test(t)))
      return 'https://www.google.com/search?q=' + encodeURIComponent(t);
    // IP LAN / localhost -> http, con lai -> https
    if (/^(localhost|\\d{1,3}(\\.\\d{1,3}){3})(:\\d+)?(\\/|$)/i.test(t)) return 'http://' + t;
    return 'https://' + t;
  }
  function closeUrlBox(){ if (urlBox) urlBox.style.display = 'none'; }
  function submitUrl(){
    var url = normalizeUrl(urlInput.value);
    if (!url) { urlInput.style.outline = '2px solid #e55'; return; }
    closeUrlBox();
    // Binding cua server: server gui cho thiet bi (dat "URL hien thi") hoac tu mo trang neu thiet bi cu.
    if (typeof window[URL_BINDING] === 'function') { try { window[URL_BINDING](url); return; } catch (e) {} }
    location.href = url;
  }
  function makeBtn(text, bg){
    var b = document.createElement('div');
    b.textContent = text;
    // flex can giua: line-height bi CSS cua trang (vd HA) de len -> chu lech len mep tren nut.
    b.style.cssText = 'flex:none;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
      'min-width:44px;padding:0 14px;height:36px;line-height:1;border-radius:8px;cursor:pointer;' +
      'font:15px sans-serif;color:#fff;background:' + bg + ';user-select:none;-webkit-user-select:none';
    return b;
  }
  function openUrlBox(){
    if (!urlBox) {
      urlBox = document.createElement('div');
      urlBox.id = '__rwv_url_box';
      urlBox.style.cssText = [
        'position:fixed', 'top:8px', 'left:50%', 'transform:translateX(-50%)',
        'width:min(640px, calc(100vw - 16px))', 'box-sizing:border-box', 'display:none',
        'align-items:center', 'gap:8px', 'padding:6px', 'border-radius:10px',
        'background:rgba(30,30,30,0.95)', 'box-shadow:0 2px 10px rgba(0,0,0,0.4)', 'z-index:' + Z
      ].join(';');
      urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.id = '__rwv_url_input';
      urlInput.placeholder = 'Nh\u1eadp \u0111\u1ecba ch\u1ec9 web r\u1ed3i b\u1ea5m Enter';
      urlInput.autocomplete = 'off';
      urlInput.spellcheck = false;
      urlInput.style.cssText = 'flex:1;min-width:0;height:36px;box-sizing:border-box;padding:0 10px;border:none;' +
        'border-radius:8px;outline:none;font:16px sans-serif;color:#111;background:#fff';
      urlInput.addEventListener('keydown', function(e){
        if (e.key === 'Enter') { e.preventDefault(); submitUrl(); }
        else if (e.key === 'Escape') closeUrlBox();
      });
      urlInput.addEventListener('input', function(){ urlInput.style.outline = 'none'; });
      // pointerdown, KHONG phai click: ban phim ao dang hien thi -> pointerdown ngoai o nhap lam no an va bat
      // "la chan" 400 ms nuot click ngay sau (do that: bam X khong dong duoc o). pointerdown van toi nut.
      function onPress(el, fn){
        el.addEventListener('pointerdown', function(e){ e.preventDefault(); e.stopPropagation(); fn(); });
        el.addEventListener('click', function(e){ e.stopPropagation(); });
      }
      var go = makeBtn('M\u1edf', '#2a7de1');
      onPress(go, submitUrl);
      var cancel = makeBtn('\u2715', 'rgba(255,255,255,0.15)');
      onPress(cancel, closeUrlBox);
      urlBox.appendChild(urlInput);
      urlBox.appendChild(go);
      urlBox.appendChild(cancel);
      urlBox.addEventListener('click', function(e){ e.stopPropagation(); });
      document.body.appendChild(urlBox);
    }
    urlInput.value = '';
    urlInput.style.outline = 'none';
    urlBox.style.display = 'flex';
    // focus -> focusin -> ban phim ao hien
    setTimeout(function(){ urlInput.focus(); }, 30);
  }

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    if (overlay.style.display === 'block') hidePopup(); else showPopup();
  });

  function mount(){
    if (!document.body) { requestAnimationFrame(mount); return; }
    document.body.appendChild(btn);
    document.body.appendChild(overlay);
    // Xin server dua trang thai thiet bi (thanh truot, dong ho) ngay khi launcher san sang.
    sendControl({ hello: 1 });
  }
  mount();
})();`;
}

// ============================================
// HELPER: Setup viewport
// ============================================
async function setupStableViewport(
  session: CDPSession, width: number, height: number, maxRetries = 3
): Promise<boolean> {
  console.log(`[Viewport] Setting up ${width}x${height}`);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
        screenWidth: width, screenHeight: height, positionX: 0, positionY: 0
      });
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      try { await session.send('Emulation.setLocaleOverride', { locale: BROWSER_LOCALE }); } catch { }
      if (PREFERS_REDUCED_MOTION) {
        await session.send('Emulation.setEmulatedMedia', {
          media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
      }
      await new Promise(r => setTimeout(r, 300));
      const res = await session.send('Runtime.evaluate', {
        expression: `({width:window.innerWidth,height:window.innerHeight})`, returnByValue: true
      }) as { result?: { value?: { width: number; height: number } } };
      const sz = res.result?.value;
      if (sz) {
        console.log(`[Viewport] Attempt ${attempt}: got ${sz.width}x${sz.height}`);
        if (sz.width === width && sz.height === height) { console.log(`[Viewport] ✓`); return true; }
      }
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.warn(`[Viewport] ⚠️ Failed after ${maxRetries} attempts`);
  return false;
}

// ============================================
// HELPER: Codec check (once)
// ============================================
async function verifyCodecSupport(session: CDPSession): Promise<void> {
  if (_codecVerified) return;
  try {
    const r = await session.send('Runtime.evaluate', {
      expression: `(()=>{const v=document.createElement('video');return{h264:v.canPlayType('video/mp4;codecs="avc1.42E01E"')};})()`,
      returnByValue: true
    }) as { result?: { value?: { h264: string } } };
    const s = r.result?.value;
    if (s) {
      if (!s.h264) console.warn('⚠️  H.264 not supported — install google-chrome-stable');
      else console.log('✅ H.264 supported');
    }
    _codecVerified = true;
  } catch { }
}

// (23/09/2026 v2) UA that cua Chrome trong che do --headless=new van chua
// nguyen chu "HeadlessChrome/x.x.x.x" — con la dau hieu automation RO RANG
// hon ca viec UA bi lech phien ban (thu da bo o commit truoc, xem CHANGELOG
// V2.9.7). Khong the bo qua Emulation.setUserAgentOverride hoan toan; phai
// LAY DUNG UA THAT qua Browser.getVersion() (khong hardcode nhu ban cu —
// hardcode la nguon goc cua loi lech phien ban da sua) roi chi thay the
// "HeadlessChrome" -> "Chrome", giu nguyen moi phan con lai (bao gom so
// phien ban that) de luon tu khop moi lan Chrome trong image duoc cap nhat.
// Cache lai vi UA khong doi trong suot vong doi tien trinh Chrome.
let _cachedRealUA: string | null = null;
async function getRealChromeUserAgentAsync(session: CDPSession): Promise<string | null> {
  if (_cachedRealUA) return _cachedRealUA;
  try {
    const r = await session.send('Browser.getVersion', {}) as { userAgent?: string };
    if (r.userAgent) {
      _cachedRealUA = r.userAgent.replace('HeadlessChrome', 'Chrome');
    }
  } catch { }
  return _cachedRealUA;
}

// ============================================
// MAIN
// ============================================
export async function ensureDeviceAsync(id: string, cfg: DeviceConfig): Promise<DeviceSession> {
  const root = getRoot() as unknown as CDPRoot;
  if (!root) throw new Error("CDP not ready");

  // Cải tiến: giới hạn số device đồng thời
  if (!devices.has(id) && devices.size >= MAX_DEVICES) {
    throw new Error(
      `[device] Max device limit reached (${MAX_DEVICES}). ` +
      `Set MAX_DEVICES env var to increase. Current devices: ${[...devices.keys()].join(', ')}`
    );
  }

  let device = devices.get(id);
  if (device) {
    if (deviceConfigsEqual(device.cfg, cfg)) {
      device.lastActive = Date.now();
      requestFullFrameFor(device);

      // (25/09/2026) Thiet bi NOI LAI (khoi dong lai / OTA / watchdog WS): moi "nghen" ghi nhan TRUOC do la cua socket
      // CU (server van day du lieu vao socket da chet, ton dong toi 1,6 MB) — khong noi gi ve duong truyen. Do that sau
      // mot lan P4 khoi dong lai: nguong tranh nghen (probeFloorMs) ket o ~400 ms, moi 35 s chi hoi 17 ms -> YouTube
      // 2,8 fps hang chuc phut. Xoa nguong do, bat dau lai tu nhip an toan; bo dieu tiet se rut dan nhu binh thuong.
      const st = adaptiveStates.get(id);
      if (st) {
        st.probeFloorMs = undefined;
        st.probeBlocked = 0;
        st.goodStreak = 0;
        st.minFrameIntervalMs = Math.min(st.minFrameIntervalMs, Math.max(cfg.minFrameInterval, SAFE_START_INTERVAL_MS));
        device.tunedMinFrameIntervalMs = st.minFrameIntervalMs;
      }

      // (24/09/2026) halfScale / audioEnabled cung KHONG nam trong deviceConfigsEqual() (co dinh theo
      // firmware) -> nhanh nay tu giu gia tri cua LAN KET NOI DAU. Do that: server khoi dong lai truoc khi P4
      // OTA xong, phien duoc tao boi firmware CU (khong co half=1); firmware moi noi lai roi vao day va
      // halfScale ket o false vinh vien. Cung loai loi voi homeUrl ben duoi. Hai co nay khong can dung lai
      // gi (khong script/target nao phu thuoc) nen chi can gan lai.
      if (device.cfg.halfScale !== cfg.halfScale || device.cfg.audioEnabled !== cfg.audioEnabled ||
          device.cfg.urlSet !== cfg.urlSet || device.cfg.fbBands !== cfg.fbBands ||
          device.cfg.devControl !== cfg.devControl) {
        console.log(`[device] ${id}: cap nhat co firmware half=${cfg.halfScale} audio=${cfg.audioEnabled} urlset=${cfg.urlSet} fb=${cfg.fbBands}`);
        device.cfg = { ...device.cfg, halfScale: cfg.halfScale, audioEnabled: cfg.audioEnabled, urlSet: cfg.urlSet,
                       fbBands: cfg.fbBands, devControl: cfg.devControl };
        device.processor.setBandSplit(cfg.fbBands);
      }

      // (23/09/2026 v3) homeUrl KHONG nam trong deviceConfigsEqual() (co y —
      // xem config.ts) nen nhanh nay khong tu cap nhat no. Ket qua that do tren
      // may that: nut "Home" trong dropdown launcher bi ket vinh vien voi gia
      // tri cua LAN KET NOI DAU TIEN (thuong rong do dua tren firmware —
      // xem CHANGELOG V2.9.5), moi lan noi lai sau do (vd tu reconnect_ws()
      // firmware vua goi) deu roi vao day va bi bo qua. Phai tu tay go +
      // dang ky lai script KHI homeUrl thuc su doi, dong thoi ap dung NGAY
      // cho trang dang mo (khong doi navigate/reload moi thay).
      if (cfg.homeUrl !== device.cfg.homeUrl) {
        const oldHomeUrl = device.cfg.homeUrl;
        device.cfg = cfg;
        (async () => {
          try {
            if (device!.launcherScriptId) {
              await device!.cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
                identifier: device!.launcherScriptId,
              });
            }
            const { identifier } = await device!.cdp.send(
              'Page.addScriptToEvaluateOnNewDocument', { source: buildLauncherScript(cfg.homeUrl) }
            );
            device!.launcherScriptId = identifier;
            // Don nut/dropdown CU tren trang DANG MO (script moi chi ap dung
            // tu lan navigate ke tiep neu khong lam buoc nay) roi chay lai.
            await device!.cdp.send('Runtime.evaluate', {
              expression:
                `(function(){` +
                `var b=document.getElementById('__rwv_launcher_btn'); if(b) b.remove();` +
                `var p=document.getElementById('__rwv_launcher_overlay'); if(p) p.remove();` +
                `window.__launcherInitialized=false;` +
                `})();` + buildLauncherScript(cfg.homeUrl),
            });
            console.log(`[device] ✓ Launcher cap nhat homeUrl cho ${id}: "${oldHomeUrl || '(rong)'}" -> "${cfg.homeUrl}"`);
          } catch (e) {
            console.warn(`[device] ⚠️ Khong cap nhat duoc launcher homeUrl cho ${id}:`, e);
          }
        })();
      }

      return device;
    }
    console.log(`[device] Reconfiguring ${id}`);
    await deleteDeviceAsync(device);
  }

  const { targetId } = await root.send<{ targetId: string }>('Target.createTarget', {
    url: 'about:blank',
    // width/height removed: Chrome stable does not support
    // position params for new targets — viewport set via
    // Emulation.setDeviceMetricsOverride in setupStableViewport()
  });
  const { sessionId } = await root.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId, flatten: true
  });
  // Cải tiến: dùng CDPRoot interface thay cast `any`
  const session = root.session(sessionId);

  await session.send('Page.enable');

  // (23/09/2026) Thiet bi KHONG khai bao speaker_id (chua tu bao ?audio=1)
  // -> khong bao gio duoc phep tao ra am thanh that vao sink chung — xem
  // chu thich day du o buildAudioMuteScript(). PHAI tiem TRUOC bat ky script
  // nao khac va truoc ca lan dieu huong dau tien.
  if (!cfg.audioEnabled) {
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: buildAudioMuteScript() });
    console.log('[device] ✓ Da cam am thanh (thiet bi khong khai bao speaker_id)');
  }

  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: KIOSK_KEYBOARD_SCRIPT });
  console.log('[device] ✓ Keyboard + Telex IME registered');

  const { identifier: launcherScriptId } = await session.send(
    'Page.addScriptToEvaluateOnNewDocument', { source: buildLauncherScript(cfg.homeUrl) }
  );
  console.log(`[device] ✓ Launcher registered${cfg.homeUrl ? '' : ' (chua co homeUrl — chi hien YouTube)'}`);

  // (25/09/2026) O "URL" cua launcher goi window.__rwvSetDisplayUrl(url). Binding ton tai qua moi lan dieu huong.
  // Runtime.enable: can de nhan su kien Runtime.bindingCalled.
  try {
    await session.send('Runtime.enable');
    await session.send('Runtime.addBinding', { name: URL_BINDING });
    await session.send('Runtime.addBinding', { name: CONTROL_BINDING });
    session.on('Runtime.bindingCalled', (evt: any) => {
      if (evt?.name === URL_BINDING) handleUserEnteredUrl(id, session, evt.payload);
      else if (evt?.name === CONTROL_BINDING) handleMenuControl(id, evt.payload);
    });
    // (25/09/2026) Moi trang moi: dua lai trang thai thiet bi vao launcher (thanh truot, dong ho tren nut menu).
    session.on('Page.domContentEventFired', () => {
      const d = devices.get(id);
      if (d) pushDeviceStateToPage(d);
    });
  } catch (e) {
    console.warn(`[device] ⚠️ Khong dang ky duoc binding o URL cho ${id}:`, e);
  }

  const vpOk = await setupStableViewport(session, cfg.width, cfg.height);
  if (!vpOk) console.warn(`[device] ⚠️ Viewport mismatch ${cfg.width}x${cfg.height}`);

  await verifyCodecSupport(session);

  try {
    const realUA = await getRealChromeUserAgentAsync(session);
    if (realUA) {
      await session.send('Emulation.setUserAgentOverride', {
        userAgent: realUA,
        platform: 'Linux x86_64'
      });
    }
  } catch { }

  // Cải tiến: dùng format 'jpeg' thay 'png'
  // → Chrome encode JPEG trực tiếp, bỏ hoàn toàn bước sharp decode PNG → raw RGBA
  // → Giảm đáng kể CPU và memory trên server HASS addon
  // → SCREENCAST_JPEG_QUALITY có thể tuỉnh qua env SCREENCAST_JPEG_QUALITY (mặc định 90)
  // (16/09/2026) Chất lượng screencast chọn theo TỪNG thiết bị.
  //
  // Thiết bị có cap message đủ lớn để chứa cả khung (ví dụ P4: 256KB) sẽ dùng
  // đường tắt chuyển thẳng JPEG. Với chúng, ảnh của Chrome CHÍNH LÀ ảnh gửi đi,
  // nên phải encode ngay ở chất lượng đích — để q90 thì khung nặng hơn ~33% và
  // khi bị chặn băng thông thì fps tụt (đo thật: 26,4 → 20,1 fps). Encode thẳng
  // ở chất lượng đích vừa lấy lại fps vừa cho ảnh ĐẸP HƠN vì chỉ nén MỘT lần.
  //
  // Thiết bị cap nhỏ (S3: 32KB) không bao giờ đi được đường tắt — chúng luôn
  // phải giải nén rồi nén lại theo tile. Với chúng phải GIỮ ảnh nguồn chất
  // lượng cao, nếu hạ xuống q60 thì thành nén hai lần ở q60 = ảnh xấu đi.
  const canPassthrough = PASSTHROUGH_MIN_FPS > 0 && cfg.maxBytesPerMessage >= 131072;
  const screencastQuality = canPassthrough ? cfg.jpegQuality : SCREENCAST_JPEG_QUALITY;
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: screencastQuality,
    maxWidth: cfg.width,
    maxHeight: cfg.height,
    everyNthFrame: cfg.everyNthFrame,
  });
  console.log(`[device] Screencast format: jpeg, quality: ${screencastQuality}` + (canPassthrough ? ' (theo jpeg_quality cua thiet bi — co the di duong tat)' : ''));

  const processor = new FrameProcessor({
    tileSize: cfg.tileSize,
    fullframeTileCount: cfg.fullFrameTileCount,
    fullframeAreaThreshold: cfg.fullFrameAreaThreshold,
    jpegQuality: cfg.jpegQuality,
    fullFrameEvery: cfg.fullFrameEvery,
    maxBytesPerMessage: cfg.maxBytesPerMessage,
    bandSplit: cfg.fbBands,
  });

  metrics.setConfig(id, cfg);
  const newDevice: DeviceSession = {
    id: targetId, deviceId: id, cdp: session, cfg,
    url: '', lastActive: Date.now(), frameId: 0, prevFrameHash: 0,
    processor, selfTestRunner: new SelfTestRunner(broadcaster),
    pendingB64: undefined, throttleTimer: undefined, lastProcessedMs: undefined,
    lastBacklogLogMs: undefined,
    tunedMinFrameIntervalMs: Math.max(cfg.minFrameInterval, SAFE_START_INTERVAL_MS),
    lastInputMs: undefined,
    consecutiveFrameErrors: 0, // Cải tiến: tracking lỗi liên tiếp
    recentFrameMs: [], passthroughFrames: 0, passthroughOn: false,
    halfOn: false, halfFrames: 0, forceSharp: false,
    launcherScriptId,
  };
  devices.set(id, newDevice);
  requestFullFrameFor(newDevice);

  const flushPending = async () => {
    const dev = newDevice;
    dev.throttleTimer = undefined;
    // (23/09/2026) MOT KHUNG MOT LUC — xem `flushInFlight`. Khong BO khung o
    // day: `pendingB64` luon giu khung MOI NHAT, nen hen lai mot nhip ngan la
    // khung ke tiep van la khung moi nhat tai thoi diem do.
    if (dev.flushInFlight) {
      if (!dev.throttleTimer) dev.throttleTimer = setTimeout(flushPending, 10);
      return;
    }
    dev.flushInFlight = true;
    // (17/09/2026) SUA LOI DIEU NHIP: danh moc NGAY KHI BAT DAU, khong doi den
    // `finally`. Truoc day `throttleTimer` duoc xoa o dau ham nhung
    // `lastProcessedMs` chi cap nhat o CUOI — sau ~200ms encode. Trong khoang
    // trong do, khung screencast moi den se thay throttleTimer rong VA `since`
    // da lon hon nhip -> delay = 0 -> chay ngay. Nhip thuc te co lai con bang
    // thoi gian encode thay vi effInterval.
    // Do that: adaptive dat mfi=400 (le ra 2.5fps) nhung server van gui 3.93fps.
    // (25/09/2026) `finally` KHONG con ghi de moc nay — nhip tinh tu luc BAT DAU khung truoc (xem finally).
    dev.lastProcessedMs = Date.now();

    try {
      const b64 = dev.pendingB64;
      dev.pendingB64 = undefined;
      if (!b64) return;

      // (17/09/2026) ÁP LỰC NGƯỢC — bỏ khung khi thiết bị chưa tiêu hoá kịp.
      //
      // PHẢI chặn Ở ĐÂY, TRƯỚC processFrameAsync(). Nếu bỏ khung ở tầng
      // broadcaster thì FrameProcessor đã tính sai phân xong và coi như thiết bị
      // ĐÃ NHẬN các tile đó; vứt đi = vùng ảnh ấy hỏng vĩnh viễn cho tới full-frame
      // kế tiếp. Bỏ ở đây thì nền so sánh giữ nguyên, khung sau vẫn diff đúng.
      //
      // Bỏ nguyên khung (không bỏ một phần) để không bao giờ sinh khung rách.
      const backlog = broadcaster.backlogBytes(id);
      const highWater = tuning().wsHighWaterBytes ?? WS_HIGH_WATER_BYTES;
      if (backlog > highWater) {
        metrics.onFrameSkipped(id);
        dev.lastProcessedMs = Date.now();
        if (Date.now() - (dev.lastBacklogLogMs ?? 0) > 5000) {
          dev.lastBacklogLogMs = Date.now();
          console.warn(`[device] ${id}: bo khung, ton dong socket ${backlog}B > ${highWater}B`);
        }
        return;
      }

      // Cải tiến: xử lý JPEG thay PNG
      // Với format jpeg, Chrome gửi JPEG data trực tiếp.
      // sharp vẫn được dùng để rotation (nếu có) và decode sang raw RGBA cho FrameProcessor.
      // Nếu KHÔNG có rotation: giảm 1 bước decode (bỏ qua ensureAlpha vẫn hoạt động với JPEG).
      const imgBuf = Buffer.from(b64, 'base64');
      const h32 = hash32(imgBuf);
      if (dev.prevFrameHash === h32) {
        metrics.onFrameSkipped(id);
        dev.lastProcessedMs = Date.now();
        return;
      }
      dev.prevFrameHash = h32;

      // ════════════════════════════════════════════════════════════════════
      // (16/09/2026) ĐƯỜNG TẮT: CHUYỂN THẲNG JPEG CỦA CHROME
      // ────────────────────────────────────────────────────────────────────
      // Đường thường nén JPEG HAI LẦN: Chrome đã encode JPEG, ta giải nén ra
      // RGBA rồi encode lại. Vừa tốn CPU cả hai đầu vừa mất chất lượng thế hệ
      // thứ hai. (Lưu ý: `encodeMs` trong /metrics đo SAU bước sharp decode,
      // nên chi phí giải nén trước đó chưa từng được tính.)
      //
      // Khi đang phát VIDEO thì gần như khung nào cũng đổi toàn bộ, tức kiểu gì
      // cũng gửi full-frame. Lúc đó ảnh của Chrome dùng được ngay — chuyển
      // thẳng, bỏ cả decode lẫn encode.
      //
      // Nhận biết "đang phát video" bằng NHỊP ĐẾN của screencast, không phải
      // bằng kết quả của FrameProcessor: muốn biết kết quả đó thì đã phải giải
      // nén rồi (bài toán con gà - quả trứng). Chrome chỉ phát khi trang vẽ lại
      // nên nhịp cao = nội dung động.
      //
      // QUAN TRỌNG: mỗi lần đi đường tắt, bảng băm tile trong FrameProcessor
      // không được cập nhật -> phải requestFullFrame() để khung kế tiếp đi
      // đường thường dựng lại nền so sánh cho đúng, nếu không sẽ sinh khung
      // rách khi quay về chế độ vi sai.
      const nowMs = Date.now();
      const sharpRefresh = dev.forceSharp;
      dev.forceSharp = false;
      if (!sharpRefresh) dev.recentFrameMs.push(nowMs);
      if (dev.recentFrameMs.length > PASSTHROUGH_RATE_WINDOW) dev.recentFrameMs.shift();
      let fps = 0;
      if (dev.recentFrameMs.length >= PASSTHROUGH_RATE_WINDOW) {
        const span = nowMs - dev.recentFrameMs[0];
        if (span > 0) fps = (dev.recentFrameMs.length - 1) * 1000 / span;
      }

      // ══════════════════════════════════════════════════════════════════
      // (24/09/2026) KHUNG VIDEO NUA DO PHAN GIAI (thiet bi bao ?half=1 — P4)
      // ──────────────────────────────────────────────────────────────────
      // Do that tren P4 phat YouTube: 6-7 fps. Mang tho du (tai TCP 2 MB/s), nhung
      // moi khung 50-86 KB ton ~50 ms xu ly tren thiet bi (giai ma + chep 1,2 MB)
      // va phai chia 2-3 goi WS (vuot cap 32 KB -> ca passthrough ben duoi cung
      // khong bao gio kich hoat). O 512x300: ~1/4 byte (vua 1 goi), giai ma 1/4 so
      // diem anh; thiet bi phong x2 bang PPA phan cung. sharp thu nho JPEG theo he
      // so 2 bang shrink-on-load (libjpeg giai ma thang o 1/2) nen re.
      //
      // Chi ap khi nhip den cao (video). Video dung ~SHARP_REFRESH_MS khong co khung
      // moi -> gui lai khung cuoi o do phan giai DAY DU (duong thuong) cho net lai.
      // Hysteresis: bat khi nhip >= HALF_ON_FPS, chi tat khi < HALF_OFF_FPS. Do that lan dau voi mot nguong 8 fps:
      // nhip den lai do chinh server dieu tiet (~8 fps) nen bat/tat lien tuc quanh nguong.
      let halfWanted = dev.halfOn ? fps >= HALF_OFF_FPS : fps >= HALF_ON_FPS;
      // (24/09/2026) NHIP CAO CHUA DU: mot tab dashboard co anh dong NHO cung lam Chrome phat khung lien tuc ->
      // ca man hinh bi gui nua do phan giai, giao dien mo han (nguoi dung bao ngay). Phai co PHAN LON man hinh
      // doi moi la video: so anh thu nho xam 64x38 (sharp giai ma thang o kich thuoc nho — re) voi khung truoc.
      if (halfWanted && HALF_SCALE_VIDEO && dev.cfg.halfScale && !sharpRefresh) {
        const thumb = await sharp(imgBuf).resize(64, 38, { fit: 'fill' }).greyscale().raw().toBuffer();
        let changed = 0;
        if (dev.prevThumb && dev.prevThumb.length === thumb.length) {
          for (let i = 0; i < thumb.length; i++) if (Math.abs(thumb[i] - dev.prevThumb[i]) > 10) changed++;
        }
        dev.prevThumb = thumb;
        const pct = changed / thumb.length;
        // Hoi Chrome o nen (khong cho) — dung ket qua gan nhat; qua cu (> 3 nhip hoi) thi coi nhu khong co.
        if (!dev.videoProbeBusy && (dev.videoProbeMs === undefined || nowMs - dev.videoProbeMs >= VIDEO_PROBE_MS)) {
          dev.videoProbeBusy = true;
          dev.cdp.send('Runtime.evaluate', { expression: VIDEO_PROBE_JS, returnByValue: true })
            .then((r) => { const v = (r as { result?: { value?: unknown } }).result?.value; dev.videoElArea = typeof v === 'number' ? v : 0; })
            .catch(() => { dev.videoElArea = 0; })
            .finally(() => { dev.videoProbeMs = Date.now(); dev.videoProbeBusy = false; });
        }
        const videoEl = dev.videoProbeMs !== undefined && nowMs - dev.videoProbeMs < VIDEO_PROBE_MS * 3 &&
          (dev.videoElArea ?? 0) >= HALF_VIDEO_EL_AREA;
        const qualifies = videoEl || pct > (dev.halfOn ? HALF_KEEP_AREA : HALF_ON_AREA);
        if (qualifies) dev.halfLastQualifyMs = nowMs;
        // (24/09/2026) Chuyen tab = MOT dot thay doi lon ngan (hieu ung vai khung), khong phai video. Truoc day no du
        // dieu kien -> ca man hinh nua do phan giai, giu 3 s, lam net sau 0,7 s -> mo 1-2 s moi lan chuyen tab (nguoi
        // dung bao). Nay phai thoa LIEN TUC it nhat HALF_SUSTAIN_MS moi bat.
        if (!qualifies) dev.halfStreakStartMs = undefined;
        else if (dev.halfStreakStartMs === undefined) dev.halfStreakStartMs = nowMs;
        const sustained = dev.halfStreakStartMs !== undefined && nowMs - dev.halfStreakStartMs >= HALF_SUSTAIN_MS;
        // GIU che do video HALF_HOLD_MS sau khung thoa cuoi: video nguoi noi co canh gan nhu tinh (dien tich doi
        // nho) -> truoc day tat/bat lien tuc, MOI lan tat server phai gui lai ca khung net 125-144 KB -> giat.
        halfWanted = (dev.halfOn ? qualifies : sustained) ||
          (dev.halfOn && dev.halfLastQualifyMs !== undefined && nowMs - dev.halfLastQualifyMs < HALF_HOLD_MS);
        // Dang THAO TAC (vua cham man hinh) -> luon gui NET: nguoi dung dang nhin giao dien de bam tiep.
        if (dev.lastInputMs !== undefined && nowMs - dev.lastInputMs < HALF_AFTER_TOUCH_MS) {
          halfWanted = false;
          dev.halfStreakStartMs = undefined;
        }
      } else {
        dev.prevThumb = undefined;
      }
      if (!sharpRefresh && HALF_SCALE_VIDEO && dev.cfg.halfScale && halfWanted && !dev.cfg.rotation) {
        const capBytes = dev.cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
        const fullW = dev.cfg.width, fullH = dev.cfg.height;
        const halfW = Math.ceil(fullW / 2), halfH = Math.ceil(fullH / 2);
        let halfJpeg: Buffer | undefined;
        for (const factor of [1, 0.75, 0.55]) {
          const q = Math.max(20, Math.round(processor.tuning.jpegQuality * factor));
          const b = await sharp(imgBuf).resize(halfW, halfH).jpeg({ quality: q, chromaSubsampling: '4:2:0' }).toBuffer();
          if (b.length <= capBytes) { halfJpeg = b; break; }
        }
        if (halfJpeg) {
          const out = {
            rects: [{ x: 0, y: 0, w: fullW, h: fullH, data: halfJpeg }],
            isFullFrame: true,
            encoding: Encoding.JPEG,
            halfScale: true,
          };
          requestFullFrameFor(dev);  // khung duong thuong ke tiep dung lai nen so sanh
          dev.halfFrames++;
          if (!dev.halfOn) {
            dev.halfOn = true;
            console.log(`[half] ${id}: bat (nhip ${fps.toFixed(1)} fps, <video> ${((dev.videoElArea ?? 0) * 100).toFixed(0)}% man hinh, ${imgBuf.length} -> ${halfJpeg.length} B/khung)`);
          }
          metrics.onFrameEncoded(id, out, processor.stats, 0);
          dev.frameId = (dev.frameId + 1) >>> 0;
          broadcaster.sendFrameChunked(id, out, dev.frameId, dev.cfg.maxBytesPerMessage);
          dev.consecutiveFrameErrors = 0;
          dev.lastProcessedMs = Date.now();
          // Hen lam net: moi khung video moi dat lai dong ho.
          dev.lastVideoB64 = b64;
          if (dev.sharpTimer) clearTimeout(dev.sharpTimer);
          dev.sharpTimer = setTimeout(() => {
            dev.sharpTimer = undefined;
            if (devices.get(id) !== dev || dev.pendingB64 || !dev.lastVideoB64) return;
            dev.forceSharp = true;
            dev.pendingB64 = dev.lastVideoB64;
            dev.lastVideoB64 = undefined;
            dev.prevFrameHash = -1;
            if (!dev.throttleTimer) dev.throttleTimer = setTimeout(flushPending, 0);
          }, SHARP_REFRESH_MS);
          return;
        }
      }
      if (dev.halfOn) {
        dev.halfOn = false;
        console.log(`[half] ${id}: tat (nhip ${fps.toFixed(1)} fps${sharpRefresh ? ', lam net' : ''})`);
      }
      // ══════════════════════════════════════════════════════════════════

      if (fps >= PASSTHROUGH_MIN_FPS && !dev.cfg.rotation) {
        const capBytes = dev.cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
        if (imgBuf.length <= capBytes) {
          // metadata() chỉ đọc header JPEG (không giải nén pixel) nên rất rẻ.
          const meta = await sharp(imgBuf).metadata();
          if (meta.width === dev.cfg.width && meta.height === dev.cfg.height) {
            const out = {
              rects: [{ x: 0, y: 0, w: meta.width, h: meta.height, data: imgBuf }],
              isFullFrame: true,
              encoding: Encoding.JPEG,
            };
            requestFullFrameFor(dev);
            dev.passthroughFrames++;
            if (!dev.passthroughOn) {
              dev.passthroughOn = true;
              console.log(`[passthrough] ${id}: bật (nhịp ${fps.toFixed(1)} fps, ${imgBuf.length} B/khung)`);
            }
            metrics.onFrameEncoded(id, out, processor.stats, 0);
            dev.frameId = (dev.frameId + 1) >>> 0;
            broadcaster.sendFrameChunked(id, out, dev.frameId, dev.cfg.maxBytesPerMessage);
            dev.consecutiveFrameErrors = 0;
            dev.lastProcessedMs = Date.now();
            return;
          }
        }
      }
      if (dev.passthroughOn) {
        dev.passthroughOn = false;
        console.log(`[passthrough] ${id}: tắt (nhịp ${fps.toFixed(1)} fps) — quay về đường thường`);
      }
      // ════════════════════════════════════════════════════════════════════

      let img = sharp(imgBuf);
      if (dev.cfg.rotation) img = img.rotate(dev.cfg.rotation);
      const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const _tEnc = Date.now();
      const out = await processor.processFrameAsync({ data, width: info.width, height: info.height });
      metrics.onFrameEncoded(id, out, processor.stats, Date.now() - _tEnc);
      if (out.rects.length > 0) {
        dev.frameId = (dev.frameId + 1) >>> 0;
        broadcaster.sendFrameChunked(id, out, dev.frameId, cfg.maxBytesPerMessage);
      }

      // Cải tiến: reset bộ đếm lỗi sau frame thành công
      dev.consecutiveFrameErrors = 0;

    } catch (e) {
      // Cải tiến: đếm lỗi liên tiếp và tự restart device khi vượt ngưỡng
      dev.consecutiveFrameErrors++;
      metrics.onFrameError(id, (e as Error).message);
      console.warn(
        `[device] Frame error ${id} (${dev.consecutiveFrameErrors}/${MAX_CONSECUTIVE_FRAME_ERRORS}): ` +
        `${(e as Error).message}`
      );
      if (dev.consecutiveFrameErrors >= MAX_CONSECUTIVE_FRAME_ERRORS) {
        console.error(
          `[device] Too many consecutive frame errors on ${id}, scheduling device restart...`
        );
        dev.consecutiveFrameErrors = 0;
        // Restart bất đồng bộ — không block pipeline hiện tại
        setImmediate(async () => {
          try {
            const currentDev = devices.get(id);
            if (currentDev) {
              console.log(`[device] Restarting device ${id} after repeated errors`);
              await deleteDeviceAsync(currentDev);
              await ensureDeviceAsync(id, cfg);
            }
          } catch (restartErr) {
            console.error(`[device] Restart failed for ${id}:`, (restartErr as Error).message);
          }
        });
      }
    } finally {
      // (25/09/2026) KHONG ghi de lastProcessedMs o day nua: truoc day nhip tinh tu luc XONG khung truoc, tuc chu ky
      // thuc = nhip + thoi gian xu ly (do do phan giai day du: 66 ms + ~35-40 ms giai nen/nen -> ~10 fps thay vi 15).
      // Moc da danh o DAU ham (xem tren) -> chu ky = max(nhip, thoi gian xu ly). Van MOT khung mot luc (flushInFlight).
      dev.flushInFlight = false;
    }
  };

  // (24/09/2026) Xem markInteraction: gui lai khung video cuoi o do phan giai day du ngay lap tuc.
  newDevice.sharpenNow = () => {
    const dev = newDevice;
    if (!dev.lastVideoB64 || dev.pendingB64) return;
    if (dev.sharpTimer) { clearTimeout(dev.sharpTimer); dev.sharpTimer = undefined; }
    dev.forceSharp = true;
    dev.pendingB64 = dev.lastVideoB64;
    dev.lastVideoB64 = undefined;
    dev.prevFrameHash = -1;
    if (!dev.throttleTimer) dev.throttleTimer = setTimeout(flushPending, 0);
  };

  // (18/09/2026) DONG BO URL HAI CHIEU.
  //
  // Truoc day URL chi di MOT CHIEU (HA -> thiet bi). Khi nguoi dung tu cham
  // chuyen tab tren dashboard, server khong theo doi gi ca, nen thiet bi va HA
  // deu giu gia tri cu. Hau qua nguoi dung gap: nut "Go Home" mat tac dung —
  // no lam text.set voi dung gia tri dang co, ma ESPHome chi kich set_action
  // khi gia tri THAY DOI.
  //
  // Phai bat CA HAI su kien:
  //   - Page.frameNavigated        : dieu huong day du (tai lai trang)
  //   - Page.navigatedWithinDocument: dieu huong TRONG CUNG TRANG
  // Cai thu hai moi la then chot: dashboard Home Assistant la ung dung MOT
  // TRANG, chuyen tab chi doi URL bang history.pushState chu khong tai lai.
  // Chi bat frameNavigated se bo sot dung truong hop thuong gap nhat.
  const handleNavigation = (url: string) => {
    if (!url || url === 'about:blank') return;
    if (newDevice.url === url) return;
    newDevice.url = url;
    broadcaster.sendCurrentURL(newDevice.deviceId, url);
    metrics.onNavigate(newDevice.deviceId, url);
    console.log(`[device] ${id}: URL doi thanh ${url}`);
  };

  session.on('Page.frameNavigated', (evt: any) => {
    // Chi theo doi khung chinh, bo qua iframe
    if (!evt?.frame?.parentId) handleNavigation(evt?.frame?.url);
  });

  session.on('Page.navigatedWithinDocument', (evt: any) => {
    handleNavigation(evt?.url);
  });

  session.on('Page.screencastFrame', async (evt: any) => {
    session.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => { });
    if (broadcaster.getClientCount(newDevice.deviceId) === 0) return;
    newDevice.lastActive = Date.now();
    newDevice.pendingB64 = evt.data;
    const now = Date.now();
    const since = newDevice.lastProcessedMs ? (now - newDevice.lastProcessedMs) : Infinity;
    if (!newDevice.throttleTimer) {
      // Dang thao tac -> uu tien do muot, dung nhip GOC thay vi nhip da dieu tiet.
      const interacting = INTERACTION_BOOST_MS > 0
        && newDevice.lastInputMs != null
        && (now - newDevice.lastInputMs) < INTERACTION_BOOST_MS;
      const effInterval = interacting
        ? cfg.minFrameInterval
        : (newDevice.tunedMinFrameIntervalMs ?? cfg.minFrameInterval);
      const delay = Math.max(0, effInterval - (Number.isFinite(since) ? since : 0));
      newDevice.throttleTimer = setTimeout(flushPending, delay);
    }
  });

  console.log(`[device] ✓ Device ${id} ready (${cfg.width}x${cfg.height}) [${devices.size}/${MAX_DEVICES} slots used]`);
  return newDevice;
}

export async function cleanupIdleAsync(ttlMs = 5 * 60_000) {
  if (_cleanupRunning) return;
  _cleanupRunning = true;
  try {
    const now = Date.now();
    const stale = Array.from(devices.values())
      .filter(d => now - d.lastActive > ttlMs).map(d => d.deviceId);
    if (stale.length > 0) {
      console.log(`[device] Cleaning up ${stale.length} idle device(s): ${stale.join(', ')}`);
    }
    for (const id of stale) {
      const dev = devices.get(id);
      if (dev) await deleteDeviceAsync(dev).catch(() => { });
    }
  } finally { _cleanupRunning = false; }
}

// (15/09/2026) BẢO HIỂM LÀM MỚI MÀN HÌNH: định kỳ ép gửi 1 full-frame cho mỗi thiết bị.
// Ca thực tế đã gặp: server khởi động lại / trang bị đen -> thiết bị giữ ảnh cũ (màn hình
// trắng chỉ sáng đèn nền) mà KHÔNG có frame mới để tự sửa. Ép full-frame định kỳ bảo đảm
// màn hình luôn được vẽ lại (chi phí ~10-25KB mỗi 60s, không đáng kể).
export function refreshDisplaysTick(): void {
  // (17/09/2026) 60s -> 5 phut.
  //
  // Day la BAO HIEM chong "man hinh giu anh cu", khong phai co che chinh. Nhung
  // moi lan chay la mot full-frame (~50KB) cho MOI thiet bi — o nhip 60s thi do
  // la mot cu soc tai deu dan moi phut, va no chinh la thu lam cac phep do dao
  // dong trong suot buoi dieu tra.
  //
  // Ban goc cua strange-v KHONG co co che nay. Gio da co cac tuyen phong thu
  // khac (ap luc nguoc, vong dieu tiet, full_frame_every cua chinh
  // FrameProcessor), nen bao hiem nay chi can chay thua thot.
  // Dat CCR_REFRESH_MS=0 de tat han.
  const ms = Number(process.env.CCR_REFRESH_MS ?? 300_000);
  if (!ms) return;
  for (const d of devices.values()) {
    try { requestFullFrameFor(d); } catch { /* bỏ qua */ }
  }
}

// (14/09/2026) GĐ3: vòng điều khiển thích nghi cho TỪNG thiết bị.
// Chạy định kỳ; đọc số đo thật (decode mới nhất do thiết bị báo, bytes/s) rồi chỉnh
// quality/nhịp. Tắt bằng biến môi trường CCR_ADAPTIVE=0.
const adaptiveStates = new Map<string, AdaptiveState>();
// (24/09/2026) Uoc luong duong truyen theo thiet bi, cap nhat moi tick (5s). Xem adaptive.ts.
const linkEstimates = new Map<string, LinkEstimate>();

/** (17/09/2026) Danh dau thiet bi vua nhan su kien cham — xem lastInputMs. */
export function markInteraction(deviceId: string): void {
  const d = devices.get(deviceId);
  if (!d) return;
  d.lastInputMs = Date.now();
  // (24/09/2026) Cham luc man hinh dang o nua do phan giai: lam net NGAY, khong doi khung moi / hen gio 0,7 s.
  if (d.halfOn && d.sharpenNow) d.sharpenNow();
}

export function runAdaptiveTick(): void {
  const tun = tuning();
  if (process.env.CCR_ADAPTIVE === '0' || tun.adaptive === false) {
    // Thu nghiem: tat dieu tiet, tuy chon ep nhip co dinh cho moi thiet bi (xem tuning.ts).
    if (tun.fixedIntervalMs) for (const d of devices.values()) d.tunedMinFrameIntervalMs = tun.fixedIntervalMs;
    return;
  }
  const now = Date.now();
  const snap = metrics.snapshot();
  for (const m of snap.devices) {
    const device = devices.get(m.id);
    if (!device || !m.decodeSamples) continue;
    let st = adaptiveStates.get(m.id);
    if (!st) {
      st = initialAdaptiveState(device.cfg.jpegQuality, device.cfg.minFrameInterval, now);
      // Bat dau o muc an toan, nhung baseIntervalMs giu nguyen tran thiet bi
      // yeu cau -> nhanh hoi phuc van co duong rut ve tran do.
      st.minFrameIntervalMs = device.tunedMinFrameIntervalMs ?? st.minFrameIntervalMs;
      adaptiveStates.set(m.id, st);
    }
    // (25/09/2026) Thiet bi giai ma thang vao framebuffer (?fb=1, P4): nhan va giai ma chay SONG SONG, khung day du
    // ~60 KB, P4 xu ly ~20-25 ms/khung. Mac dinh cu (ngan sach = 0,5 x nhip, ton dong 96 KB, gian x2) dat cho khung
    // ~20 KB va thiet bi giai ma tuan tu -> giu P4 o ~7 fps. Do that (docs muc 24): 1,3 / 192 KB / x1,5 + nguong
    // khung day du 0,8 (YAML) -> YouTube DU do phan giai 24 fps. File tinh chinh van ghi de duoc.
    // (25/09/2026 chieu) Chay thu 10 phut: nghen o ~1 MB/s la THOANG QUA (WiFi chap chon) nhung buoc gian toi thieu
    // 50 ms day 33 -> 83 ms roi mat 45-60 s moi hoi -> TB chi ~17 fps. Buoc 17 ms (33 -> 50), hoi sau 1 mau tot, cho 5 s.
    const fbProfile = device.cfg.fbBands
      ? { decodeBudgetRatio: 1.3, maxBacklogBytes: 196_608, intervalBackoffFactor: 1.5,
          intervalStepMs: 17, goodStreakNeeded: 1, cooldownMs: 5_000 } : {};
    const cfgA = {
      ...DEFAULT_ADAPTIVE_CFG, maxQuality: device.cfg.jpegQuality, ...fbProfile,
      ...(tun.maxBacklogBytes !== undefined ? { maxBacklogBytes: tun.maxBacklogBytes } : {}),
      ...(tun.decodeBudgetRatio !== undefined ? { decodeBudgetRatio: tun.decodeBudgetRatio } : {}),
      ...(tun.intervalBackoffFactor !== undefined ? { intervalBackoffFactor: tun.intervalBackoffFactor } : {}),
    };
    const bytesPerSec = m.uptimeSec > 0 ? m.bytesSent / m.uptimeSec : 0;
    const counters = broadcaster.linkCounters(m.id);
    let link = linkEstimates.get(m.id);
    if (counters) {
      link = updateLinkEstimate(link, counters.sent, counters.backlog, m.framesSent, now);
      linkEstimates.set(m.id, link);
      metrics.onLinkEstimate(m.id, link.capacityBytesPerSec ?? null, link.recentBytesPerSec ?? null,
        link.recentFrameBytes ?? null);
    }
    const res = decideAdaptive(
      {
        // ══════════════════════════════════════════════════════════════════
        // (23/09/2026) TRUNG VI thay cho LON NHAT.
        //
        // Do that tren P4 dang phat YouTube, doc thang tu log thiet bi:
        //     frame 5987..6006: 29, 33, 30, 33, 32, 30, 31, 30, 30, 29 ms
        // Deu dan quanh 30ms. Nhung /metrics cung luc do bao
        // recentMaxDecodeMs = 81, va bo dieu tiet ghi ly do:
        //     "decode 713.0ms > ngan sach 200ms -> giam quality con 40"
        // — mot GAI NHIEU 713ms (dieu huong trang / WiFi tre mot nhip) da
        // quyet dinh so phan cua ca he.
        //
        // Lay LON NHAT cua 6 mau nghia la: mot gai duy nhat khoa hanh vi
        // trong 30 giay (6 mau x 5s), ma chieu ha tai chi tre 5 giay nen
        // trong 30 giay do no phat duoc TOI SAU LAN tu cung mot gai. Ket qua
        // do duoc: quality tut ve san 40 va nhip gian ra 400ms (2,5fps) trong
        // khi thiet bi that su chi ban 30ms/khung — tuc dang ranh ba phan tu
        // thoi gian.
        //
        // Trung vi giu nguyen y do ban dau ("dung tai HIEN TAI, khong phai
        // trung binh tu luc ket noi") nhung mien nhiem voi mot mau lac loai.
        // Van con recentMaxDecodeMs trong /metrics de con nguoi nhin thay gai.
        decodeMs: m.recentMedianDecodeMs ?? m.avgDecodeMs ?? null,
        bytesPerSec,
        frameErrors: m.frameErrors,
        heapFree: m.deviceHeapFree ?? null,
        backlogBytes: broadcaster.backlogBytes(m.id),
        capacityBytesPerSec: link?.capacityBytesPerSec ?? null,
        recentBytesPerSec: link?.recentBytesPerSec ?? null,
        recentFrameBytes: link?.recentFrameBytes ?? null,
      },
      st,
      cfgA,
      now
    );
    adaptiveStates.set(m.id, res.state);
    if (!res.changed) continue;
    device.processor.setTuning({ jpegQuality: res.state.quality });
    device.tunedMinFrameIntervalMs = res.state.minFrameIntervalMs;
    metrics.onAdaptiveChange(m.id, res.state.quality, res.state.minFrameIntervalMs, res.reason);
    console.log(`[adaptive] ${m.id}: ${res.reason}`);
  }
}

// (14/09/2026) GD2: dinh ky xin MOI thiet bi bao so lieu decode (FrameStats).
// Thiet bi chi tra loi khi duoc hoi, nen khong hoi thi khong co so lieu de do.
export function requestStatsFromDevices(): void {
  for (const d of devices.values()) {
    try { broadcaster.requestFrameStats(d.deviceId); } catch { /* bo qua */ }
  }
}

async function deleteDeviceAsync(device: DeviceSession) {
  const root = getRoot() as unknown as CDPRoot;
  if (!devices.delete(device.deviceId)) return;
  metrics.removeDevice(device.deviceId);
  // (17/09/2026) Phai xoa CA trang thai thich nghi. Truoc day Map nay khong bao
  // gio duoc don, nen phien moi cua cung mot thiet bi thua ke trang thai "da
  // kich san" cua phien cu -> decideAdaptive tra changed=false -> khong gia tri
  // nao duoc ap vao cfg moi. Vong dieu khien im lang trong khi thiet bi chay
  // full tai (quan sat that: log bao da gian nhip len 400ms, nhung /metrics van
  // bao minFrameInterval=100 va adaptiveChanges=0).
  adaptiveStates.delete(device.deviceId);
  if (device.sharpTimer) { clearTimeout(device.sharpTimer); device.sharpTimer = undefined; }
  // linkEstimates co y GIU LAI: bang thong la cua duong truyen WiFi, khong cua phien.
  // updateLinkEstimate tu dat lai moc khi thay bo dem socket moi quay ve 0.
  if (device.throttleTimer) clearTimeout(device.throttleTimer);
  try { await device.cdp.send("Page.stopScreencast").catch(() => { }); } catch { }
  try { await root?.send("Target.closeTarget", { targetId: device.id }); } catch { }
  console.log(`[device] Device ${device.deviceId} deleted [${devices.size}/${MAX_DEVICES} slots used]`);
}
