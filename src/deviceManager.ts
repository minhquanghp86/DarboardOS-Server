import { CDPSession } from "playwright-core";
import sharp from "sharp";
import { DeviceConfig, deviceConfigsEqual } from "./config.js";
import { getRoot } from "./cdpRoot.js";
import { FrameProcessor } from "./frameProcessor.js";
import { DeviceBroadcaster } from "./broadcaster.js";
import { hash32 } from "./util.js";
import { metrics } from "./metrics.js";
import { AdaptiveState, DEFAULT_ADAPTIVE_CFG, decideAdaptive, initialAdaptiveState } from "./adaptive.js";
import { SelfTestRunner } from "./selfTest.js";
import { Encoding, FRAME_HEADER_BYTES, TILE_HEADER_BYTES } from "./protocol.js";

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

  // Cải tiến: theo dõi lỗi frame liên tiếp để tự phục hồi
  consecutiveFrameErrors: number;

  // (16/09/2026) Đường tắt "chuyển thẳng JPEG của Chrome" — xem flushPending
  recentFrameMs: number[];
  passthroughFrames: number;
  passthroughOn: boolean;
};

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
    keyboardContainer.innerHTML='';
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
      device.processor.requestFullFrame();
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
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: KIOSK_KEYBOARD_SCRIPT });
  console.log('[device] ✓ Keyboard + Telex IME registered');

  const vpOk = await setupStableViewport(session, cfg.width, cfg.height);
  if (!vpOk) console.warn(`[device] ⚠️ Viewport mismatch ${cfg.width}x${cfg.height}`);

  await verifyCodecSupport(session);

  try {
    await session.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux x86_64'
    });
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
  });

  metrics.setConfig(id, cfg);
  const newDevice: DeviceSession = {
    id: targetId, deviceId: id, cdp: session, cfg,
    url: '', lastActive: Date.now(), frameId: 0, prevFrameHash: 0,
    processor, selfTestRunner: new SelfTestRunner(broadcaster),
    pendingB64: undefined, throttleTimer: undefined, lastProcessedMs: undefined,
    consecutiveFrameErrors: 0, // Cải tiến: tracking lỗi liên tiếp
    recentFrameMs: [], passthroughFrames: 0, passthroughOn: false,
  };
  devices.set(id, newDevice);
  newDevice.processor.requestFullFrame();

  const flushPending = async () => {
    const dev = newDevice;
    dev.throttleTimer = undefined;
    const b64 = dev.pendingB64;
    dev.pendingB64 = undefined;
    if (!b64) return;
    try {
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
      dev.recentFrameMs.push(nowMs);
      if (dev.recentFrameMs.length > PASSTHROUGH_RATE_WINDOW) dev.recentFrameMs.shift();
      let fps = 0;
      if (dev.recentFrameMs.length >= PASSTHROUGH_RATE_WINDOW) {
        const span = nowMs - dev.recentFrameMs[0];
        if (span > 0) fps = (dev.recentFrameMs.length - 1) * 1000 / span;
      }

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
            processor.requestFullFrame();
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
      dev.lastProcessedMs = Date.now();
    }
  };

  session.on('Page.screencastFrame', async (evt: any) => {
    session.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => { });
    if (broadcaster.getClientCount(newDevice.deviceId) === 0) return;
    newDevice.lastActive = Date.now();
    newDevice.pendingB64 = evt.data;
    const now = Date.now();
    const since = newDevice.lastProcessedMs ? (now - newDevice.lastProcessedMs) : Infinity;
    if (!newDevice.throttleTimer) {
      const delay = Math.max(0, cfg.minFrameInterval - (Number.isFinite(since) ? since : 0));
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
  const ms = Number(process.env.CCR_REFRESH_MS ?? 60_000);
  if (!ms) return;
  for (const d of devices.values()) {
    try { d.processor.requestFullFrame(); } catch { /* bỏ qua */ }
  }
}

// (14/09/2026) GĐ3: vòng điều khiển thích nghi cho TỪNG thiết bị.
// Chạy định kỳ; đọc số đo thật (decode mới nhất do thiết bị báo, bytes/s) rồi chỉnh
// quality/nhịp. Tắt bằng biến môi trường CCR_ADAPTIVE=0.
const adaptiveStates = new Map<string, AdaptiveState>();

export function runAdaptiveTick(): void {
  if (process.env.CCR_ADAPTIVE === '0') return;
  const now = Date.now();
  const snap = metrics.snapshot();
  for (const m of snap.devices) {
    const device = devices.get(m.id);
    if (!device || !m.decodeSamples) continue;
    let st = adaptiveStates.get(m.id);
    if (!st) {
      st = initialAdaptiveState(device.cfg.jpegQuality, device.cfg.minFrameInterval, now);
      adaptiveStates.set(m.id, st);
    }
    const cfgA = { ...DEFAULT_ADAPTIVE_CFG, maxQuality: device.cfg.jpegQuality };
    const bytesPerSec = m.uptimeSec > 0 ? m.bytesSent / m.uptimeSec : 0;
    const res = decideAdaptive(
      {
        decodeMs: m.recentMaxDecodeMs ?? m.avgDecodeMs ?? null,
        bytesPerSec,
        frameErrors: m.frameErrors,
        heapFree: m.deviceHeapFree ?? null,
      },
      st,
      cfgA,
      now
    );
    adaptiveStates.set(m.id, res.state);
    if (!res.changed) continue;
    device.processor.setTuning({ jpegQuality: res.state.quality });
    device.cfg.minFrameInterval = res.state.minFrameIntervalMs;
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
  if (device.throttleTimer) clearTimeout(device.throttleTimer);
  try { await device.cdp.send("Page.stopScreencast").catch(() => { }); } catch { }
  try { await root?.send("Target.closeTarget", { targetId: device.id }); } catch { }
  console.log(`[device] Device ${device.deviceId} deleted [${devices.size}/${MAX_DEVICES} slots used]`);
}
