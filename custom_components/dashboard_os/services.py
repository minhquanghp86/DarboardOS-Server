"""Đăng ký các hành động (service) của DarboardOS cho Home Assistant.

GĐ 1: điều hướng & hiển thị.  GĐ 2: hiển thị, âm thanh, cài đặt.
Mọi hành động đều nhận `target` (device) chuẩn HA, đồng thời vẫn nhận `device` (id `esp32-…` hoặc tên màn).
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .api import DarboardApi, apply_to_targets
from .const import (
    DOMAIN,
    SERVICE_CAST_IPTV,
    SERVICE_GET_STATUS,
    SERVICE_LIST_SCREENS,
    SERVICE_SEND_COMMAND,
    SERVICE_SWIPE,
    SERVICE_TOUCH,
    SERVICE_ALARM_CREATE,
    SERVICE_ALARM_DELETE,
    SERVICE_ALARM_LIST,
    SERVICE_ALARM_SET_ENABLED,
    SERVICE_ALARM_SNOOZE,
    SERVICE_ALARM_STOP,
    SERVICE_CLOSE_APP,
    SERVICE_LOCK,
    SERVICE_NAV,
    SERVICE_OPEN_APP,
    SERVICE_OPEN_URL,
    SERVICE_RELOAD,
    SERVICE_SCREENSHOT,
    SERVICE_SET_BRIGHTNESS,
    SERVICE_SET_DND,
    SERVICE_SET_NO_SLEEP,
    SERVICE_SET_QUALITY,
    SERVICE_SET_ROTATION,
    SERVICE_SET_SCREENSAVER,
    SERVICE_SET_SETTING,
    SERVICE_SET_VOLUME,
    SERVICE_SAY,
    SERVICE_WAKE,
)

_LOGGER = logging.getLogger(__name__)

NAV_KEYS = ["home", "back", "recents", "unlock"]
WWW_DIR = "www/dashboard"

SCHEMA_TARGET = {
    vol.Optional("device"): vol.Any(cv.string, [cv.string]),
    vol.Optional("device_id"): vol.Any(cv.string, [cv.string]),
}
SCHEMA_OPEN_APP = vol.Schema({vol.Required("app"): cv.string, **SCHEMA_TARGET})
SCHEMA_OPEN_URL = vol.Schema({vol.Required("url"): cv.string, **SCHEMA_TARGET})
SCHEMA_NAV = vol.Schema({vol.Required("key"): vol.In(NAV_KEYS), **SCHEMA_TARGET})
SCHEMA_TARGET_ONLY = vol.Schema({**SCHEMA_TARGET})
SCHEMA_CLOSE_APP = vol.Schema({vol.Required("app"): cv.string, **SCHEMA_TARGET})
SCHEMA_SHOT = vol.Schema({vol.Optional("filename"): cv.string, **SCHEMA_TARGET})
SCHEMA_BRIGHTNESS = vol.Schema(
    {vol.Required("brightness"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)), **SCHEMA_TARGET}
)
SCHEMA_VOLUME = vol.Schema(
    {
        vol.Required("volume"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("mute", default=False): cv.boolean,
        **SCHEMA_TARGET,
    }
)
SCHEMA_QUALITY = vol.Schema(
    {vol.Required("quality"): vol.All(vol.Coerce(int), vol.Range(min=0, max=90)), **SCHEMA_TARGET}
)
SCHEMA_ROTATION = vol.Schema({vol.Required("rotation"): vol.In([0, 90, 180, 270, "0", "90", "180", "270"]), **SCHEMA_TARGET})
SCHEMA_BOOL = vol.Schema({vol.Required("enabled"): cv.boolean, **SCHEMA_TARGET})
SCHEMA_SETTING = vol.Schema(
    {vol.Required("setting"): cv.string, vol.Required("value"): vol.Any(str, int, float, bool), **SCHEMA_TARGET}
)
SCHEMA_SAY = vol.Schema({vol.Required("message"): cv.string, **SCHEMA_TARGET})
TIME_RE = r"^([01]\d|2[0-3]):([0-5]\d)$"
SCHEMA_ALARM_CREATE = vol.Schema(
    {
        vol.Required("time"): vol.All(cv.string, vol.Match(TIME_RE, msg="Giờ phải dạng HH:MM (00:00–23:59).")),
        vol.Optional("days"): vol.All(cv.ensure_list, [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))]),
        vol.Optional("label", default=""): cv.string,
        vol.Optional("snooze", default=10): vol.All(vol.Coerce(int), vol.In([5, 10, 15, 20, 30])),
        vol.Optional("enabled", default=True): cv.boolean,
        **SCHEMA_TARGET,
    }
)
SCHEMA_ALARM_DELETE = vol.Schema(
    {
        vol.Optional("alarm_id"): cv.string,
        vol.Optional("time"): cv.string,
        vol.Optional("label"): cv.string,
        **SCHEMA_TARGET,
    }
)
SCHEMA_ALARM_ENABLED = vol.Schema(
    {vol.Required("alarm_id"): cv.string, vol.Required("enabled"): cv.boolean}
)
SCHEMA_ALARM_ID = vol.Schema({vol.Required("alarm_id"): cv.string})
SCHEMA_ALARM_LIST = vol.Schema({**SCHEMA_TARGET})
SCHEMA_LIST_SCREENS = vol.Schema({})
SCHEMA_CAST_IPTV = vol.Schema({vol.Required("channel"): cv.string, **SCHEMA_TARGET})
SCHEMA_TOUCH = vol.Schema(
    {
        vol.Required("x"): vol.All(vol.Coerce(float), vol.Range(min=0, max=4096)),
        vol.Required("y"): vol.All(vol.Coerce(float), vol.Range(min=0, max=4096)),
        vol.Optional("kind", default="tap"): vol.In(["tap", "down", "up"]),
        **SCHEMA_TARGET,
    }
)
SCHEMA_SWIPE = vol.Schema(
    {
        vol.Required("x1"): vol.All(vol.Coerce(float), vol.Range(min=0, max=4096)),
        vol.Required("y1"): vol.All(vol.Coerce(float), vol.Range(min=0, max=4096)),
        vol.Required("x2"): vol.All(vol.Coerce(float), vol.Range(min=0, max=4096)),
        vol.Required("y2"): vol.All(vol.Coerce(float), vol.Range(min=0, max=4096)),
        vol.Optional("duration", default=0.25): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=3)),
        **SCHEMA_TARGET,
    }
)
SCHEMA_SEND_COMMAND = vol.Schema(
    {vol.Required("action"): cv.string, vol.Optional("data", default={}): dict, **SCHEMA_TARGET}
)


def _base(hass: HomeAssistant) -> str | None:
    for coordinator in (hass.data.get(DOMAIN) or {}).values():
        base = getattr(coordinator, "base", None)
        if base:
            return str(base)
    return None


async def _with_api(hass: HomeAssistant, data: dict, action) -> list[str]:
    base = _base(hass)
    if not base:
        raise HomeAssistantError("Chưa cấu hình DarboardOS (Settings → Devices & Services).")
    return await apply_to_targets(hass, base, data, action)


def _www_path(hass: HomeAssistant, name: str) -> tuple[Path, str]:
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_.") or "screen"
    if not safe.lower().endswith((".jpg", ".jpeg")):
        safe += ".jpg"
    folder = Path(hass.config.config_dir) / "www" / "dashboard"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / safe, f"/local/dashboard/{safe}"


async def async_setup_services(hass: HomeAssistant) -> None:
    """Đăng ký một lần cho toàn bộ tích hợp."""

    def already(name: str) -> bool:
        return hass.services.has_service(DOMAIN, name)

    async def handle_open_app(call: ServiceCall) -> None:
        app = str(call.data["app"]).strip()

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="app", app=app)

        await _with_api(hass, dict(call.data), run)

    async def handle_open_url(call: ServiceCall) -> None:
        url = str(call.data["url"]).strip()
        if not url.startswith(("http://", "https://")):
            raise HomeAssistantError("Địa chỉ phải bắt đầu bằng http:// hoặc https://")

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="url", url=url)

        await _with_api(hass, dict(call.data), run)

    async def handle_nav(call: ServiceCall) -> None:
        key = str(call.data["key"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.key(device, key)

        await _with_api(hass, dict(call.data), run)

    async def handle_wake(call: ServiceCall) -> None:
        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="wake")

        await _with_api(hass, dict(call.data), run)

    async def handle_lock(call: ServiceCall) -> None:
        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="lock")

        await _with_api(hass, dict(call.data), run)

    async def handle_reload(call: ServiceCall) -> None:
        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="reload")

        await _with_api(hass, dict(call.data), run)

    async def handle_close_app(call: ServiceCall) -> None:
        app = str(call.data["app"]).strip()

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="close", k=app)

        await _with_api(hass, dict(call.data), run)

    async def handle_screenshot(call: ServiceCall) -> dict[str, Any]:
        name = call.data.get("filename") or ""
        saved: list[dict[str, str]] = []

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            body = await api.shot(device)
            fname = name or f"{device}-{time.strftime('%Y%m%d-%H%M%S')}"
            path, url = _www_path(hass, fname)
            await hass.async_add_executor_job(path.write_bytes, body)
            saved.append({"device": device, "path": str(path), "url": url})

        await _with_api(hass, dict(call.data), run)
        return {"screenshots": saved}

    async def handle_brightness(call: ServiceCall) -> None:
        value = int(call.data["brightness"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="b", v=value)

        await _with_api(hass, dict(call.data), run)

    async def handle_volume(call: ServiceCall) -> None:
        value = int(call.data["volume"])
        mute = bool(call.data.get("mute"))

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="v", v=value)
            if mute:
                await api.act(device, act="mu", v=1)

        await _with_api(hass, dict(call.data), run)

    async def handle_quality(call: ServiceCall) -> None:
        value = int(call.data["quality"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.setting(device, "rwv.quality", value)

        await _with_api(hass, dict(call.data), run)

    async def handle_rotation(call: ServiceCall) -> None:
        value = str(call.data["rotation"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            sid = await api.find_sid(device, r"_(xoay_man_hinh|rotation)$")
            if not sid:
                raise HomeAssistantError(f"Màn {device} không có cài đặt góc xoay.")
            await api.setting(device, sid, value)

        await _with_api(hass, dict(call.data), run)

    async def handle_dnd(call: ServiceCall) -> None:
        enabled = bool(call.data["enabled"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="dnd", v=1 if enabled else 0)

        await _with_api(hass, dict(call.data), run)

    async def handle_no_sleep(call: ServiceCall) -> None:
        enabled = bool(call.data["enabled"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="ns", v=1 if enabled else 0)

        await _with_api(hass, dict(call.data), run)

    async def handle_screensaver(call: ServiceCall) -> None:
        enabled = bool(call.data["enabled"])

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="saver" if enabled else "wake")

        await _with_api(hass, dict(call.data), run)

    async def handle_setting(call: ServiceCall) -> None:
        sid = str(call.data["setting"]).strip()
        value = call.data["value"]
        if not sid.startswith("rwv.") and not sid.startswith(("select.", "switch.", "number.", "text.", "light.")):
            raise HomeAssistantError("`setting` phải là khoá `rwv.*` hoặc một entity_id của màn hình.")

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.setting(device, sid, value)

        await _with_api(hass, dict(call.data), run)

    async def handle_say(call: ServiceCall) -> None:
        message = str(call.data["message"]).strip()
        if not message:
            raise HomeAssistantError("Nội dung đọc không được rỗng.")

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act="say", message=message)

        await _with_api(hass, dict(call.data), run)

    # ── GĐ 3: báo thức ───────────────────────────────────────────────────────
    async def _alarm_devices(data: dict) -> Any:
        """Chọn màn reo: 'all' khi không chỉ định, ngược lại danh sách id esp32-…"""
        api = DarboardApi(hass, _base(hass) or "")
        targets = await api.resolve(dict(data))
        if targets == ["all"]:
            return "all"
        return targets

    async def handle_alarm_create(call: ServiceCall) -> dict[str, Any]:
        api = DarboardApi(hass, _base(hass) or "")
        devices = await _alarm_devices(dict(call.data))
        alarm = {
            "time": str(call.data["time"]),
            "days": list(call.data.get("days") or []),
            "label": str(call.data.get("label") or ""),
            "snooze": int(call.data.get("snooze") or 10),
            "enabled": bool(call.data.get("enabled", True)),
            "devices": devices,
        }
        res = await api.alarm_save(alarm)
        created = res.get("alarm") if isinstance(res, dict) else None
        return {"alarm": created}

    async def handle_alarm_list(call: ServiceCall) -> dict[str, Any]:
        api = DarboardApi(hass, _base(hass) or "")
        targets = await api.resolve(dict(call.data))
        dev = None if targets == ["all"] else targets[0]
        data = await api.alarms(dev)
        return data

    async def handle_alarm_delete(call: ServiceCall) -> dict[str, Any]:
        api = DarboardApi(hass, _base(hass) or "")
        alarm_id = call.data.get("alarm_id")
        removed: list[str] = []
        if alarm_id:
            await api.alarm_delete(str(alarm_id))
            removed.append(str(alarm_id))
        else:
            want_time = call.data.get("time")
            want_label = (call.data.get("label") or "").strip().lower()
            if not want_time and not want_label:
                raise HomeAssistantError("Cần `alarm_id`, hoặc `time`/`label` để chọn báo thức.")
            data = await api.alarms()
            for alarm in data.get("alarms") or []:
                if want_time and alarm.get("time") != want_time:
                    continue
                if want_label and str(alarm.get("label") or "").strip().lower() != want_label:
                    continue
                await api.alarm_delete(str(alarm["id"]))
                removed.append(str(alarm["id"]))
        return {"removed": removed}

    async def handle_alarm_set_enabled(call: ServiceCall) -> None:
        api = DarboardApi(hass, _base(hass) or "")
        await api.alarm_toggle(str(call.data["alarm_id"]), bool(call.data["enabled"]))

    async def handle_alarm_stop(call: ServiceCall) -> None:
        api = DarboardApi(hass, _base(hass) or "")
        if not await api.alarm_stop(str(call.data["alarm_id"])):
            raise HomeAssistantError("Báo thức này hiện không reo (hoặc không tồn tại).")

    async def handle_alarm_snooze(call: ServiceCall) -> None:
        api = DarboardApi(hass, _base(hass) or "")
        if not await api.alarm_snooze(str(call.data["alarm_id"])):
            raise HomeAssistantError("Báo thức này hiện không reo (hoặc không tồn tại).")

    # ── GĐ 4: nâng cao ───────────────────────────────────────────────────────
    def _status_row(screen: dict, metric: dict | None) -> dict[str, Any]:
        metric = metric or {}
        cfg = metric.get("config") or {}
        return {
            "id": str(screen.get("id")),
            "name": screen.get("name") or str(screen.get("id")),
            "online": bool(screen.get("online") or screen.get("on")),
            "width": cfg.get("width"),
            "height": cfg.get("height"),
            "app": (screen.get("app") or {}).get("l"),
            "state": "khoá" if screen.get("locked") else ("màn hình chờ" if screen.get("saver") else "đang dùng"),
            "brightness": screen.get("b"),
            "volume": screen.get("v"),
            "dnd": screen.get("dnd"),
            "quality": metric.get("appliedQuality"),
            "interval_ms": metric.get("appliedMinFrameIntervalMs"),
            "decode_ms": metric.get("recentMedianDecodeMs"),
            "frame_bytes": metric.get("recentFrameBytes"),
            "heap_free": metric.get("deviceHeapFree"),
            "connection": (screen.get("nw") or {}).get("k") if isinstance(screen.get("nw"), dict) else None,
        }

    async def handle_list_screens(call: ServiceCall) -> dict[str, Any]:
        api = DarboardApi(hass, _base(hass) or "")
        screens = await api.screens()
        metrics = await api.metrics()
        return {"screens": [_status_row(s, metrics.get(str(s.get("id")))) for s in screens],
                "count": len(screens)}

    async def handle_get_status(call: ServiceCall) -> dict[str, Any]:
        api = DarboardApi(hass, _base(hass) or "")
        metrics = await api.metrics()

        async def run(device: str) -> None:
            screen = next((s for s in await api.screens() if str(s.get("id")) == device), None)
            rows.append(_status_row(screen or {"id": device, "name": device}, metrics.get(device)))

        rows: list[dict[str, Any]] = []
        await _with_api(hass, dict(call.data), run)
        return {"screens": rows, "count": len(rows)}

    async def handle_cast_iptv(call: ServiceCall) -> dict[str, Any]:
        channel = str(call.data["channel"]).strip()
        sent: list[str] = []

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.cast_iptv(device, channel)
            sent.append(device)

        await _with_api(hass, dict(call.data), run)
        return {"sent": sent, "channel": channel}

    async def handle_touch(call: ServiceCall) -> None:
        x, y, kind = float(call.data["x"]), float(call.data["y"]), str(call.data.get("kind") or "tap")

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            if kind == "tap":
                await api.touch(device, "down", x, y)
                await asyncio.sleep(0.08)
                await api.touch(device, "up", x, y)
            else:
                await api.touch(device, kind, x, y)

        await _with_api(hass, dict(call.data), run)

    async def handle_swipe(call: ServiceCall) -> None:
        x1, y1 = float(call.data["x1"]), float(call.data["y1"])
        x2, y2 = float(call.data["x2"]), float(call.data["y2"])
        duration = float(call.data.get("duration") or 0.25)
        steps = 6

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            points = []
            for i in range(steps + 1):
                f = i / steps
                points.append({
                    "x": round(x1 + (x2 - x1) * f),
                    "y": round(y1 + (y2 - y1) * f),
                    "t": round(duration * 1000 * f),
                })
            await api.gesture(device, points)

        await _with_api(hass, dict(call.data), run)

    async def handle_send_command(call: ServiceCall) -> None:
        action = str(call.data["action"]).strip()
        extra = call.data.get("data") or {}
        if not isinstance(extra, dict) or len(extra) > 20:
            raise HomeAssistantError("`data` phải là object (tối đa 20 khoá).")
        if action in ("id",):
            raise HomeAssistantError("`action` không được là `id`.")

        async def run(device: str) -> None:
            api = DarboardApi(hass, _base(hass) or "")
            await api.act(device, act=action, **extra)

        await _with_api(hass, dict(call.data), run)

    registrations: list[tuple[str, Any, Any]] = [
        (SERVICE_OPEN_APP, handle_open_app, SCHEMA_OPEN_APP),
        (SERVICE_OPEN_URL, handle_open_url, SCHEMA_OPEN_URL),
        (SERVICE_NAV, handle_nav, SCHEMA_NAV),
        (SERVICE_WAKE, handle_wake, SCHEMA_TARGET_ONLY),
        (SERVICE_LOCK, handle_lock, SCHEMA_TARGET_ONLY),
        (SERVICE_RELOAD, handle_reload, SCHEMA_TARGET_ONLY),
        (SERVICE_CLOSE_APP, handle_close_app, SCHEMA_CLOSE_APP),
        (SERVICE_SCREENSHOT, handle_screenshot, SCHEMA_SHOT),
        (SERVICE_SET_BRIGHTNESS, handle_brightness, SCHEMA_BRIGHTNESS),
        (SERVICE_SET_VOLUME, handle_volume, SCHEMA_VOLUME),
        (SERVICE_SET_QUALITY, handle_quality, SCHEMA_QUALITY),
        (SERVICE_SET_ROTATION, handle_rotation, SCHEMA_ROTATION),
        (SERVICE_SET_DND, handle_dnd, SCHEMA_BOOL),
        (SERVICE_SET_NO_SLEEP, handle_no_sleep, SCHEMA_BOOL),
        (SERVICE_SET_SCREENSAVER, handle_screensaver, SCHEMA_BOOL),
        (SERVICE_SET_SETTING, handle_setting, SCHEMA_SETTING),
        (SERVICE_SAY, handle_say, SCHEMA_SAY),
        (SERVICE_ALARM_CREATE, handle_alarm_create, SCHEMA_ALARM_CREATE),
        (SERVICE_ALARM_LIST, handle_alarm_list, SCHEMA_ALARM_LIST),
        (SERVICE_ALARM_DELETE, handle_alarm_delete, SCHEMA_ALARM_DELETE),
        (SERVICE_ALARM_SET_ENABLED, handle_alarm_set_enabled, SCHEMA_ALARM_ENABLED),
        (SERVICE_ALARM_STOP, handle_alarm_stop, SCHEMA_ALARM_ID),
        (SERVICE_ALARM_SNOOZE, handle_alarm_snooze, SCHEMA_ALARM_ID),
        (SERVICE_LIST_SCREENS, handle_list_screens, SCHEMA_LIST_SCREENS),
        (SERVICE_GET_STATUS, handle_get_status, SCHEMA_TARGET_ONLY),
        (SERVICE_CAST_IPTV, handle_cast_iptv, SCHEMA_CAST_IPTV),
        (SERVICE_TOUCH, handle_touch, SCHEMA_TOUCH),
        (SERVICE_SWIPE, handle_swipe, SCHEMA_SWIPE),
        (SERVICE_SEND_COMMAND, handle_send_command, SCHEMA_SEND_COMMAND),
    ]

    for name, handler, schema in registrations:
        if already(name):
            continue
        extra: dict[str, Any] = {}
        if name in (SERVICE_SCREENSHOT, SERVICE_ALARM_CREATE, SERVICE_ALARM_LIST, SERVICE_ALARM_DELETE,
                    SERVICE_LIST_SCREENS, SERVICE_GET_STATUS, SERVICE_CAST_IPTV):
            extra["supports_response"] = SupportsResponse.OPTIONAL
        hass.services.async_register(DOMAIN, name, handler, schema=schema, **extra)
        _LOGGER.debug("DarboardOS: đăng ký hành động %s.%s", DOMAIN, name)
