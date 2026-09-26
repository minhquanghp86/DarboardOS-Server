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
import { nudgeRepaintAsync } from "./browser.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLauncherApps, listAllApps, GROUP_TITLES, LAUNCHER_CAMS_URL, LAUNCHER_OS_HOME_URL, LAUNCHER_SCENES_URL, LAUNCHER_TIMER_URL, LAUNCHER_WEATHER_URL } from "./launcherApps.js";
import { createRequire } from "node:module";
import { getWeatherMini, onWeatherMiniUpdate } from "./weatherMini.js";
import { SerialQueue, appKeyForUrl, nowPlaying, pickEvictions, recentsList } from "./tabPolicy.js";
import { SCREENSAVER_IDLE_S, shouldShowSaver } from "./screensaver.js";
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
  /** (25/09/2026) Trang thai thiet bi bao len (DeviceState): do sang, am luong, gio — cho menu va dong ho. */
  devState?: DeviceStateInfo & { receivedAt: number };
  /** (25/09/2026) Hen gio cua menu — giu o SERVER nen van reo khi nguoi dung da chuyen trang. */
  timer?: { endsAt: number; label: string; handle: NodeJS.Timeout };

  // (26/09/2026 OS-2) MOI UNG DUNG LA MOT TAB CHROMIUM RIENG — xem docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 3.1.
  // `cdp`/`url` o tren LUON phan anh tab dang ACTIVE (dang hien tren man hinh — chi tab nay duoc Page.startScreencast).
  // Cac tab khac (Home Assistant ghim + toi da MAX_APP_TABS ung dung) van "am": JS chay binh thuong, radio/nhac phat
  // duoc, nhung KHONG duoc gui hinh — chuyen ve chi la doi con tro `cdp` + bat lai screencast, tuc thi, khong tai lai.
  tabs: Map<string, Tab>;
  /** Khoa cua tab dang active trong `tabs` ('' = chua co tab nao — chi dung trong luc ensureDeviceAsync khoi tao). */
  activeTabKey: string;
  /** (26/09/2026) Moi thao tac mo/chuyen tab (openApp, navigateToUrl) chay TUAN TU — xem SerialQueue (tabPolicy.ts). */
  tabOps: SerialQueue;
  /** (26/09/2026 OS-5) Lan cham cuoi (moc cho man hinh cho) va man hinh cho dang hien tren tab active hay khong. */
  lastTouchMs: number;
  saverOn: boolean;
};

/** (26/09/2026 OS-2) Mot "ung dung" = mot Chromium target/session rieng cua MOT thiet bi. */
interface Tab {
  /** 'home' (Home Assistant, ghim), '__system' (man hinh chinh /os/home, ghim), 'browser' (URL ngoai HA),
   *  hoac id ung dung tu launcherApps.ts ('cams', 'scenes', 'radio', 'c_xxx'...). */
  key: string;
  kind: string;
  /** Ten hien thi (the "Đang phát" trong thanh trang thai). */
  label: string;
  url: string;
  targetId: string;
  session: CDPSession;
  /** Id script Shell da dang ky qua Page.addScriptToEvaluateOnNewDocument — de go/thay khi homeUrl doi. */
  launcherScriptId?: string;
  /** Khong bao gio bi don don theo MAX_APP_TABS (Home Assistant + man hinh chinh). */
  pinned: boolean;
  screencastOn: boolean;
  /** True neu duoc phep nghe tieng KE CA khi khong active (radio/nhac dang phat nen). */
  backgroundAudio: boolean;
  /** Trang thai am thanh HIEN TAI da gui cho tab nay — xem setTabAudioAllowed. */
  audioAllowed: boolean;
  /** (26/09/2026) Trang tu bao dang phat <audio>/<video> (buildAudioGuardScript -> {media}), reset moi lan dieu huong. */
  mediaPlaying: boolean;
  /** Trang da bao trang thai phat it nhat mot lan tu lan dieu huong gan nhat (chua bao -> chinh sach don than trong). */
  mediaKnown: boolean;
  lastUsed: number;
  /** (26/09/2026 OS-3) Anh thu nho (data URL JPEG ~320 px) chup luc roi tab — cho man hinh "Gan day". */
  thumb?: string;
}

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

// (23/09/2026, mo rong 26/09/2026 OS-2) KHOA AM THANH THEO TAB.
//
// Kien truc dung CHUNG mot tien trinh Chrome cho ca ba thiet bi -> CHUNG mot sink PulseAudio duy nhat (xem
// AUDIO-FEATURE-PLAN-2026-09-23.md muc 7.2 — da xac minh KHONG co cach nao tach am thanh theo tung
// tab/target tu ben ngoai trang: setSinkId() can HTTPS + cu chi nguoi dung that, CDP hoan toan khong co lenh
// "mute theo target" nao). Voi OS-2 (nhieu tab/thiet bi), rui ro nay TANG THEM mot bac: ngay CA CUNG mot
// thiet bi co loa cung co the co NHIEU tab (YouTube, Radio...) cung phat cung luc va tron tieng.
//
// Giai phap khong doi: ghi de HTMLMediaElement.prototype.muted/volume NGAY TRUOC KHI trang tu chay (Page.
// addScriptToEvaluateOnNewDocument), nhung nay THEO CO `window.__rwvAudioAllowed` (server bat/tat qua
// Runtime.evaluate — xem setTabAudioAllowed) thay vi mot chieu vinh vien. `alwaysMuted` van la CO DINH cho
// thiet bi KHONG khai bao speaker_id (S3): tab cua no khong bao gio duoc phep phat, du active hay khong.
//
// Mac dinh CAM khi vua tiem (an toan — tab moi tao chua duoc active). setTabAudioAllowed() bat/tat song, VA
// handleTabNavigation() khang dinh lai moi lan tab dieu huong that su (chong truong hop lenh bat cho tab MOI
// TAO bi "thua" navigation dang chay do — xem chu thich o setTabAudioAllowed).
export function buildAudioGuardScript(alwaysMuted: boolean): string {
  return `(function(){
  window.__rwvAudioGuard = true;
  window.__rwvAudioAllowed = false;
  var ALWAYS_MUTED = ${alwaysMuted};
  try {
    var proto = HTMLMediaElement.prototype;
    Object.defineProperty(proto, 'muted', {
      get: function(){ return ALWAYS_MUTED || !window.__rwvAudioAllowed; }, set: function(){}, configurable: true
    });
    Object.defineProperty(proto, 'volume', {
      get: function(){ return (ALWAYS_MUTED || !window.__rwvAudioAllowed) ? 0 : 1; }, set: function(){}, configurable: true
    });
  } catch (e) {}
  // (26/09/2026) Bao server trang nay CO dang phat <audio>/<video> khong — de the "Dang phat" chi hien khi that su
  // phat, va tab Radio/Nhac da dung duoc don nhu tab thuong. Su kien media khong noi bot nhung BAT duoc o pha capture
  // cua document. Gop 300 ms, chi gui khi trang thai DOI.
  var last = null, pend = 0;
  function report(){
    pend = 0;
    var p = false;
    try {
      var ms = document.querySelectorAll('audio,video');
      for (var i = 0; i < ms.length; i++) if (!ms[i].paused && !ms[i].ended) { p = true; break; }
    } catch (e) {}
    if (p === last) return;
    last = p;
    var fn = window[${JSON.stringify(CONTROL_BINDING)}];
    if (typeof fn === 'function') { try { fn(JSON.stringify({ media: p ? 1 : 0 })); } catch (e) {} }
  }
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function(ev){
    document.addEventListener(ev, function(){ if (!pend) pend = setTimeout(report, 300); }, true);
  });
  // Nut "Dung" cua the Dang phat: trang tu dung theo cach cua no (window.rwvStop, vd radio.html huy luon HLS), khong
  // thi tam dung moi the media.
  window.__rwvMediaStop = function(){
    if (typeof window.rwvStop === 'function') { try { window.rwvStop(); return; } catch (e) {} }
    try { document.querySelectorAll('audio,video').forEach(function(m){ try { m.pause(); } catch (e) {} }); } catch (e) {}
  };
})();`;
}

/**
 * Bat/tat am thanh cua MOT tab. Ghi lai `tab.audioAllowed` NGAY (dong bo) roi gui Runtime.evaluate — khong doi ket
 * qua (nhu cac lenh dieu khien khac trong file nay). An toan ke ca khi tab dang dieu huong: neu lenh nay "thua"
 * (chay tren tai lieu cu truoc khi trang moi commit), handleTabNavigation() se khang dinh lai gia tri dung ngay khi
 * trang moi thuc su vao — xem chu thich o buildAudioGuardScript.
 */
function setTabAudioAllowed(tab: Tab, allowed: boolean): void {
  tab.audioAllowed = allowed;
  tab.session.send('Runtime.evaluate', {
    expression: `window.__rwvAudioGuard && (window.__rwvAudioAllowed = ${allowed});`,
  }).catch(() => { });
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
function handleUserEnteredUrl(id: string, payload: unknown): void {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 1024) return;
  let url: URL;
  try { url = new URL(payload); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const dev = devices.get(id);
  if (!dev) return;
  if (dev.cfg.urlSet && broadcaster.sendSetDisplayURL(id, url.href)) {
    console.log(`[launcher] ${id}: nguoi dung nhap URL ${url.href} -> gui thiet bi dat "URL hien thi"`);
    return;
  }
  console.log(`[launcher] ${id}: nguoi dung nhap URL ${url.href} -> server tu mo (thiet bi chua ho tro urlset)`);
  navigateToUrl(dev, url.href).catch((e: unknown) => console.warn(`[launcher] ${id}: mo URL that bai:`, e));
}

/** URL co CUNG GOC voi Home URL cua thiet bi hay khong — quyet dinh dieu huong vao tab 'home' hay 'browser'. */
function isHaUrl(dev: DeviceSession, url: string): boolean {
  if (!dev.cfg.homeUrl) return false;
  try { return new URL(url).origin === new URL(dev.cfg.homeUrl).origin; } catch { return false; }
}

/**
 * (26/09/2026 OS-2) DIEM VAO DUY NHAT cho moi lenh "hien URL nay" tu phia thiet bi (OpenURL packet: nut/thuc the
 * "Go Home" VA thuc the "URL hien thi" deu di qua CUNG mot goi tin o tang firmware — khong the phan biet duoc,
 * xem docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md muc 4). Phan loai theo GOC: cung goc voi Home URL -> tab 'home'
 * (ghim); khac goc -> tab 'browser'. "Go Home" luon gui dung Home URL nen luon dua tab 'home' VE DUNG home_url,
 * ke ca khi tab do dang o mot trang con khac cua HA — dung yeu cau ban dau cua nut nay.
 */
export function navigateToUrl(dev: DeviceSession, url: string): Promise<void> {
  return dev.tabOps.run(() => navigateToUrlNow(dev, url));
}

async function navigateToUrlNow(dev: DeviceSession, url: string): Promise<void> {
  if (devices.get(dev.deviceId) !== dev) return;  // phien da bi xoa trong luc lenh nay xep hang
  // (26/09/2026) URL thuoc mot ung dung trong menu (vd youtu.be -> YouTube) vao DUNG tab ung dung do.
  // Thu tu: ung dung khop (ke ca ung dung nam tren HA nhu Nang luong) -> cung goc HA (tab 'home') -> Trinh duyet.
  const appKey = appKeyForUrl(url, listAllApps(dev.cfg.homeUrl).filter((a) => !a.hidden && a.id !== 'home'))
    ?? (isHaUrl(dev, url) ? 'home' : null);
  const spec = appKey && appKey !== 'home' ? resolveAppSpec(dev, appKey) : null;
  const key = appKey === 'home' ? 'home' : spec ? appKey! : 'browser';
  let tab = dev.tabs.get(key);
  let navigated = false;
  if (!tab) {
    tab = key === 'home' ? await createTab(dev, key, 'ha', true, 'Home Assistant')
      : spec ? await createTab(dev, key, spec.kind, false, spec.label)
      : await createTab(dev, key, 'browser', false, 'Trình duyệt');
    if (devices.get(dev.deviceId) !== dev) { closeTab(dev, key, 'phien thiet bi da bi xoa'); return; }
    // Bat screencast TRUOC (tren trang trang, an toan) roi moi dieu huong cheo nguon — xem createTab().
    await activateTab(dev, key);
    await navigateTab(dev, tab, url);
    navigated = true;
  } else {
    if (tab.url !== url) {
      await navigateTab(dev, tab, url); // tab da ton tai: neu dang active thi screencast da chay tu truoc, an toan;
      navigated = true;                 // neu dang o nen thi khong ai xem, cung an toan.
    }
    await activateTab(dev, key);
  }
  // (25/09/2026, giu nguyen tu ban OS-1) Trang TINH khong navigate lai (URL trung) sau khi thiet bi mat ket noi roi
  // noi lai van can duoc VE LAI: "nudge" ep Chrome phat mot khung moi. Da navigate that thi Chrome tu ve lai, khong
  // can nudge them.
  if (!navigated) await nudgeRepaintAsync(dev.cdp).catch(() => { });
  requestFullFrameFor(dev);
  evictIfNeeded(dev);
}

// (25/09/2026) Thanh truot trong menu goi window.__rwvControl(JSON). Chi nhan dung hai truong, gia tri 0..100 (trang
// web bat ky cung goi duoc binding nay: viec toi da no lam duoc la doi do sang/am luong cua chinh man hinh nay).
const CONTROL_BINDING = '__rwvControl';

function handleMenuControl(id: string, payload: unknown, from?: Tab): void {
  if (typeof payload !== 'string' || payload.length > 200) return;
  let msg: any;
  try { msg = JSON.parse(payload); } catch { return; }
  const dev = devices.get(id);
  if (!dev) return;
  if (msg?.hello) { pushDeviceStateToPage(dev); return; }
  // (26/09/2026 OS-5) Nguoi dung cham tat man hinh cho.
  if (msg?.wake) { dev.saverOn = false; dev.lastTouchMs = Date.now(); return; }
  // (26/09/2026) Trang cua MOT tab bao dang phat / da dung (buildAudioGuardScript). Chi tin tab con thuoc thiet bi.
  if (msg?.media != null) {
    if (from && dev.tabs.get(from.key) === from) onTabMedia(dev, from, !!msg.media);
    return;
  }
  // (26/09/2026 OS-3) Man hinh "Gan day": mo (chup anh tab dang hien truoc), dong mot ung dung, dong tat ca.
  if (msg?.recents) { showRecents(dev, true).catch(() => { }); return; }
  if (typeof msg?.close === 'string' || msg?.closeAll) {
    const keys = msg.closeAll ? [...dev.tabs.keys()] : [msg.close as string];
    dev.tabOps.run(async () => {
      for (const k of keys) {
        const t = dev.tabs.get(k);
        if (t && !t.pinned && k !== dev.activeTabKey) closeTab(dev, k, 'nguoi dung dong o Gan day');
      }
      pushDeviceStateToPage(dev);
      await showRecents(dev, false);
    }).catch(() => { });
    return;
  }
  // Nut "Dung" cua the Dang phat trong thanh trang thai.
  if (typeof msg?.stop === 'string') {
    const tab = dev.tabs.get(msg.stop);
    if (tab) {
      tab.session.send('Runtime.evaluate', { expression: 'window.__rwvMediaStop && window.__rwvMediaStop();' }).catch(() => { });
      console.log(`[app] ${id}: dung phat nen tab "${tab.key}"`);
    }
    return;
  }
  if (msg?.timer) { handleTimer(dev, msg.timer); return; }
  // (26/09/2026 OS-2) Shell goi {app:"<id>"} khi nguoi dung cham mot ung dung (luoi Home cua OS, dock, thanh
  // truot mep tren) — mo/kich hoat dung TAB cua ung dung do, xem openApp().
  if (typeof msg?.app === 'string' && msg.app.length <= 40) {
    openApp(dev, msg.app).catch((e: unknown) => console.warn(`[app] ${id}: mo "${msg.app}" that bai:`, e));
    return;
  }
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
      expression: `(window.__rwvShell ? window.__rwvShell.alarm : window.__rwvAlarm || function(){})(${JSON.stringify(label)})`,
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
    np: nowPlaying(dev.tabs.values(), dev.activeTabKey),
  };
  dev.cdp.send('Runtime.evaluate', {
    expression: `(window.__rwvShell ? window.__rwvShell.state : window.__rwvDeviceState || function(){})(${JSON.stringify(payload)})`,
  }).catch(() => { });
}

/**
 * Dang ky lai script launcher (ap dung tu lan dieu huong ke tiep) VA thay ngay tren trang dang mo. Dung khi homeUrl
 * doi hoac khi nguoi dung luu cau hinh menu (trang "Menu panel").
 */
async function reloadLauncherTab(device: DeviceSession, tab: Tab): Promise<boolean> {
  try {
    // (26/09/2026 OS-2) launcherScriptId gio la CUA TUNG TAB (moi tab la mot session/target rieng) — xem
    // reloadAllLaunchers() ben duoi, goi ham nay cho MOI tab dang mo cua thiet bi.
    if (tab.launcherScriptId) {
      await tab.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: tab.launcherScriptId });
    }
    const src = buildLauncherScript(device.cfg.homeUrl, device.cfg);
    const { identifier } = await tab.session.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
    tab.launcherScriptId = identifier;
    // Don Shell CU tren trang DANG MO cua tab nay roi chay lai (script moi chi tu ap dung tu lan navigate ke tiep).
    await tab.session.send('Runtime.evaluate', {
      expression:
        `(function(){` +
        `document.querySelectorAll('rwv-shell').forEach(function(x){x.remove();});` +
        `window.__launcherInitialized=false; window.__rwvShell=undefined;` +
        `})();` + src,
    });
    return true;
  } catch (e) {
    console.warn(`[device] ⚠️ Khong nap lai duoc Shell cho ${device.deviceId} (tab "${tab.key}"):`, e);
    return false;
  }
}

async function reloadLauncher(device: DeviceSession): Promise<boolean> {
  let ok = true;
  for (const tab of device.tabs.values()) {
    if (!(await reloadLauncherTab(device, tab))) ok = false;
  }
  return ok;
}

/** (25/09/2026) Sau khi luu cau hinh menu: nap lai launcher tren moi man hinh. */
export async function reloadAllLaunchers(): Promise<number> {
  let n = 0;
  for (const dev of devices.values()) if (await reloadLauncher(dev)) n++;
  return n;
}

/** homeUrl cua mot thiet bi dang ket noi (de trang cau hinh hien du ung dung HA). */
export function anyHomeUrl(): string | undefined {
  for (const dev of devices.values()) if (dev.cfg.homeUrl) return dev.cfg.homeUrl;
  return undefined;
}

/**
 * (25/09/2026) Muc chuyen dong cua Shell theo man hinh: moi khung dong la bang thong WiFi toi panel.
 *   full = ESP32-P4 1024x600 (~28 khung/s, giai ma phan cung): thanh keo theo ngon, truot trang.
 *   reduced = S3 480x480 (giai ma phan mem ~63 ms): mo/dong nhay thang.  minimal = S3 480x272.
 */
function shellMotion(cfg: DeviceConfig | undefined): 'full' | 'reduced' | 'minimal' {
  if (!cfg) return 'full';
  if (cfg.fbBands || cfg.width >= 800) return 'full';
  return Math.min(cfg.width, cfg.height) <= 300 ? 'minimal' : 'reduced';
}

/**
 * (25/09/2026) Script tiem vao MOI trang cua panel: am lich + cau hinh + SHELL (giao dien he thong, src/shell/,
 * dong goi bang esbuild thanh dist/shell.bundle.js). Thay launcher popup cu (chuoi JS ~500 dong trong file nay).
 */
export function buildLauncherScript(homeUrl: string | undefined, devCfg?: DeviceConfig): string {
  const cfg = {
    apps: buildLauncherApps(homeUrl),
    groups: Object.entries(GROUP_TITLES),
    motion: shellMotion(devCfg),
    urls: {
      osHome: LAUNCHER_OS_HOME_URL, ha: homeUrl || '', weather: LAUNCHER_WEATHER_URL, timer: LAUNCHER_TIMER_URL,
      cams: LAUNCHER_CAMS_URL, scenes: LAUNCHER_SCENES_URL,
    },
    bindings: { url: URL_BINDING, control: CONTROL_BINDING },
  };
  return `${LUNAR_JS}\n;window.__RWV_CFG = ${JSON.stringify(cfg)};\n${loadShellJs()}`;
}

let shellJsCache: string | null = null;
/** dist/shell.bundle.js (npm run build). Chua co (chay test/dev tu src) -> dong goi tai cho bang esbuild. */
function loadShellJs(): string {
  if (shellJsCache != null) return shellJsCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, 'shell.bundle.js'), path.join(here, '..', 'dist', 'shell.bundle.js')]) {
    try { shellJsCache = fs.readFileSync(p, 'utf8'); return shellJsCache; } catch { /* thu duong khac */ }
  }
  try {
    const esbuild = createRequire(import.meta.url)('esbuild');
    const out = esbuild.buildSync({
      entryPoints: [path.join(here, 'shell', 'main.ts')], bundle: true, format: 'iife', target: 'chrome120', write: false,
    });
    shellJsCache = out.outputFiles[0].text as string;
  } catch (e) {
    console.error('[shell] khong co dist/shell.bundle.js va khong dong goi duoc:', (e as Error).message);
    shellJsCache = '';
  }
  return shellJsCache!;
}

/** (26/09/2026 OS-2) Ve Home cua OS: mo/kich hoat tab '__system' (ghim — tao lan dau thi giu luon, khong tai lai
 * nhung lan sau). Goi tu cu chi vuot len tu mep duoi (inputRouter.ts) va nut/bieu tuong "Ung dung" trong Shell. */
export function goOsHome(dev: DeviceSession): void {
  openApp(dev, '__system').catch((e: unknown) => console.warn(`[shell] ${dev.deviceId}: ve Home that bai:`, e));
}

/**
 * (26/09/2026 OS-3) "Quay lai" (cu chi vuot tu mep trai/phai): ve muc truoc trong lich su cua TAB dang hien — gom ca
 * chuyen trang trong dashboard HA (history.pushState). Het lich su (dang o trang dau cua ung dung) -> ve man hinh chinh,
 * nhu Android. O chinh man hinh chinh thi khong lam gi.
 */
export function goBack(dev: DeviceSession): void {
  dev.tabOps.run(async () => {
    if (devices.get(dev.deviceId) !== dev) return;
    const tab = dev.tabs.get(dev.activeTabKey);
    if (!tab || tab.key === '__system') return;
    const h = await tab.session.send('Page.getNavigationHistory') as { currentIndex: number; entries: { id: number; url: string }[] };
    const prev = h.currentIndex > 0 ? h.entries[h.currentIndex - 1] : undefined;
    // Muc 'about:blank' dau lich su la trang trang luc tao tab (createTab), khong phai trang nguoi dung da xem.
    if (prev && prev.url && prev.url !== 'about:blank') {
      await tab.session.send('Page.navigateToHistoryEntry', { entryId: prev.id });
      console.log(`[app] ${dev.deviceId}: quay lai ${prev.url} (tab "${tab.key}")`);
    } else {
      await openAppNow(dev, '__system');
    }
  }).catch((e: unknown) => console.warn(`[app] ${dev.deviceId}: quay lai that bai:`, e));
}

// (26/09/2026 OS-2) So tab KHONG GHIM toi da moi thiet bi (Home Assistant + man hinh chinh luon duoc GHIM, khong
// tinh vao day). Tab dang active hoac dang phat am thanh nen (radio/nhac) khong bao gio bi don. Moi tab la mot tien
// trinh renderer Chromium song rieng — RAM addon da do thuc te ~1,1 GB/3 man hinh o che do MOT tab; gia tri nay giu
// muc tang RAM trong tam kiem soat khi mo them ung dung. Chinh qua bien moi truong neu may chu du RAM.
const MAX_APP_TABS = Math.max(0, parseInt(process.env.MAX_APP_TABS ?? '2', 10) || 2);

/** Ung dung nguoi dung co the "mo" tu Shell (khong ke Home Assistant/man hinh chinh, xu ly rieng o day). */
function resolveAppSpec(dev: DeviceSession, key: string): { kind: string; label: string; url: string; pinned: boolean } | null {
  if (key === '__system') return { kind: 'system', label: 'Màn hình chính', url: LAUNCHER_OS_HOME_URL, pinned: true };
  if (key === 'home') return dev.cfg.homeUrl ? { kind: 'ha', label: 'Home Assistant', url: dev.cfg.homeUrl, pinned: true } : null;
  const app = listAllApps(dev.cfg.homeUrl).find((a) => a.id === key && !a.hidden);
  if (!app || !app.url) return null;
  // baseKind, KHONG phai kind: nguoi dung doi bieu tuong o "Menu panel" thi kind thanh 'mdi' -> Radio/Nhac mat phat
  // nen, YouTube/TikTok khong tu dung khi roi tab (activateTab dua vao loai ung dung goc).
  return { kind: app.baseKind, label: app.label, url: app.url, pinned: false };
}

/**
 * (26/09/2026 OS-2) Mo mot ung dung: neu tab da co thi CHUYEN SANG NGAY (khong tai lai — tab van "am" trong luc
 * khong active), chua co thi tao roi chuyen sang. Goi tu Shell (thanh truot/nut/luoi ung dung goi CONTROL_BINDING
 * {app:key} — xem handleMenuControl) va tu goOsHome().
 */
function openApp(dev: DeviceSession, key: string): Promise<void> {
  return dev.tabOps.run(() => openAppNow(dev, key));
}

async function openAppNow(dev: DeviceSession, key: string): Promise<void> {
  if (devices.get(dev.deviceId) !== dev) return;  // phien da bi xoa trong luc lenh nay xep hang
  let tab = dev.tabs.get(key);
  if (!tab) {
    const spec = resolveAppSpec(dev, key);
    if (!spec) { console.warn(`[app] ${dev.deviceId}: khong biet ung dung "${key}"`); return; }
    tab = await createTab(dev, key, spec.kind, spec.pinned, spec.label);
    if (devices.get(dev.deviceId) !== dev) { closeTab(dev, key, 'phien thiet bi da bi xoa'); return; }
    // Bat screencast TRUOC (tren trang trang, an toan) roi moi dieu huong cheo nguon — xem createTab().
    await activateTab(dev, key);
    await navigateTab(dev, tab, spec.url);
  } else {
    await activateTab(dev, key);
  }
  evictIfNeeded(dev);
}

/**
 * (26/09/2026 OS-2) Don tab CU NHAT khong ghim/khong active/khong dang phat am thanh nen, cho toi khi ve duoi
 * MAX_APP_TABS hoac het ung vien (co the tam vuot han muc neu tat ca tab con lai deu duoc mien don — chap nhan
 * duoc, uu tien khong lam gian doan am thanh dang phat hon la giu dung han muc tuyet doi).
 */
function evictIfNeeded(dev: DeviceSession): void {
  for (const key of pickEvictions(dev.tabs.values(), dev.activeTabKey, MAX_APP_TABS)) closeTab(dev, key);
}

/**
 * (26/09/2026 OS-3) Chup anh thu nho cua MOT tab (JPEG ~320 px ngang, ~10 KB) cho man hinh "Gan day". Goi luc tab
 * sap roi man hinh (activateTab) — luc do trang con dang dung dung trang thai nguoi dung vua thay. Toi da 1,5 s.
 */
async function captureThumb(dev: DeviceSession, tab: Tab): Promise<void> {
  const scale = Math.min(1, 320 / dev.cfg.width);
  try {
    const r = await Promise.race([
      tab.session.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: dev.cfg.width, height: dev.cfg.height, scale },
      }) as Promise<{ data: string }>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('het gio')), 1500)),
    ]);
    if (r?.data) tab.thumb = 'data:image/jpeg;base64,' + r.data;
  } catch { /* giu anh cu (neu co) */ }
}

/** (26/09/2026) Mo man hinh "Gan day" — tu cu chi vuot-len-roi-giu o mep duoi (inputRouter.ts). */
export function openRecents(dev: DeviceSession): void {
  showRecents(dev, true).catch(() => { });
}

/** Dua danh sach "Gan day" vao Shell cua tab dang hien. open=false: chi cap nhat neu man hinh Gan day DANG mo. */
async function showRecents(dev: DeviceSession, open: boolean): Promise<void> {
  const active = dev.tabs.get(dev.activeTabKey);
  if (open && active) await captureThumb(dev, active);
  const list = recentsList(dev.tabs.values(), dev.activeTabKey);
  await dev.cdp.send('Runtime.evaluate', {
    expression: `window.__rwvShell && window.__rwvShell.recents && window.__rwvShell.recents(${JSON.stringify(list)}, ${open})`,
  }).catch(() => { });
}

/** (26/09/2026) Trang cua tab bao bat dau/ngung phat. Doi trang thai -> cap nhat the "Dang phat" tren man hinh. */
function onTabMedia(dev: DeviceSession, tab: Tab, playing: boolean): void {
  const changed = tab.mediaPlaying !== playing || !tab.mediaKnown;
  tab.mediaPlaying = playing;
  tab.mediaKnown = true;
  if (!changed) return;
  if (tab.backgroundAudio) console.log(`[app] ${dev.deviceId}: tab "${tab.key}" ${playing ? 'dang phat' : 'da dung phat'}`);
  pushDeviceStateToPage(dev);
}

function closeTab(dev: DeviceSession, key: string, reason = 'qua so tab toi da'): void {
  const tab = dev.tabs.get(key);
  if (!tab) return;
  dev.tabs.delete(key);
  const root = getRoot() as unknown as CDPRoot;
  tab.session.send('Page.stopScreencast').catch(() => { });
  root?.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => { });
  console.log(`[app] ${dev.deviceId}: dong tab "${key}" (${tab.kind}, ${reason})`);
}

/**
 * (26/09/2026 OS-2) Tao MOT tab (Chromium target + session) moi cho thiet bi: tiem day du cac script he thong
 * (khoa am thanh, ban phim ao, Shell) va dang ky moi listener CDP CUA RIENG TAB NAY — screencastFrame/frameNavigated
 * chi anh huong toi `dev` (bo dem khung, URL hien tai...) khi `dev.activeTabKey === key` (xem cac closure ben duoi),
 * nen nhieu tab song song khong dam vao nhau. Luon KET THUC bang Page.navigate toi `url` (tru 'about:blank').
 */
/**
 * (26/09/2026 OS-2, sua sau khi phat hien loi tren thiet bi that) KHONG dieu huong o day. Chi tao target/session,
 * tiem script, chuan bi viewport/codec/UA tren trang 'about:blank' ON DINH. Ban goc mot-tab CHUA TUNG dieu huong
 * truoc khi bat screencast — luon Page.startScreencast() TREN TRANG TRANG roi moi Page.navigate() sau (xem
 * activateTab() + navigateTab()). Dao nguoc thu tu (dieu huong CHEO NGUON GOC — vd ve dashboard HA — TRUOC khi
 * bat screencast) gay loi CDP that "Not attached to an active page": dieu huong cheo nguon co the khien Chrome
 * doi tien trinh renderer (site isolation) dung luc phien CDP dang gan (flatten) vao muc tieu do.
 */
async function createTab(dev: DeviceSession, key: string, kind: string, pinned: boolean, label: string): Promise<Tab> {
  const root = getRoot() as unknown as CDPRoot;
  if (!root) throw new Error('CDP not ready');

  const { targetId } = await root.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await root.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  const session = root.session(sessionId);

  await session.send('Page.enable');

  // (23/09/2026, xem buildAudioGuardScript) Tiem TRUOC bat ky script nao khac va truoc lan dieu huong dau tien.
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: buildAudioGuardScript(!dev.cfg.audioEnabled) });
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: KIOSK_KEYBOARD_SCRIPT });
  const { identifier: launcherScriptId } = await session.send(
    'Page.addScriptToEvaluateOnNewDocument', { source: buildLauncherScript(dev.cfg.homeUrl, dev.cfg) }
  );

  const tab: Tab = {
    key, kind, label, url: '', targetId, session, pinned,
    screencastOn: false,
    // Radio/Nhac: duoc phep tiep tuc keu KHI KHONG active (the "Dang phat" trong thanh trang thai dung duoc).
    backgroundAudio: kind === 'radio' || kind === 'music',
    audioAllowed: false, mediaPlaying: false, mediaKnown: false, lastUsed: Date.now(), launcherScriptId,
  };
  dev.tabs.set(key, tab);

  try {
    await session.send('Runtime.enable');
    await session.send('Runtime.addBinding', { name: URL_BINDING });
    await session.send('Runtime.addBinding', { name: CONTROL_BINDING });
    session.on('Runtime.bindingCalled', (evt: any) => {
      if (evt?.name === URL_BINDING) handleUserEnteredUrl(dev.deviceId, evt.payload);
      else if (evt?.name === CONTROL_BINDING) handleMenuControl(dev.deviceId, evt.payload, tab);
    });
    // Moi trang moi cua TAB NAY: neu dang la tab active, dua lai trang thai thiet bi vao Shell.
    session.on('Page.domContentEventFired', () => {
      const d = devices.get(dev.deviceId);
      if (d && d.activeTabKey === key) pushDeviceStateToPage(d);
    });
  } catch (e) {
    console.warn(`[device] ⚠️ Khong dang ky duoc binding cho tab "${key}" (${dev.deviceId}):`, e);
  }

  const vpOk = await setupStableViewport(session, dev.cfg.width, dev.cfg.height);
  if (!vpOk) console.warn(`[device] ⚠️ Viewport mismatch ${dev.cfg.width}x${dev.cfg.height} (tab "${key}")`);

  await verifyCodecSupport(session);

  try {
    const realUA = await getRealChromeUserAgentAsync(session);
    if (realUA) {
      await session.send('Emulation.setUserAgentOverride', { userAgent: realUA, platform: 'Linux x86_64' });
    }
  } catch { }

  session.on('Page.screencastFrame', (evt: any) => {
    session.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => { });
    // (26/09/2026 OS-2) Tab NEN (khong active) khong con Page.startScreencast bat (activateTab() da tat khi rời) —
    // nhung ve chan cho chac (vd goi dang bay trong hang doi CDP luc vua chuyen tab).
    if (dev.activeTabKey !== key) return;
    if (broadcaster.getClientCount(dev.deviceId) === 0) return;
    dev.lastActive = Date.now();
    dev.pendingB64 = evt.data;
    const now = Date.now();
    const since = dev.lastProcessedMs ? (now - dev.lastProcessedMs) : Infinity;
    if (!dev.throttleTimer) {
      const interacting = INTERACTION_BOOST_MS > 0
        && dev.lastInputMs != null
        && (now - dev.lastInputMs) < INTERACTION_BOOST_MS;
      const effInterval = interacting
        ? dev.cfg.minFrameInterval
        : (dev.tunedMinFrameIntervalMs ?? dev.cfg.minFrameInterval);
      const delay = Math.max(0, effInterval - (Number.isFinite(since) ? since : 0));
      dev.throttleTimer = setTimeout(() => flushPending(dev), delay);
    }
  });

  session.on('Page.frameNavigated', (evt: any) => {
    if (evt?.frame?.parentId) return;
    // Tai lieu moi: moi <audio>/<video> cua trang cu da mat -> khong con phat, trang moi se tu bao lai neu phat.
    if (tab.mediaKnown && tab.mediaPlaying) onTabMedia(dev, tab, false);
    if (dev.activeTabKey === key) dev.saverOn = false;  // tai lieu moi: Shell moi, khong con man hinh cho
    tab.mediaKnown = false;
    handleTabNavigation(dev, tab, evt?.frame?.url);
  });
  session.on('Page.navigatedWithinDocument', (evt: any) => {
    handleTabNavigation(dev, tab, evt?.url);
  });

  return tab;
}

/**
 * Dieu huong MOT TAB toi `url` — chi goi SAU KHI tab da active (Page.startScreencast dang chay), tru phi tab
 * dang o NEN (khong active, khong ai xem — an toan du dieu huong cheo nguon luc do, xem createTab()). Bo qua neu
 * tab da o dung URL nay roi.
 */
async function navigateTab(dev: DeviceSession, tab: Tab, url: string): Promise<void> {
  if (!url || url === 'about:blank' || tab.url === url) return;
  await tab.session.send('Page.navigate', { url }).catch((e: unknown) =>
    console.warn(`[device] ${dev.deviceId}: dieu huong tab "${tab.key}" (${url}) that bai:`, e));
  tab.url = url; // lac quan — handleTabNavigation() se xac nhan/sua lai khi Page.frameNavigated thuc su toi
}

/**
 * (18/09/2026, mo rong OS-2) DONG BO URL HAI CHIEU — theo TUNG TAB.
 *
 * Truoc day URL chi di MOT CHIEU (HA -> thiet bi). Khi nguoi dung tu cham chuyen tab tren dashboard, server khong
 * theo doi gi ca, nen thiet bi va HA deu giu gia tri cu. Phai bat CA HAI su kien Page.frameNavigated (dieu huong
 * day du) va Page.navigatedWithinDocument (dashboard HA la ung dung MOT TRANG, chuyen tab chi doi URL bang
 * history.pushState) — chi bat frameNavigated se bo sot truong hop thuong gap nhat.
 *
 * `tab.url` luon duoc cap nhat (moi tab tu theo doi URL cua chinh no, ke ca khi dang o nen); `dev.url`/"URL hien
 * tai" cua man hinh CHI doi khi day la tab DANG ACTIVE — tab nen dieu huong (vd HA tu lam moi ngam) khong duoc lam
 * "URL hien tai" nhay sang thu nguoi dung khong he thay tren man hinh.
 */
function handleTabNavigation(dev: DeviceSession, tab: Tab, url: string | undefined): void {
  if (!url || url === 'about:blank') return;
  // (26/09/2026, bat duoc boi thu tich hop) KHONG thoat som khi `tab.url === url`: navigateTab() da gan tab.url LAC
  // QUAN truoc khi Chromium bao dieu huong xong, nen dieu huong toi DUNG URL da xin (truong hop thuong gap nhat — vd
  // luc ket noi, Go Home) truoc day bi bo qua o day -> thiet bi khong nhan CurrentURL, va lenh khang dinh am thanh ben
  // duoi cung khong chay. Chong lap dua vao `dev.url` (nhu ban goc mot-tab), khong dua vao `tab.url`.
  tab.url = url;
  // Khang dinh lai trang thai am thanh MOI LAN tab nay thuc su vao mot tai lieu moi — xem buildAudioGuardScript:
  // day la cho tu sua neu lenh setTabAudioAllowed() luc kich hoat da "thua" chinh navigation nay.
  tab.session.send('Runtime.evaluate', {
    expression: `window.__rwvAudioGuard && (window.__rwvAudioAllowed = ${tab.audioAllowed});`,
  }).catch(() => { });
  if (dev.activeTabKey !== tab.key || dev.url === url) return;
  dev.url = url;
  broadcaster.sendCurrentURL(dev.deviceId, url);
  metrics.onNavigate(dev.deviceId, url);
  console.log(`[device] ${dev.deviceId}: URL doi thanh ${url} (tab "${tab.key}")`);
}

/**
 * (26/09/2026 OS-2) Chuyen tab ACTIVE cua thiet bi: dung screencast + tat tieng (tru khi dang phat nen)
 * + tam dung video tren tab CU; bat tieng + bat screencast tren tab MOI + ep gui lai khung day du. `dev.cdp` luon
 * duoc gan lai de MOI cho khac trong file (dispatch cham, self-test, VIDEO_PROBE...) tu dong noi dung tab active
 * ma khong can biet gi ve co che nhieu tab. Khong lam gi neu key da la tab active (goi lai an toan, vd luc chuyen
 * doi nhanh hoac ket noi lai voi cung tab).
 */
async function activateTab(dev: DeviceSession, key: string): Promise<void> {
  const next = dev.tabs.get(key);
  if (!next) return;
  if (dev.activeTabKey === key) { next.lastUsed = Date.now(); return; }

  const prev = dev.tabs.get(dev.activeTabKey);
  if (prev) {
    // YouTube/TikTok: DUNG video khi roi tab, tranh tieng ngam tiep tuc chay ngam voi tab khac.
    if (prev.kind === 'youtube' || prev.kind === 'tiktok') {
      prev.session.send('Runtime.evaluate', {
        expression: "document.querySelectorAll('video').forEach(function(v){try{v.pause();}catch(e){}});",
      }).catch(() => { });
    }
    setTabAudioAllowed(prev, prev.backgroundAudio);
    void captureThumb(dev, prev);  // anh cho "Gan day" — truoc khi tat screencast, khong cho
    if (prev.screencastOn) {
      prev.session.send('Page.stopScreencast').catch(() => { });
      prev.screencastOn = false;
    }
  }

  dev.activeTabKey = key;
  dev.cdp = next.session;
  dev.saverOn = false;  // man hinh cho nam trong Shell cua tab CU
  next.lastUsed = Date.now();
  setTabAudioAllowed(next, true);

  if (!next.screencastOn) {
    const canPassthrough = PASSTHROUGH_MIN_FPS > 0 && dev.cfg.maxBytesPerMessage >= 131072;
    const screencastQuality = canPassthrough ? dev.cfg.jpegQuality : SCREENCAST_JPEG_QUALITY;
    await next.session.send('Page.startScreencast', {
      format: 'jpeg', quality: screencastQuality, maxWidth: dev.cfg.width, maxHeight: dev.cfg.height,
      everyNthFrame: dev.cfg.everyNthFrame,
    }).catch((e: unknown) => console.warn(`[device] ${dev.deviceId}: khong bat duoc screencast tab "${key}":`, e));
    next.screencastOn = true;
  }
  if (next.url) {
    dev.url = next.url;
    broadcaster.sendCurrentURL(dev.deviceId, next.url);
  }
  requestFullFrameFor(dev);
  pushDeviceStateToPage(dev);
  console.log(`[app] ${dev.deviceId}: chuyen sang tab "${key}" (${next.kind})`);
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
        reloadLauncher(device).then(ok => {
          if (ok) console.log(`[device] ✓ Launcher cap nhat homeUrl cho ${id}: "${oldHomeUrl || '(rong)'}" -> "${cfg.homeUrl}"`);
        });
      }

      return device;
    }
    console.log(`[device] Reconfiguring ${id}`);
    await deleteDeviceAsync(device);
  }

  // (26/09/2026 OS-2) TAO TAB DAU TIEN — Home Assistant (ghim) neu thiet bi da bao ?home=, khong thi tab 'browser'
  // (se duoc navigateToUrl() dua ve dung tab ngay khi OpenURL dau tien toi — xem index.ts pendingOpenURLs). Phai tao
  // XONG (co session that) roi moi dua vao `devices`: cac noi khac (dispatch cham, self-test...) doc `dev.cdp` ma
  // khong kiem tra null, giong bat bien cua ban goc mot-tab (session luon san sang truoc khi thiet bi "hien dien").
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
    id: '', deviceId: id, cdp: undefined as unknown as CDPSession, cfg,
    url: '', lastActive: Date.now(), frameId: 0, prevFrameHash: 0,
    processor, selfTestRunner: new SelfTestRunner(broadcaster),
    pendingB64: undefined, throttleTimer: undefined, lastProcessedMs: undefined,
    lastBacklogLogMs: undefined,
    tunedMinFrameIntervalMs: Math.max(cfg.minFrameInterval, SAFE_START_INTERVAL_MS),
    lastInputMs: undefined,
    consecutiveFrameErrors: 0, // Cải tiến: tracking lỗi liên tiếp
    recentFrameMs: [], passthroughFrames: 0, passthroughOn: false,
    halfOn: false, halfFrames: 0, forceSharp: false,
    tabs: new Map<string, Tab>(), activeTabKey: '', tabOps: new SerialQueue(),
    lastTouchMs: Date.now(), saverOn: false,
  };

  const initialKey = cfg.homeUrl ? 'home' : 'browser';
  const initialTab = await createTab(newDevice, initialKey, cfg.homeUrl ? 'ha' : 'browser', !!cfg.homeUrl,
    cfg.homeUrl ? 'Home Assistant' : 'Trình duyệt');
  newDevice.id = initialTab.targetId;
  newDevice.cdp = initialTab.session;
  devices.set(id, newDevice);
  // activateTab() tu lam: bat screencast TRUOC (tren trang trang, an toan — xem createTab()), cho phep am thanh
  // (neu thiet bi co loa), ep gui khung day du. Dieu huong toi homeUrl chi sau khi screencast da chay.
  await activateTab(newDevice, initialKey);
  if (cfg.homeUrl) await navigateTab(newDevice, initialTab, cfg.homeUrl);

  // (24/09/2026) Xem markInteraction: gui lai khung video cuoi o do phan giai day du ngay lap tuc.
  newDevice.sharpenNow = () => {
    const dev = newDevice;
    if (!dev.lastVideoB64 || dev.pendingB64) return;
    if (dev.sharpTimer) { clearTimeout(dev.sharpTimer); dev.sharpTimer = undefined; }
    dev.forceSharp = true;
    dev.pendingB64 = dev.lastVideoB64;
    dev.lastVideoB64 = undefined;
    dev.prevFrameHash = -1;
    if (!dev.throttleTimer) dev.throttleTimer = setTimeout(() => flushPending(dev), 0);
  };

  console.log(`[device] ✓ Device ${id} ready (${cfg.width}x${cfg.height}) [${devices.size}/${MAX_DEVICES} slots used]`);
  return newDevice;
}

// (26/09/2026 OS-2) Tach khoi ensureDeviceAsync() thanh HAM CAP MODULE, nhan `dev` lam tham so thay vi dong ("moi
// tab moi thiet bi mot ham") — moi tab (createTab()) chi can goi flushPending(dev), khong can tu dinh nghia lai
// toan bo duong ong nen anh. Duong ong giai ma/nen/gui NGUYEN VEN nhu ban mot-tab: no thuoc ve THIET BI (cai gi
// dang duoc GUI toi man hinh), khong thuoc ve tab nguon — chi NGUON (session nao dang active) doi khi chuyen tab.
async function flushPending(dev: DeviceSession): Promise<void> {
    dev.throttleTimer = undefined;
    // (23/09/2026) MOT KHUNG MOT LUC — xem `flushInFlight`. Khong BO khung o
    // day: `pendingB64` luon giu khung MOI NHAT, nen hen lai mot nhip ngan la
    // khung ke tiep van la khung moi nhat tai thoi diem do.
    if (dev.flushInFlight) {
      if (!dev.throttleTimer) dev.throttleTimer = setTimeout(() => flushPending(dev), 10);
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
      const backlog = broadcaster.backlogBytes(dev.deviceId);
      const highWater = tuning().wsHighWaterBytes ?? WS_HIGH_WATER_BYTES;
      if (backlog > highWater) {
        metrics.onFrameSkipped(dev.deviceId);
        dev.lastProcessedMs = Date.now();
        if (Date.now() - (dev.lastBacklogLogMs ?? 0) > 5000) {
          dev.lastBacklogLogMs = Date.now();
          console.warn(`[device] ${dev.deviceId}: bo khung, ton dong socket ${backlog}B > ${highWater}B`);
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
        metrics.onFrameSkipped(dev.deviceId);
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
          const q = Math.max(20, Math.round(dev.processor.tuning.jpegQuality * factor));
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
            console.log(`[half] ${dev.deviceId}: bat (nhip ${fps.toFixed(1)} fps, <video> ${((dev.videoElArea ?? 0) * 100).toFixed(0)}% man hinh, ${imgBuf.length} -> ${halfJpeg.length} B/khung)`);
          }
          metrics.onFrameEncoded(dev.deviceId, out, dev.processor.stats, 0);
          dev.frameId = (dev.frameId + 1) >>> 0;
          broadcaster.sendFrameChunked(dev.deviceId, out, dev.frameId, dev.cfg.maxBytesPerMessage);
          dev.consecutiveFrameErrors = 0;
          dev.lastProcessedMs = Date.now();
          // Hen lam net: moi khung video moi dat lai dong ho.
          dev.lastVideoB64 = b64;
          if (dev.sharpTimer) clearTimeout(dev.sharpTimer);
          dev.sharpTimer = setTimeout(() => {
            dev.sharpTimer = undefined;
            if (devices.get(dev.deviceId) !== dev || dev.pendingB64 || !dev.lastVideoB64) return;
            dev.forceSharp = true;
            dev.pendingB64 = dev.lastVideoB64;
            dev.lastVideoB64 = undefined;
            dev.prevFrameHash = -1;
            if (!dev.throttleTimer) dev.throttleTimer = setTimeout(() => flushPending(dev), 0);
          }, SHARP_REFRESH_MS);
          return;
        }
      }
      if (dev.halfOn) {
        dev.halfOn = false;
        console.log(`[half] ${dev.deviceId}: tat (nhip ${fps.toFixed(1)} fps${sharpRefresh ? ', lam net' : ''})`);
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
              console.log(`[passthrough] ${dev.deviceId}: bật (nhịp ${fps.toFixed(1)} fps, ${imgBuf.length} B/khung)`);
            }
            metrics.onFrameEncoded(dev.deviceId, out, dev.processor.stats, 0);
            dev.frameId = (dev.frameId + 1) >>> 0;
            broadcaster.sendFrameChunked(dev.deviceId, out, dev.frameId, dev.cfg.maxBytesPerMessage);
            dev.consecutiveFrameErrors = 0;
            dev.lastProcessedMs = Date.now();
            return;
          }
        }
      }
      if (dev.passthroughOn) {
        dev.passthroughOn = false;
        console.log(`[passthrough] ${dev.deviceId}: tắt (nhịp ${fps.toFixed(1)} fps) — quay về đường thường`);
      }
      // ════════════════════════════════════════════════════════════════════

      let img = sharp(imgBuf);
      if (dev.cfg.rotation) img = img.rotate(dev.cfg.rotation);
      const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const _tEnc = Date.now();
      const out = await dev.processor.processFrameAsync({ data, width: info.width, height: info.height });
      metrics.onFrameEncoded(dev.deviceId, out, dev.processor.stats, Date.now() - _tEnc);
      if (out.rects.length > 0) {
        dev.frameId = (dev.frameId + 1) >>> 0;
        broadcaster.sendFrameChunked(dev.deviceId, out, dev.frameId, dev.cfg.maxBytesPerMessage);
      }

      // Cải tiến: reset bộ đếm lỗi sau frame thành công
      dev.consecutiveFrameErrors = 0;

    } catch (e) {
      // Cải tiến: đếm lỗi liên tiếp và tự restart device khi vượt ngưỡng
      dev.consecutiveFrameErrors++;
      metrics.onFrameError(dev.deviceId, (e as Error).message);
      console.warn(
        `[device] Frame error ${dev.deviceId} (${dev.consecutiveFrameErrors}/${MAX_CONSECUTIVE_FRAME_ERRORS}): ` +
        `${(e as Error).message}`
      );
      if (dev.consecutiveFrameErrors >= MAX_CONSECUTIVE_FRAME_ERRORS) {
        console.error(
          `[device] Too many consecutive frame errors on ${dev.deviceId}, scheduling device restart...`
        );
        dev.consecutiveFrameErrors = 0;
        // Restart bất đồng bộ — không block pipeline hiện tại
        setImmediate(async () => {
          try {
            const currentDev = devices.get(dev.deviceId);
            if (currentDev) {
              console.log(`[device] Restarting device ${dev.deviceId} after repeated errors`);
              await deleteDeviceAsync(currentDev);
              await ensureDeviceAsync(dev.deviceId, dev.cfg);
            }
          } catch (restartErr) {
            console.error(`[device] Restart failed for ${dev.deviceId}:`, (restartErr as Error).message);
          }
        });
      }
    } finally {
      // (25/09/2026) KHONG ghi de lastProcessedMs o day nua: truoc day nhip tinh tu luc XONG khung truoc, tuc chu ky
      // thuc = nhip + thoi gian xu ly (do do phan giai day du: 66 ms + ~35-40 ms giai nen/nen -> ~10 fps thay vi 15).
      // Moc da danh o DAU ham (xem tren) -> chu ky = max(nhip, thoi gian xu ly). Van MOT khung mot luc (flushInFlight).
      dev.flushInFlight = false;
    }}

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
  d.lastTouchMs = d.lastInputMs;
  d.saverOn = false;  // Shell tu go man hinh cho khi duoc cham (cham do bi "nuot", khong toi trang)
  // (24/09/2026) Cham luc man hinh dang o nua do phan giai: lam net NGAY, khong doi khung moi / hen gio 0,7 s.
  if (d.halfOn && d.sharpenNow) d.sharpenNow();
}

/**
 * (26/09/2026 OS-5) Goi moi 5 s (index.ts): thiet bi nao khong cham du lau (SCREENSAVER_IDLE_S), tab dang hien khong
 * phat video/camera va den nen dang sang -> hien man hinh cho tren Shell cua tab do.
 */
export function screensaverTick(): void {
  const now = Date.now();
  for (const d of devices.values()) {
    const tab = d.tabs.get(d.activeTabKey);
    if (!tab || broadcaster.getClientCount(d.deviceId) === 0) continue;
    if (!shouldShowSaver({
      now, lastTouchMs: d.lastTouchMs, idleMs: SCREENSAVER_IDLE_S * 1000, mediaPlaying: tab.mediaPlaying,
      backlightOn: d.devState ? d.devState.backlightOn : null, shown: d.saverOn,
    })) continue;
    d.saverOn = true;
    d.cdp.send('Runtime.evaluate', {
      expression: 'window.__rwvShell && window.__rwvShell.screensaver && window.__rwvShell.screensaver(true)',
    }).catch(() => { });
    console.log(`[saver] ${d.deviceId}: hien man hinh cho (tab "${tab.key}")`);
  }
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
  if (device.timer) { clearTimeout(device.timer.handle); device.timer = undefined; }
  // linkEstimates co y GIU LAI: bang thong la cua duong truyen WiFi, khong cua phien.
  // updateLinkEstimate tu dat lai moc khi thay bo dem socket moi quay ve 0.
  if (device.throttleTimer) clearTimeout(device.throttleTimer);
  // (26/09/2026 OS-2) Dong TAT CA tab cua thiet bi (khong chi tab active) — moi tab la mot Chromium target rieng.
  for (const tab of device.tabs.values()) {
    try { await tab.session.send("Page.stopScreencast").catch(() => { }); } catch { }
    try { await root?.send("Target.closeTarget", { targetId: tab.targetId }); } catch { }
  }
  device.tabs.clear();
  console.log(`[device] Device ${device.deviceId} deleted [${devices.size}/${MAX_DEVICES} slots used]`);
}
