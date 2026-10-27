"""Entity dùng chung cho các màn hình Dashboard OS.

Mỗi màn hình là một thiết bị; các entity gắn vào thiết bị đó nên bộ chọn "Mục tiêu" của Home Assistant
hiển thị được (trước đây thiết bị không có entity nào nên picker trống).
"""
from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER, MODEL


def screen_by_id(coordinator, device_id: str) -> dict[str, Any] | None:
    for screen in coordinator.data or []:
        if str(screen.get("id")) == device_id:
            return screen
    return None


class DashboardOSEntity(CoordinatorEntity):
    """Entity gắn với một màn hình (id `esp32-…`)."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, device_id: str, name: str, key: str) -> None:
        super().__init__(coordinator)
        self.device_id = device_id
        self._attr_unique_id = f"{device_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, device_id)},
            name=name,
            manufacturer=MANUFACTURER,
            model=MODEL,
        )

    @property
    def screen(self) -> dict[str, Any]:
        return screen_by_id(self.coordinator, self.device_id) or {}

    @property
    def online(self) -> bool:
        screen = self.screen
        return bool(screen.get("online") or screen.get("on"))

    @property
    def available(self) -> bool:
        return super().available and self.online
