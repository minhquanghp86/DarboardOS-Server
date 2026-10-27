"""Cau hinh qua giao dien: dia chi add-on Dashboard OS."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_NAME

from .const import DEFAULT_HOST, DOMAIN


class DashboardOSOptionsFlow(config_entries.OptionsFlow):
    """Tuy chon: chu ky cap nhat, bat/tat nhom entity dieu khien."""

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        opts = self.config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional("scan_interval", default=int(opts.get("scan_interval", 30))): vol.All(
                        vol.Coerce(int), vol.Range(min=10, max=300)
                    ),
                    vol.Optional("controls", default=bool(opts.get("controls", True))): bool,
                }
            ),
        )


class DashboardOSConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    def async_get_options_flow(config_entry):
        return DashboardOSOptionsFlow()
