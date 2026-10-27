"""sensor: ứng dụng đang mở, màn đang khoá/chờ, độ sáng, âm lượng."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import DashboardOSEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = next(iter((hass.data.get("dashboard_os") or {}).values()), None)
    if coordinator is None:
        return
    entities = []
    for s in coordinator.data or []:
        did, name = str(s.get("id")), str(s.get("name") or s.get("id"))
        entities.append(AppSensor(coordinator, did, name))
        entities.append(StateSensor(coordinator, did, name))
    add(entities)


class AppSensor(DashboardOSEntity, SensorEntity):
    _attr_name = "Ứng dụng đang mở"
    _attr_icon = "mdi:apps"

    def __init__(self, coordinator, device_id: str, name: str) -> None:
        super().__init__(coordinator, device_id, name, "app")

    @property
    def native_value(self) -> str | None:
        app = (self.screen.get("app") or {}).get("l")
        return str(app) if app else None

    @property
    def extra_state_attributes(self) -> dict:
        app = self.screen.get("app") or {}
        return {"kind": app.get("k"), "id": app.get("id") if "id" in app else None}


class StateSensor(DashboardOSEntity, SensorEntity):
    _attr_name = "Trạng thái màn hình"
    _attr_icon = "mdi:monitor"

    def __init__(self, coordinator, device_id: str, name: str) -> None:
        super().__init__(coordinator, device_id, name, "state")

    @property
    def native_value(self) -> str:
        s = self.screen
        if not self.online:
            return "offline"
        if s.get("locked"):
            return "khoá"
        if s.get("saver"):
            return "màn hình chờ"
        if s.get("dnd"):
            return "không làm phiền"
        return "đang dùng"

    @property
    def extra_state_attributes(self) -> dict:
        s = self.screen
        return {
            "do_sang": s.get("b"),
            "am_luong": s.get("v"),
            "dnd": s.get("dnd"),
            "man_hinh_cho": s.get("saver"),
            "khoa": s.get("locked"),
            "no_sleep": (s.get("tg") or {}).get("noSleep"),
            "ket_noi": s.get("nw", {}).get("k") if isinstance(s.get("nw"), dict) else None,
        }
