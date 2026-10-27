"""Tên miền + tên hành động (service) của tích hợp DarboardOS."""

DOMAIN = "dashboard_os"
DEFAULT_HOST = "http://172.30.32.1:18080"

MANUFACTURER = "Dashboard OS"
MODEL = "Màn hình Dashboard OS"

# (27/10/2026) GĐ 1 — điều hướng & hiển thị
SERVICE_OPEN_APP = "open_app"
SERVICE_OPEN_URL = "open_url"
SERVICE_NAV = "nav"
SERVICE_WAKE = "wake"
SERVICE_LOCK = "lock"
SERVICE_RELOAD = "reload"
SERVICE_CLOSE_APP = "close_app"
SERVICE_SCREENSHOT = "screenshot"

# (27/10/2026) GĐ 2 — hiển thị, âm thanh, cài đặt
SERVICE_SET_BRIGHTNESS = "set_brightness"
SERVICE_SET_VOLUME = "set_volume"
SERVICE_SET_QUALITY = "set_quality"
SERVICE_SET_ROTATION = "set_rotation"
SERVICE_SET_DND = "set_dnd"
SERVICE_SET_NO_SLEEP = "set_no_sleep"
SERVICE_SET_SCREENSAVER = "set_screensaver"
SERVICE_SET_SETTING = "set_setting"
SERVICE_SAY = "say"

# (27/10/2026) GĐ 3 — báo thức
SERVICE_ALARM_CREATE = "alarm_create"
SERVICE_ALARM_DELETE = "alarm_delete"
SERVICE_ALARM_LIST = "alarm_list"
SERVICE_ALARM_SET_ENABLED = "alarm_set_enabled"
SERVICE_ALARM_STOP = "alarm_stop"
SERVICE_ALARM_SNOOZE = "alarm_snooze"
