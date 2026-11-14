"""Data update coordinator and API client helpers for iWantToWatch."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    DEFAULT_LIMIT,
    DEFAULT_MIN_MATCH,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    REQUEST_TIMEOUT,
)

_LOGGER = logging.getLogger(__name__)


class CannotConnectError(Exception):
    """Error to indicate we cannot connect to iWantToWatch."""


class InvalidAuthError(Exception):
    """Error to indicate invalid API key authentication."""


class UnknownUserError(Exception):
    """Error to indicate the configured username was not found."""


async def async_fetch_feed(
    hass: HomeAssistant,
    base_url: str,
    api_key: str,
    *,
    username: str | None = None,
    limit: int = DEFAULT_LIMIT,
    min_match: int = DEFAULT_MIN_MATCH,
) -> dict[str, Any]:
    """Fetch the Home Assistant feed from iWantToWatch."""
    url = f"{base_url.rstrip('/')}/api/v1/integrations/home-assistant"
    params: dict[str, Any] = {
        "limit": limit,
        "min_match": min_match,
    }
    if username:
        params["username"] = username

    headers = {"Authorization": f"Bearer {api_key}"}
    session = async_get_clientsession(hass)

    try:
        async with asyncio.timeout(REQUEST_TIMEOUT):
            async with session.get(url, headers=headers, params=params) as resp:
                if resp.status in (401, 403):
                    raise InvalidAuthError("Invalid API key")
                if resp.status == 404:
                    raise UnknownUserError(f"Unknown user: {username}")
                if resp.status != 200:
                    text = await resp.text()
                    raise CannotConnectError(
                        f"Unexpected HTTP {resp.status} from iWantToWatch: {text[:200]}"
                    )
                data: dict[str, Any] = await resp.json()
                return data
    except (InvalidAuthError, UnknownUserError, CannotConnectError):
        raise
    except (aiohttp.ClientError, TimeoutError, ValueError) as err:
        raise CannotConnectError(f"Error communicating with iWantToWatch: {err}") from err


class IWantToWatchCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to poll iWantToWatch recommendations and shortlist."""

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        base_url: str,
        api_key: str,
        username: str | None,
        limit: int,
        min_match: int,
        scan_interval_minutes: int = DEFAULT_SCAN_INTERVAL,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=scan_interval_minutes),
        )
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.username = username or None
        self.limit = limit
        self.min_match = min_match

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch latest data from iWantToWatch."""
        try:
            return await async_fetch_feed(
                self.hass,
                self.base_url,
                self.api_key,
                username=self.username,
                limit=self.limit,
                min_match=self.min_match,
            )
        except InvalidAuthError as err:
            raise ConfigEntryAuthFailed("Invalid iWantToWatch API key") from err
        except (UnknownUserError, CannotConnectError) as err:
            raise UpdateFailed(str(err)) from err
