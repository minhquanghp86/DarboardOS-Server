"""number: Độ sáng · Âm lượng · Chất lượng hình."""
from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import DarboardApi
from .entity import DashboardOSEntity

NUMBERS = [
    ("brightness", "Độ sáng", 0, 100, 1, "%", "mdi:brightness-6"),
    ("volume", "Âm lượng", 0, 100, 1, "%", "mdi:volume-high"),
    ("quality", "Chất lượng hình", 0, 90, 5, "%", "mdi:image-quality"),
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = next(iter((hass.data.get("dashboard_os") or {}).values()), None)
    if coordinator is None:
        return
    entities = []
    for s in coordinator.data or []:
        did, name = str(s.get("id")), str(s.get("name") or s.get("id"))
        for key, label, lo, hi, step, unit, icon in NUMBERS:
            entities.append(ScreenNumber(coordinator, did, name, key, label, lo, hi, step, unit, icon))
    add(entities)


class ScreenNumber(DashboardOSEntity, NumberEntity):
    _attr_mode = NumberMode.SLIDER

    def __init__(self, coordinator, device_id: str, name: str, key: str, label: str,
                 lo: float, hi: float, step: float, unit: str, icon: str) -> None:
        super().__init__(coordinator, device_id, name, f"num_{key}")
        self._key = key
        self._attr_name = label
        self._attr_native_min_value = lo
        self._attr_native_max_value = hi
        self._attr_native_step = step
        self._attr_native_unit_of_measurement = unit
        self._attr_icon = icon

    @property
    def native_value(self) -> float | None:
        s = self.screen
        if self._key == "brightness":
            value = s.get("b")
        elif self._key == "volume":
            value = s.get("v")
        else:
            value = s.get("quality")
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    async def async_set_native_value(self, value: float) -> None:
        api = DarboardApi(self.hass, self.coordinator.base)
        if self._key == "brightness":
            await api.act(self.device_id, act="b", v=int(value))
        elif self._key == "volume":
            await api.act(self.device_id, act="v", v=int(value))
        else:
            await api.setting(self.device_id, "rwv.quality", int(value))
        await self.coordinator.async_refresh()
