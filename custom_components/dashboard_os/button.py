"""button: các nút điều hướng nhanh cho từng màn hình."""
from __future__ import annotations

import time

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import DarboardApi
from .entity import DashboardOSEntity

BUTTONS = [
    ("home", "Màn hình chính", "mdi:home"),
    ("back", "Quay lại", "mdi:arrow-left"),
    ("recents", "Gần đây", "mdi:history"),
    ("wake", "Đánh thức", "mdi:weather-sunny"),
    ("reload", "Tải lại trang", "mdi:refresh"),
    ("screenshot", "Chụp màn hình", "mdi:camera"),
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = next(iter((hass.data.get("dashboard_os") or {}).values()), None)
    if coordinator is None:
        return
    entities = []
    for s in coordinator.data or []:
        did, name = str(s.get("id")), str(s.get("name") or s.get("id"))
        for key, label, icon in BUTTONS:
            entities.append(ScreenButton(coordinator, did, name, key, label, icon))
    add(entities)


class ScreenButton(DashboardOSEntity, ButtonEntity):
    def __init__(self, coordinator, device_id: str, name: str, key: str, label: str, icon: str) -> None:
        super().__init__(coordinator, device_id, name, f"btn_{key}")
        self._key = key
        self._attr_name = label
        self._attr_icon = icon

    async def async_press(self) -> None:
        api = DarboardApi(self.hass, self.coordinator.base)
        if self._key == "screenshot":
            from homeassistant.core import HomeAssistant  # noqa: F401

            body = await api.shot(self.device_id)
            folder = self.hass.config.path("www", "dashboard")
            import os

            os.makedirs(folder, exist_ok=True)
            name = f"{self.device_id}-{time.strftime('%Y%m%d-%H%M%S')}.jpg"
            with open(os.path.join(folder, name), "wb") as fh:
                fh.write(body)
        elif self._key in ("wake", "reload"):
            await api.act(self.device_id, act=self._key)
        else:
            await api.key(self.device_id, self._key)
        await self.coordinator.async_request_refresh()
