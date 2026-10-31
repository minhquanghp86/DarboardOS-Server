#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Copyright (c) 2026 minhquanghp86
# Licensed under the Apache License, Version 2.0 (see LICENSE).
#
# (26/11/2026) SMOKE TEST tren MAY THAT — kiem tra ca chuoi "cai app -> nhan cuoc goi -> tu choi":
#   1. cai APK release (install -r)
#   2. mo app (MainActivity) va doi app khoi dong
#   3. logcat: PhoneService song (foreground service dang poll /app/incoming)
#   4. GET /app/list: lastSeen cua PHONE duoc cap nhat trong 10 s
#   5. POST /calls/start: man hinh goi -> PHONE, IncomingCallActivity phai hien
#   6. POST /app/decline: tu choi -> IncomingCallActivity phai dong
#   7. in PASS/FAIL tung buoc, exit != 0 neu co FAIL
#
# Khong can thiet bi luc viet script. Chay khi co dien thoai cam USB (hoac `adb connect <ip>`):
#
#   ADB=adb SERIAL=<serial> PHONE=<id thiet bi> API=http://192.168.10.2:18080 \
#     ./android/scripts/smoke-test.sh
#
#   # trong thu muc android/:
#   SERIAL=<serial> PHONE=<id thiet bi> ./scripts/smoke-test.sh
#
# Bien moi truong:
#   ADB       duong dan adb                    (mac dinh: adb)
#   SERIAL    serial thiet bi — BAT BUOC       (xem `adb devices -l`)
#   PHONE     id thiet bi trong /app/list — BAT BUOC (vd phone-abcd1234 / esp32-80f1b2d35fb5)
#   API       goc API server                   (mac dinh: http://192.168.10.2:18080)
#   APK       apk can cai                      (mac dinh: <repo>/android/DashboardOS-release.apk)
#   CALLER    id man hinh dung de goi          (mac dinh: esp32-80f1b2d35fb5)
#   PKG       applicationId                    (mac dinh: vn.mqsmarthome.dashboardos)
#   WAIT_APP  giay doi app khoi dong           (mac dinh: 8)
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

ADB=${ADB:-adb}
SERIAL=${SERIAL:-}
API=${API:-http://192.168.10.2:18080}
PHONE=${PHONE:-}
APK=${APK:-$ROOT/android/DashboardOS-release.apk}
CALLER=${CALLER:-esp32-80f1b2d35fb5}
PKG=${PKG:-vn.mqsmarthome.dashboardos}
WAIT_APP=${WAIT_APP:-8}

FAILS=0
PASSES=0
ok() { printf 'PASS  %s\n' "$*"; PASSES=$((PASSES + 1)); }
no() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
info() { printf '      %s\n' "$*"; }
step() { printf '\n── %s\n' "$*"; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

urlenc() {  # ma hoa 1 gia tri cho query string
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"
  else
    printf '%s' "$1" | sed -e 's/ /%20/g' -e 's/#/%23/g' -e 's/&/%26/g' -e 's/?/%3F/g'
  fi
}

HTTP_CODE=000
HTTP_BODY=''
req() {  # $1 = GET|POST, $2 = path (+query) -> dat HTTP_CODE, HTTP_BODY (chay trong shell hien tai)
  HTTP_CODE=$(curl -sS -m 15 -o "$TMPD/body" -w '%{http_code}' -X "$1" "$API$2" 2>"$TMPD/err") || HTTP_CODE=000
  HTTP_BODY=$(cat "$TMPD/body" 2>/dev/null || true)
  if [ "$HTTP_CODE" = '000' ]; then HTTP_BODY=$(cat "$TMPD/err" 2>/dev/null || true); fi
  return 0
}

json_field() {  # $1 = json, $2 = ten truong (chuoi) — in gia tri hoac rong
  local js=$1 key=$2
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
try: d=json.loads(sys.stdin.read())
except Exception: print(""); raise SystemExit
v=d.get(sys.argv[1],"") if isinstance(d,dict) else ""
print(v if isinstance(v,str) else json.dumps(v))' "$key" <<<"$js" 2>/dev/null || true
  else
    grep -o "\"$key\":\"[^\"]*\"" <<<"$js" | head -1 | cut -d'"' -f4 || true
  fi
}

lastseen_of() {  # $1 = json cua /app/list — lastSeen (ms) cua PHONE; 0 = khong co / khong doc duoc
  local js=$1
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
try: d=json.loads(sys.stdin.read())
except Exception: print(0); raise SystemExit
for p in (d.get("phones") or []):
    if str(p.get("id")) == sys.argv[1]:
        print(int(p.get("lastSeen") or 0)); break
else: print(0)' "$PHONE" <<<"$js" 2>/dev/null || echo 0
  else
    grep -o "\"id\":\"$PHONE\"[^}]*" <<<"$js" | grep -o '"lastSeen":[0-9]*' | head -1 | cut -d: -f2 || echo 0
  fi
}

activity_shown() {  # IncomingCallActivity dang hien tren man hinh?
  local out
  out=$("$ADB" -s "$SERIAL" shell dumpsys activity activities 2>/dev/null || true)
  grep -qi 'IncomingCallActivity' <<<"$out"
}

# ── 0. Kiem tra tham so ───────────────────────────────────────────────────────────────────────────
echo "Smoke test DashboardOS — API=$API  SERIAL=${SERIAL:-?}  PHONE=${PHONE:-?}"
if [ -z "$SERIAL" ]; then echo 'Thieu SERIAL (xem `adb devices -l`).' >&2; exit 2; fi
if [ -z "$PHONE" ]; then echo 'Thieu PHONE (id thiet bi trong GET /app/list).' >&2; exit 2; fi
if ! command -v "$ADB" >/dev/null 2>&1 && [ ! -x "$ADB" ]; then echo "Khong thay adb: $ADB" >&2; exit 2; fi
if [ ! -f "$APK" ]; then echo "Khong thay APK: $APK (build: cd android && ./gradlew assembleRelease)" >&2; exit 2; fi
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then echo "Khong ket noi duoc thiet bi $SERIAL." >&2; exit 2; fi

PHONE_Q=$(urlenc "$PHONE")
CALLER_Q=$(urlenc "$CALLER")

# ── 1. Cai APK ────────────────────────────────────────────────────────────────────────────────────
step '1/6 Cai APK (install -r)'
if out=$("$ADB" -s "$SERIAL" install -r "$APK" 2>&1) && grep -q 'Success' <<<"$out"; then
  ok "da cai $(basename "$APK")"
else
  no "cai APK that bai: $(tr '\n' ' ' <<<"${out:-?}" | cut -c1-200)"
  if grep -qi 'UPDATE_INCOMPATIBLE\|signatures do not match\|INSTALL_FAILED_UPDATE' <<<"${out:-}"; then
    info "app dang cai bang chu ky khac (ban debug) -> chay: $ADB -s $SERIAL uninstall $PKG  roi chay lai script"
  fi
fi

# ── 2. Mo app ─────────────────────────────────────────────────────────────────────────────────────
step "2/6 Mo app va doi ${WAIT_APP}s"
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true   # log sach: buoc 3 chi doc phien nay
if out=$("$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity" 2>&1) && ! grep -qi '^Error' <<<"$out"; then
  ok 'da gui lenh mo MainActivity'
else
  no "khong mo duoc app: $(tr '\n' ' ' <<<"${out:-?}" | cut -c1-200)"
fi
sleep "$WAIT_APP"
if "$ADB" -s "$SERIAL" shell dumpsys activity activities 2>/dev/null | grep -q "$PKG/.MainActivity"; then
  ok 'MainActivity dang hien'
else
  no 'MainActivity khong hien (app thoat / bi chan?)'
fi

# ── 3. PhoneService song ──────────────────────────────────────────────────────────────────────────
step '3/6 PhoneService song (logcat + dumpsys)'
logs=$("$ADB" -s "$SERIAL" logcat -d 2>/dev/null | grep -E 'PhoneService|dashboardos' || true)
if [ -n "$logs" ]; then
  ok "logcat co $(wc -l <<<"$logs" | tr -d ' ') dong PhoneService/dashboardos"
  info "$(tail -2 <<<"$logs" | tr '\n' '|' | cut -c1-160)"
else
  no 'logcat khong co dong PhoneService/dashboardos nao'
fi
svc=$("$ADB" -s "$SERIAL" shell dumpsys activity services "$PKG" 2>/dev/null || true)
if grep -q 'PhoneService' <<<"$svc"; then
  ok 'PhoneService dang chay (dumpsys activity services)'
else
  no 'PhoneService KHONG chay — kiem tra quyen thong bao + "Nhan cuoc goi khi app dong" trong Cai dat app'
fi

# ── 4. lastSeen cap nhat ─────────────────────────────────────────────────────────────────────────
step '4/6 GET /app/list — lastSeen cua PHONE cap nhat trong 10 s'
req GET '/app/list'
if [ "$HTTP_CODE" != '200' ]; then
  no "GET /app/list tra $HTTP_CODE (server chua chay / sai API? $(tr '\n' ' ' <<<"$HTTP_BODY" | cut -c1-120))"
else
  t0=$(lastseen_of "$HTTP_BODY")
  info "lastSeen luc dau: ${t0:-0}"
  req GET "/app/incoming?phone=$PHONE_Q"   # day nhanh: server cap nhat lastSeen khi app poll (app cung tu poll 2 s/lan)
  new=${t0:-0}
  for _ in $(seq 1 10); do
    sleep 1
    req GET '/app/list'
    new=$(lastseen_of "$HTTP_BODY")
    if [ "${new:-0}" -gt "${t0:-0}" ]; then break; fi
  done
  if [ "${new:-0}" -gt "${t0:-0}" ]; then
    ok "lastSeen tang $t0 -> $new (app dang poll server)"
  elif [ "${new:-0}" -gt 0 ]; then
    no "lastSeen khong doi trong 10 s ($new) — app khong poll? (kiem tra API tren app / mang)"
  else
    no "khong thay PHONE=$PHONE trong /app/list — app chua dang ky (kiem tra API tren app)"
  fi
fi

# ── 5. Goi tu man hinh -> dien thoai ─────────────────────────────────────────────────────────────
step "5/6 POST /calls/start?from=$CALLER&to=$PHONE"
req POST "/calls/start?from=$CALLER_Q&to=$PHONE_Q"
call=$(json_field "$HTTP_BODY" call)
if [ "$HTTP_CODE" = '200' ] && [ -n "$call" ]; then
  ok "server da tao cuoc goi $call"
  shown=no
  for _ in $(seq 1 10); do
    sleep 1
    if activity_shown; then shown=yes; break; fi
  done
  if [ "$shown" = yes ]; then
    ok 'IncomingCallActivity dang hien tren dien thoai'
  else
    no 'IncomingCallActivity KHONG hien sau 10 s (thong bao bi tat? thieu quyen SYSTEM_ALERT_WINDOW?)'
  fi
else
  no "khong tao duoc cuoc goi: HTTP $HTTP_CODE $(tr '\n' ' ' <<<"$HTTP_BODY" | cut -c1-160)"
  call=''
fi

# ── 6. Tu choi -> activity dong ──────────────────────────────────────────────────────────────────
step '6/6 POST /app/decline — IncomingCallActivity phai dong'
if [ -z "$call" ]; then
  no 'bo qua: khong co call id tu buoc 5'
else
  req POST "/app/decline?phone=$PHONE_Q&call=$(urlenc "$call")"
  if [ "$HTTP_CODE" = '200' ]; then
    ok 'server da tu choi cuoc goi'
  else
    no "POST /app/decline tra $HTTP_CODE ($(tr '\n' ' ' <<<"$HTTP_BODY" | cut -c1-120))"
  fi
  gone=no
  for _ in $(seq 1 8); do
    sleep 1
    if ! activity_shown; then gone=yes; break; fi
  done
  if [ "$gone" = yes ]; then ok 'IncomingCallActivity da dong'; else no 'IncomingCallActivity VAN hien sau 8 s'; fi
fi

# ── Ket qua ──────────────────────────────────────────────────────────────────────────────────────
printf '\n== %d PASS / %d FAIL ==\n' "$PASSES" "$FAILS"
[ "$FAILS" -eq 0 ] || exit 1
