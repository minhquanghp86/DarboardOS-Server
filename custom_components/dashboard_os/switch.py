"""switch: Màn hình chờ · Không làm phiền · Không cho màn ngủ."""
from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import DarboardApi
from .entity import DashboardOSEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = next(iter((hass.data.get("dashboard_os") or {}).values()), None)
    if coordinator is None:
        return
    entities = []
    for s in coordinator.data or []:
        did, name = str(s.get("id")), str(s.get("name") or s.get("id"))
        entities.append(ScreenSwitch(coordinator, did, name, "saver", "Màn hình chờ", "mdi:monitor-shimmer"))
        entities.append(ScreenSwitch(coordinator, did, name, "dnd", "Không làm phiền", "mdi:minus-circle-outline"))
        entities.append(ScreenSwitch(coordinator, did, name, "no_sleep", "Không cho màn ngủ", "mdi:sleep-off"))
    add(entities)


class ScreenSwitch(DashboardOSEntity, SwitchEntity):
    def __init__(self, coordinator, device_id: str, name: str, key: str, label: str, icon: str) -> None:
        super().__init__(coordinator, device_id, name, f"sw_{key}")
        self._key = key
        self._attr_name = label
        self._attr_icon = icon

    def _state(self) -> bool:
        s = self.screen
        if self._key == "saver":
            return bool(s.get("saver"))
        if self._key == "dnd":
            return bool(s.get("dnd"))
        return bool((s.get("tg") or {}).get("noSleep"))

    @property
    def is_on(self) -> bool:
        return self._state()

    async def _act(self, **payload) -> None:
        api = DarboardApi(self.hass, self.coordinator.base)
        await api.act(self.device_id, **payload)
        await self.coordinator.async_refresh()

    async def async_turn_on(self, **kwargs) -> None:
        if self._key == "saver":
            await self._act(act="saver")
        elif self._key == "dnd":
            await self._act(act="dnd", v=1)
        else:
            await self._act(act="ns", v=1)

    async def async_turn_off(self, **kwargs) -> None:
        if self._key == "saver":
            await self._act(act="wake")
        elif self._key == "dnd":
            await self._act(act="dnd", v=0)
        else:
            await self._act(act="ns", v=0)
