#!/usr/bin/env bash
# (19/11/2026) GD11 — KIỂM CHỨNG TRÊN MÁY THẬT: "đăng nhập Home Assistant xong phải sang add-on, không đứng ở Lovelace".
#
# Script này KHÔNG tự bấm hộ bạn — nó lo phần cài đặt + ghi log + KẾT LUẬN ĐẠT/KHÔNG ĐẠT từ log chẩn đoán
# `[login] saved=… loading=… result=…` (tag DashboardOS-login) theo đúng 3 kịch bản trong yêu cầu GD11:
#
#   (a) lần đầu nhập domain → đăng nhập HA → app tự sang add-on,
#   (b) bấm "Tôi đã đăng nhập" nhiều lần → LUÔN nhắm add-on (không bao giờ nạp origin `https://<domain>/`),
#   (c) mở lại app → vào thẳng add-on (không nhấp nháy qua Lovelace).
#
# Cách dùng:
#   1. cắm điện thoại (bật USB debugging), trong Home Assistant đã có tài khoản quản trị:
#        adb devices                      # thấy serial là được
#   2. ./scripts/login-flow-check.sh install        # cài APK release (giữ dữ liệu) + xoá log cũ
#   3. ./scripts/login-flow-check.sh watch          # bắt đầu ghi log; GIỮ terminal này, thao tác trên máy theo (a)/(b)/(c)
#   4. ./scripts/login-flow-check.sh verdict        # đọc log đã ghi → in ĐẠT/KHÔNG ĐẠT cho từng kịch bản
#   5. (tuỳ chọn) ./scripts/login-flow-check.sh fresh  # xoá dữ liệu app (pm clear) để thử lại kịch bản (a) từ đầu
#
# Ghi chú: `verdict` coi là ĐẠT khi
#   - có ít nhất một dòng `result=ok` (đã vào được trang điều khiển của add-on),
#   - KHÔNG có dòng nào `loading=…/` (nạp đúng origin của HA = Lovelace) — trừ dòng có `(login-page)`.
set -u

PKG="vn.mqsmarthome.dashboardos"
TAG="DashboardOS-login"
HERE="$(cd "$(dirname "$0")" && pwd)"
APK="$HERE/../DashboardOS-release.apk"
LOG="${TMPDIR:-/tmp}/dashboardos-login.log"

need_adb() {
  command -v adb >/dev/null 2>&1 || { echo "!! Không có adb trong PATH"; exit 1; }
  adb get-state >/dev/null 2>&1 || { echo "!! Chưa có thiết bị (adb devices)"; exit 1; }
}

case "${1:-help}" in
  install)
    need_adb
    echo "→ Cài $APK (install -r, giữ dữ liệu)"
    adb install -r "$APK" || exit 1
    adb logcat -c
    echo "→ Đã cài, đã xoá log. Mở app bằng tay hoặc: adb shell monkey -p $PKG 1"
    ;;

  fresh)
    need_adb
    echo "→ Xoá toàn bộ dữ liệu app (webUrl/apiBase/cookie) để thử kịch bản (a) từ đầu"
    adb shell pm clear "$PKG"
    adb logcat -c
    adb shell monkey -p $PKG 1
    ;;

  watch)
    need_adb
    echo "→ Ghi log vào $LOG (Ctrl+C để dừng). Thao tác trên máy theo kịch bản (a) → (b) → (c)."
    adb logcat -c
    adb logcat -s "$TAG" | tee "$LOG"
    ;;

  verdict)
    [ -s "$LOG" ] || { echo "!! Chưa có $LOG — chạy '$0 watch' trước"; exit 1; }
    echo "── Tóm tắt log: $LOG"
    echo "   dòng [login]:            $(grep -c '^.*\[login\]' "$LOG" || true)"
    echo "   result=ok:               $(grep -c 'result=ok' "$LOG" || true)"
    echo "   result=ha-spa:           $(grep -c 'result=ha-spa' "$LOG" || true)"
    echo "   result=401:              $(grep -c 'result=401' "$LOG" || true)"
    echo "   saved=…”/” (webUrl hỏng  $(grep -c 'saved=…/ ' "$LOG" || true)"
    echo "   rebuild/repair:          $(grep -cE 'result=rebuild|\(webUrl không phải trang add-on\)' "$LOG" || true)"
    echo
    echo "── Những lần NẠP origin của HA (chỉ hợp lệ khi lý do là (login-page)):"
    grep -E 'loading=…/ ' "$LOG" | grep -v '(login-page)' | sed 's/^/   /' || echo "   (không có — ĐẠT)"
    echo
    ok=1
    grep -q 'result=ok' "$LOG" || { echo "!! KHÔNG có dòng result=ok (chưa vào được trang add-on)"; ok=0; }
    if grep -E 'loading=…/ ' "$LOG" | grep -qv '(login-page)'; then
      echo "!! Có lần nạp origin của HA ngoài ý muốn (xem danh sách trên)"; ok=0
    fi
    [ "$ok" = 1 ] && echo "==> ĐẠT: đã vào add-on và không nạp Lovelace ngoài ý muốn" \
                  || echo "==> KHÔNG ĐẠT: xem log $LOG (grep '[login]')"
    ;;

  *)
    sed -n '2,30p' "$0"
    ;;
esac
