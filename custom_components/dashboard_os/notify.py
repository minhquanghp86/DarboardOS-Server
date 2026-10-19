"""notify.dashboard_os: gui thong bao toi man hinh DarboardOS."""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

import aiohttp

from homeassistant.components.notify import NotifyEntity, NotifyEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

_LOGGER = logging.getLogger(__name__)

PRIORITIES = {"normal", "high", "critical", "urgent"}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([DashboardOSNotify(hass, entry)])


class DashboardOSNotify(NotifyEntity):
    """Mot dich thong bao: notify.dashboard_os."""

    _attr_name = "dashboard_os"
    _attr_supported_features = NotifyEntityFeature.TITLE

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._base = str(entry.data[CONF_HOST]).rstrip("/")
        self._attr_unique_id = f"{entry.entry_id}_notify"

    async def async_send_message(
        self, message: str, title: str | None = None, **kwargs
    ) -> None:
        data = kwargs.get("data") or {}
        priority = str(data.get("priority", "normal")).lower()
        if priority not in PRIORITIES:
            priority = "normal"

        payload: dict[str, object] = {
            "title": title or "",
            "message": message or "",
            "priority": priority,
        }
        for key in ("device", "app", "url", "camera"):
            if value := data.get(key):
                payload[key] = value

        for key in ("image", "video", "audio"):
            if src := data.get(key):
                if url := await self._to_url(str(src), key):
                    payload[key] = url

        session = async_get_clientsession(self.hass)
        try:
            async with session.post(
                f"{self._base}/notify",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status >= 400:
                    raise HomeAssistantError(
                        f"DarboardOS tra loi HTTP {resp.status}: {await resp.text()}"
                    )
        except aiohttp.ClientError as err:
            raise HomeAssistantError(f"Khong ket noi duoc DarboardOS: {err}") from err

    async def _to_url(self, src: str, kind: str) -> str | None:
        if src.startswith(("http://", "https://")):
            return src
        path = Path(src)
        if not path.is_absolute():
            path = Path(self.hass.config.config_dir) / src
        if not path.exists():
            _LOGGER.warning("DarboardOS: khong tim thay file %s", path)
            return None
        body = await self.hass.async_add_executor_job(path.read_bytes)
        ctype, _ = mimetypes.guess_type(str(path))
        session = async_get_clientsession(self.hass)
        try:
            async with session.post(
                f"{self._base}/notify/upload",
                data=body,
                headers={
                    "Content-Type": ctype or "application/octet-stream",
                    "X-Media-Kind": kind,
                },
                timeout=aiohttp.ClientTimeout(total=180),
            ) as resp:
                if resp.status >= 400:
                    raise HomeAssistantError(
                        f"Tai {kind} len that bai: HTTP {resp.status}"
                    )
                result = await resp.json()
                return result.get("url")
        except aiohttp.ClientError as err:
            raise HomeAssistantError(f"Tai {kind} len that bai: {err}") from err
