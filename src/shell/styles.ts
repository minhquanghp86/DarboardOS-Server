// (25/09/2026) CSS cua Shell — nam trong Shadow DOM nen trang web ben duoi khong de duoc (truoc day font dong ho bi
// trang doi). Kich thuoc theo vmin: cung ma chay tren P4 1024x600 va S3 480x480 / 480x272.
// KHONG hieu ung chay lien tuc: moi khung dong la bang thong WiFi. Chi transform/opacity/height ngan (muc 'full').
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --bg: #0f1117; --surface: #171a22; --surface-2: #232834; --surface-3: #2d3342; --line: rgba(255,255,255,0.07);
  --text: #f2f4f8; --muted: #9aa3b5; --accent: #3b82f6;
  --r-lg: clamp(14px, 3.4vmin, 26px); --r-md: clamp(10px, 2.4vmin, 18px);
  --gap: clamp(6px, 1.8vmin, 14px); --pad: clamp(10px, 2.8vmin, 22px);
  font: 400 clamp(11px, 2.6vmin, 16px)/1.3 "Be Vietnam Pro", Roboto, "Noto Sans", "DejaVu Sans", sans-serif;
  color: var(--text); -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
  position: fixed; inset: 0; pointer-events: none;
}
.ic { width: 1.25em; height: 1.25em; flex: none; display: block; }
button { font: inherit; color: inherit; border: none; background: none; padding: 0; cursor: pointer; }
button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tnum { font-variant-numeric: tabular-nums; }

/* ── Dong ho (giot nuoc o giua mep tren) — chi hien thi, cham xuyen qua ─ */
.pill { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 128px; height: 32px;
  display: flex; justify-content: center; pointer-events: none; }  /* cham xuyen qua xuong trang (tab HA) */
.pill svg.drop { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35)); }
.pill .t { position: absolute; top: 1px; left: 0; right: 0; text-align: center; font: 600 14px/19px "Be Vietnam Pro", Roboto,
  "Noto Sans", "DejaVu Sans", sans-serif; letter-spacing: 0.5px; font-variant-numeric: tabular-nums; color: #fff; pointer-events: none; }
.pill .chev { position: absolute; top: 3px; left: 50%; transform: translateX(-50%); width: 16px; height: 16px; color: #fff; }

/* ── Thanh keo xuong ──────────────────────────────────────────────────── */
.scrim { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
.scrim.on { pointer-events: auto; }
.shade { position: absolute; top: 0; left: 0; right: 0; height: 0; overflow: hidden; pointer-events: auto;
  background: var(--surface); border-radius: 0 0 var(--r-lg) var(--r-lg); box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
.shade.scroll { overflow-y: auto; overscroll-behavior: contain; }
.shade.anim { transition: height 180ms cubic-bezier(.2,.8,.2,1); }
.scrim.anim { transition: opacity 180ms linear; }
.shade-in { padding: calc(var(--pad) + 6px) var(--pad) calc(var(--pad) + 14px); display: flex; flex-direction: column; gap: var(--gap); }
.handle { position: absolute; left: 50%; bottom: 7px; width: 44px; height: 5px; margin-left: -22px; border-radius: 3px; background: rgba(255,255,255,0.28); }

.info { display: flex; align-items: center; gap: var(--gap); }
.clock { font-weight: 600; font-size: clamp(22px, 7.5vmin, 46px); line-height: 1; letter-spacing: 0.5px; font-variant-numeric: tabular-nums; }
.date { color: var(--muted); margin-top: clamp(2px, 0.8vmin, 6px); white-space: nowrap; }
.spacer { flex: 1; }
.chip { display: none; align-items: center; gap: 6px; padding: clamp(5px, 1.4vmin, 9px) clamp(9px, 2.4vmin, 15px); border-radius: 999px;
  background: var(--surface-2); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
.chip.show { display: flex; }
.chip.timer { background: rgba(249,115,22,0.22); }
.wx-ic { width: 1.4em; height: 1.4em; flex: none; }

.ctl { display: flex; flex-wrap: wrap; gap: var(--gap); align-items: stretch; }
.tiles { display: flex; gap: var(--gap); }
.tile { display: flex; align-items: center; gap: clamp(6px, 1.6vmin, 10px); height: clamp(40px, 10vmin, 58px); padding: 0 clamp(10px, 2.6vmin, 18px);
  border-radius: var(--r-md); background: var(--surface-2); font-weight: 600; white-space: nowrap; }
.tile .ic { width: 1.45em; height: 1.45em; }
.tile.on { color: #0f1117; }
/* Man hep (S3 480): o nhanh chi con bieu tuong (mau nen khi bat van cho biet trang thai) — vua mot hang */
@media (max-width: 560px) { .tile > span { display: none; } .tile { padding: 0 clamp(10px, 3vmin, 16px); } .tiles { flex: 1; justify-content: space-between; } }
.sliders { flex: 1 1 320px; display: flex; gap: var(--gap); min-width: 0; }
.slider { position: relative; flex: 1; min-width: 0; height: clamp(40px, 10vmin, 58px); border-radius: var(--r-md); background: var(--surface-2);
  overflow: hidden; touch-action: none; cursor: pointer; }
.slider .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
.slider .ic { position: absolute; left: clamp(10px, 2.6vmin, 16px); top: 50%; transform: translateY(-50%); width: 1.45em; height: 1.45em; }
.slider .pct { position: absolute; right: clamp(10px, 2.6vmin, 16px); top: 50%; transform: translateY(-50%); font-weight: 600; font-variant-numeric: tabular-nums; }

/* The "Dang phat": tab nen dang phat (Radio/Nhac) — mo lai hoac dung ngay tu thanh keo xuong */
.np { display: flex; flex-direction: column; gap: calc(var(--gap) * 0.6); }
.np-row { display: flex; align-items: center; gap: var(--gap); padding: clamp(6px, 1.6vmin, 10px) clamp(10px, 2.6vmin, 16px);
  border-radius: var(--r-md); background: rgba(234,88,12,0.18); }
.np-row .ic { width: 1.45em; height: 1.45em; color: #fdba74; }
.np-t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.np-l { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-s { color: var(--muted); font-size: 0.86em; }
.np-b { flex: none; height: clamp(32px, 8vmin, 44px); min-width: clamp(32px, 8vmin, 44px); padding: 0 clamp(10px, 2.4vmin, 16px);
  border-radius: 999px; background: var(--surface-2); font-weight: 600; display: flex; align-items: center; justify-content: center; }
.np-b.stop { padding: 0; background: #ea580c; }
.np-b.stop .ic { color: #fff; width: 1.2em; height: 1.2em; }
.np-row.busy { opacity: 0.5; }
/* Man thap (S3 480x272): cac the nam NGANG mot hang, bo dong phu — de bang khong vuot chieu cao man hinh */
@media (max-height: 320px) {
  .np { flex-direction: row; }
  .np-row { flex: 1 1 0; min-width: 0; gap: 6px; padding: 4px 6px 4px 10px; }
  .np-s, .np-row > .ic { display: none; }
}

.shortcuts { display: flex; gap: var(--gap); justify-content: space-around; padding-top: 2px; }
.sc { display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 1vmin, 7px); min-width: 0; flex: 1; max-width: 120px; }
.sc .b { width: clamp(40px, 10vmin, 58px); height: clamp(40px, 10vmin, 58px); border-radius: 50%; background: var(--surface-2);
  display: flex; align-items: center; justify-content: center; }
.sc .b .ic { width: 50%; height: 50%; }
.sc .l { font-size: 0.86em; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

/* ── Man hinh chinh cua OS (/os/home) ────────────────────────────────── */
.home { position: absolute; inset: 0; pointer-events: auto; overflow: hidden;
  background: radial-gradient(120% 90% at 15% 0%, #1d2a4a 0%, rgba(29,42,74,0) 55%),
              radial-gradient(90% 80% at 100% 100%, #2a1d44 0%, rgba(42,29,68,0) 60%), var(--bg);
  display: flex; flex-direction: column; padding: calc(var(--pad) + 26px) calc(var(--pad) * 1.6) var(--pad); gap: var(--gap); }
.widgets { display: flex; align-items: flex-end; gap: var(--gap); flex: none; }
.w-clock .clock { font-size: clamp(34px, 13vmin, 84px); font-weight: 500; }
.w-clock .date { font-size: 1.1em; }
.w-wx { display: none; align-items: center; gap: clamp(8px, 2vmin, 14px); padding: clamp(8px, 2vmin, 14px) clamp(12px, 3vmin, 20px);
  border-radius: var(--r-lg); background: rgba(255,255,255,0.07); cursor: pointer; }
.w-wx.show { display: flex; }
.w-wx .wx-ic { width: clamp(30px, 8vmin, 50px); height: clamp(30px, 8vmin, 50px); }
.w-wx .t { font-size: clamp(18px, 5.5vmin, 34px); font-weight: 600; line-height: 1; }
.w-wx .s { color: var(--muted); font-size: 0.9em; margin-top: 3px; white-space: nowrap; }
.pager { flex: 1; min-height: 0; overflow: hidden; position: relative; touch-action: pan-y; }
.pages { display: flex; height: 100%; }
.pages.anim { transition: transform 200ms cubic-bezier(.2,.8,.2,1); }
.page { flex: none; width: 100%; height: 100%; display: grid; align-content: start;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: clamp(8px, 2.4vmin, 18px) clamp(4px, 1vmin, 10px); padding-top: clamp(6px, 2vmin, 16px); }
.app { display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 1vmin, 7px); cursor: pointer; min-width: 0; }
.app-ic { width: clamp(38px, 11vmin, 66px); height: clamp(38px, 11vmin, 66px); border-radius: 26%; display: flex; align-items: center;
  justify-content: center; box-shadow: 0 3px 10px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.14); flex: none; }
.app .l { font-size: 0.92em; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dots { display: flex; justify-content: center; gap: 7px; height: 8px; flex: none; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.25); }
.dots i.on { background: #fff; }
.dock { flex: none; align-self: center; display: flex; gap: clamp(10px, 3vmin, 24px); padding: clamp(8px, 2vmin, 12px) clamp(14px, 3.4vmin, 24px);
  border-radius: calc(var(--r-lg) + 6px); background: rgba(255,255,255,0.08); }
.dock .app .l { display: none; }
.dock .app:first-child .app-ic { box-shadow: 0 0 0 2px rgba(65,189,245,0.65), 0 3px 10px rgba(0,0,0,0.35); }

/* ── Gan day (OS-3) ────────────────────────────────────────────────── */
.recents { position: absolute; inset: 0; pointer-events: auto; background: rgba(12,14,20,0.97); display: flex; flex-direction: column;
  padding: calc(var(--pad) + 8px) 0 var(--pad); gap: var(--gap); }
.recents.anim { animation: rc-in 140ms ease-out; }
@keyframes rc-in { from { opacity: 0; } }
.rc-head { display: flex; align-items: center; gap: var(--gap); padding: 0 calc(var(--pad) * 1.6); }
.rc-head .t { font-size: 1.35em; font-weight: 600; }
.rc-all { padding: clamp(6px, 1.6vmin, 10px) clamp(12px, 3vmin, 20px); border-radius: 999px; background: var(--surface-2); font-weight: 600; }
.rc-row { flex: 1; min-height: 0; display: flex; align-items: center; gap: calc(var(--gap) * 1.8); overflow-x: auto; overflow-y: hidden;
  padding: 0 calc(var(--pad) * 1.6); scroll-snap-type: x mandatory; scrollbar-width: none; }
.rc-row::-webkit-scrollbar { display: none; }
.rc { flex: none; width: clamp(140px, 29vw, 360px); display: flex; flex-direction: column; gap: clamp(6px, 1.4vmin, 10px);
  scroll-snap-align: center; touch-action: pan-x; cursor: pointer; transition: transform 160ms ease-out, opacity 160ms ease-out; }
/* can giua khi vua man hinh, van cuon duoc khi tran */
.rc:first-child { margin-left: auto; }
.rc:last-child { margin-right: auto; }
.rc-top { display: flex; align-items: center; gap: clamp(6px, 1.4vmin, 10px); min-width: 0; }
.rc-top .app-ic { width: clamp(22px, 5.5vmin, 32px); height: clamp(22px, 5.5vmin, 32px); border-radius: 28%; box-shadow: none; }
.rc-l { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-x { flex: none; width: clamp(26px, 6.5vmin, 36px); height: clamp(26px, 6.5vmin, 36px); border-radius: 50%; background: var(--surface-2);
  display: flex; align-items: center; justify-content: center; font-size: 0.95em; }
.rc-img { position: relative; aspect-ratio: var(--ar, 1.7); max-height: 62vh; border-radius: var(--r-lg); overflow: hidden; background: var(--surface-2);
  box-shadow: 0 8px 28px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; }
.rc-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rc-ph { width: 30%; aspect-ratio: 1; border-radius: 26%; display: flex; align-items: center; justify-content: center; }
.rc.cur .rc-img { box-shadow: 0 0 0 2px var(--accent), 0 8px 28px rgba(0,0,0,0.45); }
.rc.gone { opacity: 0; transform: translateY(-40%); pointer-events: none; }
.rc-empty { margin: auto; color: var(--muted); }
.recents-btn .app-ic { background: rgba(255,255,255,0.14); }
.recents-btn .app-ic .ic { width: 55%; height: 55%; }

/* ── Quay lai (OS-3) ─────────────────────────────────────────────────── */
.backbub { position: absolute; left: -10px; top: 50%; width: 52px; height: 52px; border-radius: 50%; pointer-events: none; opacity: 0;
  display: flex; align-items: center; justify-content: center; background: rgba(35,40,52,0.94); color: #fff;
  box-shadow: 0 4px 16px rgba(0,0,0,0.45); transition: opacity 120ms linear, background-color 120ms linear; }
.backbub.right { left: auto; right: -10px; }
.backbub .ic { width: 26px; height: 26px; }
.backbub.on { opacity: 1; }
.backbub.armed { background: var(--accent); }

/* ── Vuot len tu mep duoi (Home / giu = Gan day) ─────────────────────── */
.homebar { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center;
  gap: 8px; pointer-events: none; opacity: 0; transition: opacity 120ms linear; }
.homebar.on { opacity: 1; }
.hb-pill { width: clamp(90px, 22vmin, 150px); height: 6px; border-radius: 3px; background: rgba(255,255,255,0.9);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25), 0 2px 10px rgba(0,0,0,0.4); }
.homebar.armed .hb-pill { background: var(--accent); }
.hb-t { font-weight: 600; font-size: 0.95em; white-space: nowrap; padding: 5px 12px; border-radius: 999px; background: rgba(20,22,30,0.88); }
.hb-t:empty { display: none; }

/* ── Man hinh cho (OS-5) ──────────────────────────────────────────────── */
.saver { position: absolute; inset: 0; pointer-events: auto; background: #000; display: flex; align-items: center; justify-content: center; }
.saver.anim { animation: sv-in 500ms ease-out; }
@keyframes sv-in { from { opacity: 0; } }
.sv-box { display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 1.6vmin, 14px); }
.sv-clock { font-size: min(30vmin, 21vw); font-weight: 300; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: #f2f4f8; }
.sv-date { font-size: clamp(13px, 3.8vmin, 28px); color: var(--muted); }
.sv-wx { display: flex; align-items: center; gap: clamp(6px, 1.4vmin, 12px); font-size: clamp(13px, 3.6vmin, 26px); color: #cfd6e4; }
.sv-wx:empty { display: none; }
.sv-wx .wx-ic { width: 1.4em; height: 1.4em; }
.saver.night .sv-clock { color: #9a6a58; }
.saver.night .sv-date, .saver.night .sv-wx { color: #5e463d; }
.saver.night .sv-wx .wx-ic { opacity: 0.4; filter: sepia(1); }

/* ── Thong bao (OS-5) ────────────────────────────────────────────────── */
.pill.unread::after { content: ''; position: absolute; top: 6px; right: 26px; width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; }
.nt { display: flex; flex-direction: column; gap: calc(var(--gap) * 0.6); }
.nt-head { display: flex; align-items: center; gap: var(--gap); }
.nt-h { font-weight: 600; color: var(--muted); font-size: 0.9em; letter-spacing: 0.04em; text-transform: uppercase; }
.nt-clr { font-size: 0.9em; color: var(--muted); padding: 4px 8px; }
.nt-row { display: flex; align-items: center; gap: var(--gap); padding: clamp(6px, 1.5vmin, 10px) clamp(8px, 2vmin, 14px); border-radius: var(--r-md);
  background: var(--surface-2); cursor: pointer; }
.nt-ic, .to-ic { flex: none; width: clamp(30px, 7.5vmin, 44px); height: clamp(30px, 7.5vmin, 44px); border-radius: 30%; overflow: hidden;
  display: flex; align-items: center; justify-content: center; background: rgba(59,130,246,0.22); color: #93c5fd; }
.nt-ic.high, .to-ic.high { background: rgba(245,158,11,0.22); color: #fcd34d; }
.nt-ic.critical, .to-ic.critical { background: rgba(239,68,68,0.25); color: #fca5a5; }
.nt-ic img, .to-ic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nt-ic .ic, .to-ic .ic { width: 55%; height: 55%; }
.nt-txt, .to-txt { flex: 1; min-width: 0; }
.nt-top { display: flex; align-items: baseline; gap: 8px; }
.nt-t { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nt-ago { flex: none; color: var(--muted); font-size: 0.82em; }
.nt-m { color: var(--muted); font-size: 0.92em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nt-x, .to-x { flex: none; width: clamp(24px, 6vmin, 32px); height: clamp(24px, 6vmin, 32px); border-radius: 50%; display: flex; align-items: center;
  justify-content: center; color: var(--muted); }
.toast { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: min(620px, calc(100vw - 20px)); box-sizing: border-box;
  display: flex; align-items: center; gap: clamp(8px, 2vmin, 14px); padding: clamp(8px, 2vmin, 14px); border-radius: var(--r-lg);
  background: rgba(23,26,34,0.97); box-shadow: 0 10px 34px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08); pointer-events: auto; cursor: pointer; }
.toast.anim { animation: to-in 200ms cubic-bezier(.2,.8,.2,1); }
@keyframes to-in { from { transform: translate(-50%, -130%); } }
.toast.critical { box-shadow: 0 10px 34px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(239,68,68,0.8); }
.toast .to-ic { width: clamp(44px, 12vmin, 76px); height: clamp(44px, 12vmin, 76px); }
.toast.critical .to-ic { width: clamp(64px, 20vmin, 132px); height: clamp(48px, 15vmin, 100px); border-radius: var(--r-md); }
.to-t { font-weight: 700; font-size: 1.08em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.to-m { color: #cfd6e4; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ── Bao thuc ────────────────────────────────────────────────────────── */
.alarm { position: absolute; inset: 0; pointer-events: auto; background: rgba(10,12,18,0.95); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3vmin; cursor: pointer; }
.alarm .ic { width: 18vmin; height: 18vmin; color: #f97316; }
.alarm .t1 { font-size: 8vmin; font-weight: 700; }
.alarm .t2 { font-size: 4vmin; color: var(--muted); }
.alarm .btn { margin-top: 3vmin; padding: 2vmin 7vmin; border-radius: 999px; background: #f97316; font-size: 4.5vmin; font-weight: 600; }
`;
