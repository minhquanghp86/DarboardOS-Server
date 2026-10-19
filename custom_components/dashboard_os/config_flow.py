"""Cau hinh qua giao dien: dia chi add-on DarboardOS."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_NAME

from .const import DEFAULT_HOST, DOMAIN


class DashboardOSConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            host = user_input[CONF_HOST].strip().rstrip("/")
            if not host.startswith(("http://", "https://")):
                host = "http://" + host
            user_input[CONF_HOST] = host
            await self.async_set_unique_id(host)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title=user_input[CONF_NAME], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_NAME, default="DarboardOS"): str,
                    vol.Required(CONF_HOST, default=DEFAULT_HOST): str,
                }
            ),
        )
