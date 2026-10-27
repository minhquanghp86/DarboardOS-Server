"""Đăng ký các hành động (service) của DarboardOS cho Home Assistant.

GĐ 1: điều hướng & hiển thị.  GĐ 2: hiển thị, âm thanh, cài đặt.
Mọi hành động đều nhận `target` (device) chuẩn HA, đồng thời vẫn nhận `device` (id `esp32-…` hoặc tên màn).
"""
from __future__ import annotations

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
    ]

    for name, handler, schema in registrations:
        if already(name):
            continue
        extra: dict[str, Any] = {}
        if name == SERVICE_SCREENSHOT:
            extra["supports_response"] = SupportsResponse.OPTIONAL
        hass.services.async_register(DOMAIN, name, handler, schema=schema, **extra)
        _LOGGER.debug("DarboardOS: đăng ký hành động %s.%s", DOMAIN, name)
