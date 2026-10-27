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
from .services import async_setup_services

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.NOTIFY, Platform.BINARY_SENSOR, Platform.SENSOR, Platform.BUTTON, Platform.SWITCH,
             Platform.NUMBER, Platform.SELECT]
# (27/10/2026) GĐ 5: entity điều khiển 2 chiều (công tắc / thanh trượt / chọn) — có thể tắt trong Options.
CONTROL_PLATFORMS = [Platform.SWITCH, Platform.NUMBER, Platform.SELECT]
UPDATE_INTERVAL = timedelta(seconds=30)


class DashboardOSCoordinator(DataUpdateCoordinator[list[dict]]):
    """Hoi add-on Dashboard OS danh sach man hinh dang ket noi."""

    def __init__(self, hass: HomeAssistant, host: str, interval: int = 30) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN,
                         update_interval=timedelta(seconds=max(10, min(300, int(interval or 30)))))
        self.base = host.rstrip("/")
        self._rotation: dict[str, str] = {}

    async def _async_update_data(self) -> list[dict]:
        session = async_get_clientsession(self.hass)
        screens = await self._try_json(session, "/screens/list", "screens")
        if screens is not None:
            await self._merge_details(session, screens)
            return screens
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

    async def _merge_details(self, session, screens: list[dict]) -> None:
        """Gộp số đo (/metrics) + góc xoay (/screens/settings) vào từng màn."""
        metrics = await self._try_json(session, "/metrics", "devices") or []
        by_id = {str(m.get("id")): m for m in metrics if isinstance(m, dict)}
        for screen in screens:
            dev = str(screen.get("id"))
            metric = by_id.get(dev) or {}
            cfg = metric.get("config") or {}
            screen["quality"] = metric.get("appliedQuality")
            screen["interval_ms"] = metric.get("appliedMinFrameIntervalMs")
            screen["decode_ms"] = metric.get("recentMedianDecodeMs")
            screen["frame_bytes"] = metric.get("recentFrameBytes")
            screen["heap_free"] = metric.get("deviceHeapFree")
            screen["width"] = cfg.get("width")
            screen["height"] = cfg.get("height")
            if not screen.get("name"):
                screen["name"] = cfg.get("friendlyName") or dev
        # góc xoay: mỗi màn một thực thể select riêng -> chỉ lấy các màn đang online
        for screen in screens:
            if not (screen.get("online") or screen.get("on")):
                continue
            try:
                async with session.get(f"{self.base}/screens/settings?id={screen['id']}",
                                       timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status >= 400:
                        continue
                    payload = await resp.json(content_type=None)
            except (aiohttp.ClientError, ValueError):
                continue
            items = ((payload.get("view") or {}).get("items") or [])
            for item in items:
                sid = str(item.get("id") or "")
                if sid.endswith("_xoay_man_hinh") or sid.endswith("_rotation"):
                    self._rotation[str(screen["id"])] = str(item.get("value"))
                    break
        for screen in screens:
            if screen.get("rotation") is None and str(screen.get("id")) in self._rotation:
                screen["rotation"] = self._rotation[str(screen.get("id"))]

    async def _try_json(self, session, path: str, key: str):
        try:
            async with session.get(
                f"{self.base}{path}", timeout=aiohttp.ClientTimeout(total=10)
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
            # (27/10/2026) Cap nhat ten/nha san xuat khi doi ten hien thi (Darboard -> Dashboard).
            # QUAN TRONG: thiet bi cu co the KHONG gan config entry (config_entries rong) -> bo chon "Muc tieu"
            # trong automation cua HA loc theo integration se KHONG thay thiet bi nao. Luon bo sung lien ket.
            changes: dict[str, object] = {}
            if existing.name != name:
                changes["name"] = name
            if existing.manufacturer != MANUFACTURER:
                changes["manufacturer"] = MANUFACTURER
            if existing.model != MODEL:
                changes["model"] = MODEL
            if entry.entry_id not in (existing.config_entries or set()):
                changes["add_config_entry_id"] = entry.entry_id
            if changes:
                registry.async_update_device(existing.id, **changes)
                _LOGGER.info("Dashboard OS: cap nhat thiet bi %s (%s)", name, ",".join(changes))
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
    interval = entry.options.get("scan_interval", 30)
    coordinator = DashboardOSCoordinator(hass, str(entry.data[CONF_HOST]), interval)
    await coordinator.async_config_entry_first_refresh()
    _sync_devices(hass, entry, coordinator.data)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    entry.async_on_unload(
        coordinator.async_add_listener(lambda: _sync_devices(hass, entry, coordinator.data))
    )
    platforms = list(PLATFORMS)
    if entry.options.get("controls", True) is False:
        platforms = [p for p in platforms if p not in CONTROL_PLATFORMS]
    await hass.config_entries.async_forward_entry_setups(entry, platforms)
    # (27/10/2026) GĐ 1+2: đăng ký toàn bộ hành động điều khiển (open_app, nav, brightness, …).
    await async_setup_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    platforms = list(PLATFORMS)
    if entry.options.get("controls", True) is False:
        platforms = [p for p in platforms if p not in CONTROL_PLATFORMS]
    ok = await hass.config_entries.async_unload_platforms(entry, platforms)
    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return ok
