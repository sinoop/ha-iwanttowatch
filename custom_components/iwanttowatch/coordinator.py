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


class ApiError(Exception):
    """Error returned by iWantToWatch API."""


async def _async_request(
    hass: HomeAssistant,
    method: str,
    base_url: str,
    path: str,
    api_key: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> Any:
    """Perform an authenticated request to iWantToWatch."""
    url = f"{base_url.rstrip('/')}{path}"
    headers = {"Authorization": f"Bearer {api_key}"}
    session = async_get_clientsession(hass)

    try:
        async with asyncio.timeout(REQUEST_TIMEOUT):
            async with session.request(
                method, url, headers=headers, params=params, json=json_body
            ) as resp:
                if resp.status in (401, 403):
                    raise InvalidAuthError("Invalid API key or forbidden")
                if resp.status == 404:
                    raise UnknownUserError("Resource or user not found")
                if resp.status == 204:
                    return None
                if resp.status >= 400:
                    text = await resp.text()
                    raise ApiError(f"HTTP {resp.status}: {text[:200]}")
                return await resp.json()
    except (InvalidAuthError, UnknownUserError, ApiError):
        raise
    except (aiohttp.ClientError, TimeoutError, ValueError) as err:
        raise CannotConnectError(f"Error communicating with iWantToWatch: {err}") from err


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
    params: dict[str, Any] = {
        "limit": limit,
        "min_match": min_match,
    }
    if username:
        params["username"] = username
    data: dict[str, Any] = await _async_request(
        hass,
        "GET",
        base_url,
        "/api/v1/integrations/home-assistant",
        api_key,
        params=params,
    )
    return data


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

    def _user_params(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        params = dict(extra or {})
        if self.username:
            params["username"] = self.username
        return params

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
        except (UnknownUserError, CannotConnectError, ApiError) as err:
            raise UpdateFailed(str(err)) from err

    async def async_get_panel_feed(
        self, *, limit: int = 50, min_match: int = 0
    ) -> dict[str, Any]:
        """Fetch top matched movies and shortlist for the sidebar panel."""
        return await async_fetch_feed(
            self.hass,
            self.base_url,
            self.api_key,
            username=self.username,
            limit=limit,
            min_match=min_match,
        )

    async def async_search(
        self, query: str, *, year: int | None = None, limit: int = 25
    ) -> list[dict[str, Any]]:
        """Search TMDb via iWantToWatch."""
        extra: dict[str, Any] = {"query": query, "limit": limit}
        if year is not None:
            extra["year"] = year
        data: list[dict[str, Any]] = await _async_request(
            self.hass,
            "GET",
            self.base_url,
            "/api/v1/integrations/home-assistant/search",
            self.api_key,
            params=self._user_params(extra),
        )
        return data

    async def async_set_shortlist(self, tmdb_id: int, *, add: bool) -> None:
        """Add or remove a movie from the user's shortlist."""
        await _async_request(
            self.hass,
            "PUT" if add else "DELETE",
            self.base_url,
            f"/api/v1/integrations/home-assistant/titles/{tmdb_id}/shortlist",
            self.api_key,
            params=self._user_params(),
        )
        await self.async_request_refresh()

    async def async_radarr_status(self, tmdb_id: int) -> dict[str, Any]:
        """Get Radarr status for a movie."""
        data: dict[str, Any] = await _async_request(
            self.hass,
            "GET",
            self.base_url,
            f"/api/v1/integrations/home-assistant/titles/{tmdb_id}/radarr",
            self.api_key,
            params=self._user_params(),
        )
        return data

    async def async_request_radarr(self, tmdb_id: int) -> dict[str, Any]:
        """Queue a movie in Radarr."""
        data: dict[str, Any] = await _async_request(
            self.hass,
            "POST",
            self.base_url,
            f"/api/v1/integrations/home-assistant/titles/{tmdb_id}/radarr",
            self.api_key,
            params=self._user_params(),
        )
        return data

    async def async_title_detail(self, tmdb_id: int) -> dict[str, Any]:
        """Fetch full details for a movie."""
        data: dict[str, Any] = await _async_request(
            self.hass,
            "GET",
            self.base_url,
            f"/api/v1/integrations/home-assistant/titles/{tmdb_id}",
            self.api_key,
            params=self._user_params(),
        )
        return data

    async def async_set_reaction(
        self, tmdb_id: int, *, reaction: str | None, watched: bool = True
    ) -> dict[str, Any] | None:
        """Set or clear a movie's watched/reaction status."""
        if reaction is None and not watched:
            await _async_request(
                self.hass,
                "DELETE",
                self.base_url,
                f"/api/v1/integrations/home-assistant/titles/{tmdb_id}/reaction",
                self.api_key,
                params=self._user_params(),
            )
            await self.async_request_refresh()
            return None

        data: dict[str, Any] = await _async_request(
            self.hass,
            "PUT",
            self.base_url,
            f"/api/v1/integrations/home-assistant/titles/{tmdb_id}/reaction",
            self.api_key,
            params=self._user_params(),
            json_body={"reaction": reaction, "watched": watched, "tags": []},
        )
        await self.async_request_refresh()
        return data

    async def async_ask(self, text: str, *, available_only: bool = False) -> dict[str, Any]:
        """Run Ask AI natural-language search."""
        data: dict[str, Any] = await _async_request(
            self.hass,
            "POST",
            self.base_url,
            "/api/v1/integrations/home-assistant/ask",
            self.api_key,
            params=self._user_params({"available_only": str(available_only).lower()}),
            json_body={"text": text},
        )
        return data
