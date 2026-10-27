"""binary_sensor: màn hình đang kết nối hay không."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import DashboardOSEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = next(iter((hass.data.get("dashboard_os") or {}).values()), None)
    if coordinator is None:
        return
    add([
        OnlineSensor(coordinator, str(s.get("id")), str(s.get("name") or s.get("id")))
        for s in (coordinator.data or [])
    ])


class OnlineSensor(DashboardOSEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_name = "Kết nối"
    _attr_icon = "mdi:tablet-dashboard"

    def __init__(self, coordinator, device_id: str, name: str) -> None:
        super().__init__(coordinator, device_id, name, "online")

    @property
    def is_on(self) -> bool:
        return self.online
