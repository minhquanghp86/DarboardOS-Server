"""Dashboard OS: thong bao (text / anh / video / am thanh) toi cac man hinh."""
from __future__ import annotations

import logging
from datetime import timedelta

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, MANUFACTURER, MODEL

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.NOTIFY]
UPDATE_INTERVAL = timedelta(seconds=30)


class DashboardOSCoordinator(DataUpdateCoordinator[list[dict]]):
    """Hoi add-on Dashboard OS danh sach man hinh dang ket noi."""

    def __init__(self, hass: HomeAssistant, host: str) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=UPDATE_INTERVAL)
        self._base = host.rstrip("/")

    async def _async_update_data(self) -> list[dict]:
        session = async_get_clientsession(self.hass)
        screens = await self._try_json(session, "/devices", "screens")
        if screens is not None:
            return screens
        raw = await self._try_json(session, "/metrics", "devices")
        if raw is not None:
            return [
                {"id": item["id"], "name": (item.get("config") or {}).get("friendlyName") or item["id"]}
                for item in raw
                if item.get("id") and item.get("config")
            ]
        raise UpdateFailed("Dashboard OS khong tra danh sach man hinh")

    async def _try_json(self, session, path: str, key: str):
        try:
            async with session.get(
                f"{self._base}{path}", timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status >= 400:
                    return None
                payload = await resp.json(content_type=None)
        except (aiohttp.ClientError, ValueError):
            return None
        value = payload.get(key) if isinstance(payload, dict) else None
        return value if isinstance(value, list) else None


def _sync_devices(hass: HomeAssistant, entry: ConfigEntry, screens: list[dict]) -> None:
    """Tao/xoa thiet bi Home Assistant de dropdown luon khop danh sach add-on."""
    registry = dr.async_get(hass)
    seen: set[tuple[str, str]] = set()
    for item in screens or []:
        dev_id = str(item.get("id") or "").strip()
        if not dev_id:
            continue
        seen.add((DOMAIN, dev_id))
        name = str(item.get("name") or dev_id)
        existing = registry.async_get_device(identifiers={(DOMAIN, dev_id)})
        if existing is not None:
            # (27/10/2026) Cap nhat ten/nha san xuat khi doi ten hien thi (Darboard -> Dashboard)
            # async_get_or_create KHONG sua thiet bi da co.
            if existing.name != name or existing.manufacturer != MANUFACTURER or existing.model != MODEL:
                registry.async_update_device(existing.id, name=name, manufacturer=MANUFACTURER, model=MODEL)
            continue
        registry.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, dev_id)},
            name=name,
            manufacturer=MANUFACTURER,
            model=MODEL,
        )
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        if not (device.identifiers & seen):
            registry.async_remove_device(device.id)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = DashboardOSCoordinator(hass, str(entry.data[CONF_HOST]))
    await coordinator.async_config_entry_first_refresh()
    _sync_devices(hass, entry, coordinator.data)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    entry.async_on_unload(
        coordinator.async_add_listener(lambda: _sync_devices(hass, entry, coordinator.data))
    )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return ok
