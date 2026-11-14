"""Config flow for iWantToWatch integration."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
import voluptuous as vol

from .const import (
    CONF_API_KEY,
    CONF_LIMIT,
    CONF_MIN_MATCH,
    CONF_SCAN_INTERVAL,
    CONF_URL,
    CONF_USERNAME,
    DEFAULT_LIMIT,
    DEFAULT_MIN_MATCH,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)
from .coordinator import (
    CannotConnectError,
    InvalidAuthError,
    UnknownUserError,
    async_fetch_feed,
)

_LOGGER = logging.getLogger(__name__)


def _user_schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    defaults = defaults or {}
    return vol.Schema(
        {
            vol.Required(CONF_URL, default=defaults.get(CONF_URL, "http://localhost:8000")): str,
            vol.Required(CONF_API_KEY, default=defaults.get(CONF_API_KEY, "")): str,
            vol.Optional(CONF_USERNAME, default=defaults.get(CONF_USERNAME, "")): str,
            vol.Optional(CONF_LIMIT, default=defaults.get(CONF_LIMIT, DEFAULT_LIMIT)): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=50)
            ),
            vol.Optional(
                CONF_MIN_MATCH, default=defaults.get(CONF_MIN_MATCH, DEFAULT_MIN_MATCH)
            ): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional(
                CONF_SCAN_INTERVAL,
                default=defaults.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=1440)),
        }
    )


class IWantToWatchConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for iWantToWatch."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            base_url = user_input[CONF_URL].strip().rstrip("/")
            api_key = user_input[CONF_API_KEY].strip()
            username = user_input.get(CONF_USERNAME, "").strip()
            limit = user_input.get(CONF_LIMIT, DEFAULT_LIMIT)
            min_match = user_input.get(CONF_MIN_MATCH, DEFAULT_MIN_MATCH)

            try:
                payload = await async_fetch_feed(
                    self.hass,
                    base_url,
                    api_key,
                    username=username or None,
                    limit=limit,
                    min_match=min_match,
                )
            except InvalidAuthError:
                errors["base"] = "invalid_auth"
            except UnknownUserError:
                errors["base"] = "unknown_user"
            except CannotConnectError:
                errors["base"] = "cannot_connect"
            except Exception:
                _LOGGER.exception("Unexpected exception during iWantToWatch setup")
                errors["base"] = "unknown"
            else:
                unique_id = f"{base_url.lower()}::{username.lower()}"
                await self.async_set_unique_id(unique_id)
                self._abort_if_unique_id_configured()

                cleaned = {
                    CONF_URL: base_url,
                    CONF_API_KEY: api_key,
                    CONF_USERNAME: username,
                    CONF_LIMIT: limit,
                    CONF_MIN_MATCH: min_match,
                    CONF_SCAN_INTERVAL: user_input.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                }
                display_user = payload.get("user") or username or "Default"
                return self.async_create_entry(
                    title=f"iWantToWatch ({display_user})",
                    data=cleaned,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_user_schema(user_input),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Get the options flow for this handler."""
        return IWantToWatchOptionsFlow()


class IWantToWatchOptionsFlow(OptionsFlow):
    """Handle options flow for iWantToWatch."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = {**self.config_entry.data, **self.config_entry.options}
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_USERNAME,
                    default=current.get(CONF_USERNAME, ""),
                ): str,
                vol.Optional(
                    CONF_LIMIT,
                    default=current.get(CONF_LIMIT, DEFAULT_LIMIT),
                ): vol.All(vol.Coerce(int), vol.Range(min=1, max=50)),
                vol.Optional(
                    CONF_MIN_MATCH,
                    default=current.get(CONF_MIN_MATCH, DEFAULT_MIN_MATCH),
                ): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
                vol.Optional(
                    CONF_SCAN_INTERVAL,
                    default=current.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                ): vol.All(vol.Coerce(int), vol.Range(min=1, max=1440)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
