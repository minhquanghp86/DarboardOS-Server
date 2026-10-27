"""Client HTTP dùng chung cho tích hợp DarboardOS (bản 1.4.0).

Một nơi duy nhất gọi add-on: chuẩn hoá lỗi, timeout, và ánh xạ thiết bị Home Assistant ↔ id `esp32-…`.
"""
from __future__ import annotations

import json as jsonlib
import logging
from typing import Any, Iterable

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

CONNECT_TIMEOUT = 15
SHOT_TIMEOUT = 20


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Iterable):
        return [str(v) for v in value if v]
    return [str(value)]


class DarboardApi:
    """Gọi add-on DarboardOS (màn hình ESP32)."""

    def __init__(self, hass: HomeAssistant, base: str) -> None:
        self.hass = hass
        self.base = base.rstrip("/")

    # ── HTTP ────────────────────────────────────────────────────────────────
    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any | None = None,
        data: Any | None = None,
        headers: dict[str, str] | None = None,
        timeout: int = CONNECT_TIMEOUT,
        raw: bool = False,
    ) -> Any:
        session = async_get_clientsession(self.hass)
        url = f"{self.base}{path}"
        try:
            async with session.request(
                method,
                url,
                json=json,
                data=data,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    # (27/10/2026) add-on trả {"ok":false,"error":"..."} -> đưa đúng câu lỗi cho người dùng
                    msg = body
                    try:
                        payload = jsonlib.loads(body)
                        if isinstance(payload, dict):
                            msg = str(payload.get("error") or payload.get("message") or body)
                    except ValueError:
                        pass
                    raise HomeAssistantError(f"DarboardOS: {msg[:300]}")
                if raw:
                    return await resp.read()
                if resp.status == 204:
                    return None
                try:
                    return await resp.json(content_type=None)
                except ValueError:
                    return await resp.text()
        except aiohttp.ClientError as err:
            raise HomeAssistantError(f"Không kết nối được DarboardOS ({url}): {err}") from err

    # ── Thiết bị ────────────────────────────────────────────────────────────
    def identifier(self, device_id: str) -> str | None:
        """device_id của HA -> id `esp32-…` của add-on."""
        if not device_id:
            return None
        dev = dr.async_get(self.hass).async_get(device_id)
        if dev is None:
            return None
        for domain, ident in dev.identifiers:
            if domain == DOMAIN:
                return ident
        for conn_type, conn_id in dev.connections:
            if str(conn_type) == "mac":
                return "esp32-" + conn_id.replace(":", "").replace("-", "").lower()
        return None

    def _by_name(self, name: str) -> str | None:
        """Tên hiển thị (hoặc một phần tên) -> id thiết bị."""
        needle = name.strip().lower()
        if not needle:
            return None
        for dev in dr.async_get(self.hass).devices.values():
            if not any(d == DOMAIN for d, _ in dev.identifiers):
                continue
            label = (dev.name_by_user or dev.name or "").lower()
            if label == needle:
                return self.identifier(dev.id)
        for dev in dr.async_get(self.hass).devices.values():
            if not any(d == DOMAIN for d, _ in dev.identifiers):
                continue
            label = (dev.name_by_user or dev.name or "").lower()
            if needle in label:
                return self.identifier(dev.id)
        return None

    async def screens(self) -> list[dict]:
        payload = await self._request("GET", "/screens/list")
        screens = payload.get("screens") if isinstance(payload, dict) else None
        return screens if isinstance(screens, list) else []

    async def resolve(self, data: dict) -> list[str]:
        """Lấy danh sách id đích từ `target` (device_id) + `device` (id/tên). Bỏ trống = mọi màn."""
        ids: list[str] = []
        for value in _as_list(data.get("device_id")):
            ident = self.identifier(value)
            ids.append(ident or value)
        for value in _as_list(data.get("device")):
            if value == "all":
                return ["all"]
            if value.startswith("esp32-"):
                ids.append(value)
                continue
            ident = self.identifier(value) or self._by_name(value)
            ids.append(ident or value)
        if not ids:
            return ["all"]
        if "all" in ids:
            return ["all"]
        return list(dict.fromkeys(ids))

    async def online_screens(self) -> list[str]:
        return [str(s.get("id")) for s in await self.screens() if s.get("on") or s.get("online")]

    # ── Hành động ───────────────────────────────────────────────────────────
    async def act(self, device: str, **payload: Any) -> None:
        await self._request("POST", "/screens/act", json={"id": device, **payload})

    async def key(self, device: str, key: str) -> None:
        await self._request("POST", "/control/key", json={"dev": device, "key": key})

    async def settings(self, device: str) -> list[dict]:
        payload = await self._request("GET", f"/screens/settings?id={device}")
        view = payload.get("view") if isinstance(payload, dict) else None
        items = view.get("items") if isinstance(view, dict) else None
        return items if isinstance(items, list) else []

    async def setting(self, device: str, sid: str, value: Any) -> None:
        await self._request("POST", "/screens/set", json={"id": device, "sid": sid, "v": value})

    async def find_sid(self, device: str, suffix_re: str) -> str | None:
        import re

        pattern = re.compile(suffix_re)
        for item in await self.settings(device):
            sid = str(item.get("id") or "")
            if pattern.search(sid):
                return sid
        return None

    async def shot(self, device: str) -> bytes:
        return await self._request("GET", f"/screens/shot?id={device}", raw=True, timeout=SHOT_TIMEOUT)

    # ── Báo thức ────────────────────────────────────────────────────────────
    async def alarms(self, device: str | None = None) -> dict:
        """Danh sách báo thức + giờ reo kế tiếp + thông tin màn hình."""
        path = "/alarm/list" + (f"?dev={device}" if device else "")
        payload = await self._request("GET", path)
        return payload if isinstance(payload, dict) else {"alarms": []}

    async def alarm_save(self, alarm: dict) -> dict:
        payload = await self._request("POST", "/alarm/save", json=alarm)
        return payload if isinstance(payload, dict) else {}

    async def alarm_delete(self, alarm_id: str) -> bool:
        payload = await self._request("POST", "/alarm/del", json={"id": alarm_id})
        return bool((payload or {}).get("ok")) if isinstance(payload, dict) else True

    async def alarm_toggle(self, alarm_id: str, enabled: bool) -> bool:
        payload = await self._request("POST", f"/alarm/toggle?id={alarm_id}&on={1 if enabled else 0}", json={})
        return bool((payload or {}).get("ok")) if isinstance(payload, dict) else True

    async def alarm_stop(self, alarm_id: str) -> bool:
        payload = await self._request("POST", f"/alarm/stop?id={alarm_id}", json={})
        return bool((payload or {}).get("ok")) if isinstance(payload, dict) else False

    async def alarm_snooze(self, alarm_id: str) -> bool:
        payload = await self._request("POST", f"/alarm/snooze?id={alarm_id}", json={})
        return bool((payload or {}).get("ok")) if isinstance(payload, dict) else False

    # ── GĐ 4: nâng cao ──────────────────────────────────────────────────────
    async def metrics(self) -> dict[str, dict]:
        """Chỉ số từng màn (fps, decode, heap, chất lượng, gói tin)."""
        payload = await self._request("GET", "/metrics")
        devices = payload.get("devices") if isinstance(payload, dict) else None
        return {str(d.get("id")): d for d in devices or [] if isinstance(d, dict)}

    async def cast_iptv(self, device: str, channel: str) -> dict:
        payload = await self._request("POST", "/iptv/cast", json={"dev": device, "ch": channel})
        return payload if isinstance(payload, dict) else {}

    async def touch(self, device: str, kind: str, x: float, y: float) -> None:
        await self._request("POST", "/control/input", json={"dev": device, "kind": kind, "x": x, "y": y})

    async def gesture(self, device: str, points: list[dict], start: bool = True, end: bool = True) -> None:
        await self._request("POST", "/control/gesture",
                            json={"dev": device, "points": points, "start": start, "end": end})

    async def info(self, device: str) -> dict:
        payload = await self._request("GET", f"/screens/info?id={device}")
        screen = payload.get("screen") if isinstance(payload, dict) else None
        return screen if isinstance(screen, dict) else {}


async def apply_to_targets(
    hass: HomeAssistant, base: str, data: dict, action
) -> list[str]:
    """Chạy `action(device_id)` cho từng màn đích; trả danh sách id đã xử lý.

    `action` là hàm async nhận id thiết bị của add-on. Nếu chọn "all" thì lấy các màn đang kết nối.
    """
    api = DarboardApi(hass, base)
    targets = await api.resolve(data)
    if targets == ["all"]:
        targets = await api.online_screens()
    handled: list[str] = []
    for device in targets:
        await action(device)
        handled.append(device)
    return handled
