"""select: góc xoay màn hình (0/90/180/270)."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import DarboardApi
from .entity import DashboardOSEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = next(iter((hass.data.get("dashboard_os") or {}).values()), None)
    if coordinator is None:
        return
    add([
        RotationSelect(coordinator, str(s.get("id")), str(s.get("name") or s.get("id")))
        for s in (coordinator.data or [])
    ])


class RotationSelect(DashboardOSEntity, SelectEntity):
    _attr_name = "Góc xoay"
    _attr_icon = "mdi:screen-rotation"
    _attr_options = ["0", "90", "180", "270"]

    def __init__(self, coordinator, device_id: str, name: str) -> None:
        super().__init__(coordinator, device_id, name, "rotation")

    @property
    def current_option(self) -> str | None:
        value = self.screen.get("rotation")
        return str(value) if value is not None else None

    async def async_select_option(self, option: str) -> None:
        api = DarboardApi(self.hass, self.coordinator.base)
        sid = await api.find_sid(self.device_id, r"_(xoay_man_hinh|rotation)$")
        if not sid:
            return
        await api.setting(self.device_id, sid, option)
        await self.coordinator.async_refresh()
