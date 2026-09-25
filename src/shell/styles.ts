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
.sliders { flex: 1 1 320px; display: flex; gap: var(--gap); min-width: 0; }
.slider { position: relative; flex: 1; min-width: 0; height: clamp(40px, 10vmin, 58px); border-radius: var(--r-md); background: var(--surface-2);
  overflow: hidden; touch-action: none; cursor: pointer; }
.slider .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
.slider .ic { position: absolute; left: clamp(10px, 2.6vmin, 16px); top: 50%; transform: translateY(-50%); width: 1.45em; height: 1.45em; }
.slider .pct { position: absolute; right: clamp(10px, 2.6vmin, 16px); top: 50%; transform: translateY(-50%); font-weight: 600; font-variant-numeric: tabular-nums; }

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

/* ── Bao thuc ────────────────────────────────────────────────────────── */
.alarm { position: absolute; inset: 0; pointer-events: auto; background: rgba(10,12,18,0.95); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3vmin; cursor: pointer; }
.alarm .ic { width: 18vmin; height: 18vmin; color: #f97316; }
.alarm .t1 { font-size: 8vmin; font-weight: 700; }
.alarm .t2 { font-size: 4vmin; color: var(--muted); }
.alarm .btn { margin-top: 3vmin; padding: 2vmin 7vmin; border-radius: 999px; background: #f97316; font-size: 4.5vmin; font-weight: 600; }
`;
