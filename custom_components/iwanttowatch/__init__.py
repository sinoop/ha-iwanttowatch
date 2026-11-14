"""The iWantToWatch integration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
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
    ApiError,
    CannotConnectError,
    InvalidAuthError,
    IWantToWatchCoordinator,
    UnknownUserError,
)

PLATFORMS: list[Platform] = [Platform.SENSOR]
PANEL_URL_PATH = "iwanttowatch"
PANEL_STATIC_URL = "/iwanttowatch_panel/iwanttowatch-panel.js"
PANEL_VERSION = "0.2.0"

type IWantToWatchConfigEntry = ConfigEntry[IWantToWatchCoordinator]


def _get_coordinator(
    hass: HomeAssistant, entry_id: str | None
) -> tuple[str, IWantToWatchCoordinator]:
    entries: dict[str, IWantToWatchCoordinator] = hass.data.get(DOMAIN, {}).get("entries", {})
    if not entries:
        raise ValueError("No iWantToWatch entries configured")
    if entry_id and entry_id in entries:
        return entry_id, entries[entry_id]
    first_id = next(iter(entries))
    return first_id, entries[first_id]


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/entries"})
@callback
def ws_list_entries(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """List configured iWantToWatch entries."""
    entries = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.entry_id in hass.data.get(DOMAIN, {}).get("entries", {}):
            entries.append({"entry_id": entry.entry_id, "title": entry.title})
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/feed",
        vol.Optional("entry_id"): str,
        vol.Optional("limit", default=50): vol.All(vol.Coerce(int), vol.Range(min=1, max=50)),
        vol.Optional("min_match", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
    }
)
@websocket_api.async_response
async def ws_get_feed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return top matched movies and shortlist for the sidebar panel."""
    try:
        entry_id, coordinator = _get_coordinator(hass, msg.get("entry_id"))
        data = await coordinator.async_get_panel_feed(
            limit=msg["limit"], min_match=msg["min_match"]
        )
        connection.send_result(msg["id"], {"entry_id": entry_id, **data})
    except (ValueError, InvalidAuthError, UnknownUserError, CannotConnectError, ApiError) as err:
        connection.send_error(msg["id"], "iwanttowatch_error", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/search",
        vol.Optional("entry_id"): str,
        vol.Required("query"): str,
        vol.Optional("year"): vol.Any(None, vol.Coerce(int)),
    }
)
@websocket_api.async_response
async def ws_search(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Search for movies via iWantToWatch."""
    try:
        _, coordinator = _get_coordinator(hass, msg.get("entry_id"))
        results = await coordinator.async_search(msg["query"], year=msg.get("year"))
        connection.send_result(msg["id"], {"results": results})
    except (ValueError, InvalidAuthError, UnknownUserError, CannotConnectError, ApiError) as err:
        connection.send_error(msg["id"], "iwanttowatch_error", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/shortlist",
        vol.Optional("entry_id"): str,
        vol.Required("tmdb_id"): vol.Coerce(int),
        vol.Required("add"): bool,
    }
)
@websocket_api.async_response
async def ws_shortlist(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Add or remove a movie from the shortlist."""
    try:
        _, coordinator = _get_coordinator(hass, msg.get("entry_id"))
        await coordinator.async_set_shortlist(msg["tmdb_id"], add=msg["add"])
        connection.send_result(msg["id"], {"ok": True})
    except (ValueError, InvalidAuthError, UnknownUserError, CannotConnectError, ApiError) as err:
        connection.send_error(msg["id"], "iwanttowatch_error", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/radarr_request",
        vol.Optional("entry_id"): str,
        vol.Required("tmdb_id"): vol.Coerce(int),
    }
)
@websocket_api.async_response
async def ws_radarr_request(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Queue a movie in Radarr."""
    try:
        _, coordinator = _get_coordinator(hass, msg.get("entry_id"))
        status = await coordinator.async_request_radarr(msg["tmdb_id"])
        connection.send_result(msg["id"], status)
    except (ValueError, InvalidAuthError, UnknownUserError, CannotConnectError, ApiError) as err:
        connection.send_error(msg["id"], "iwanttowatch_error", str(err))


async def _async_register_panel_and_ws(hass: HomeAssistant) -> None:
    """Register static assets, sidebar panel, and WebSocket commands once."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data.setdefault("entries", {})

    if not domain_data.get("ws_registered"):
        websocket_api.async_register_command(hass, ws_list_entries)
        websocket_api.async_register_command(hass, ws_get_feed)
        websocket_api.async_register_command(hass, ws_search)
        websocket_api.async_register_command(hass, ws_shortlist)
        websocket_api.async_register_command(hass, ws_radarr_request)
        domain_data["ws_registered"] = True

    if not domain_data.get("static_registered"):
        panel_file = Path(__file__).parent / "frontend" / "iwanttowatch-panel.js"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_STATIC_URL, str(panel_file), cache_headers=False)]
        )
        domain_data["static_registered"] = True

    if not domain_data.get("panel_registered"):
        async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title="iWantToWatch",
            sidebar_icon="mdi:movie-open-star",
            frontend_url_path=PANEL_URL_PATH,
            config={
                "_panel_custom": {
                    "name": "iwanttowatch-panel",
                    "embed_iframe": False,
                    "trust_external": False,
                    "module_url": f"{PANEL_STATIC_URL}?v={PANEL_VERSION}",
                }
            },
            require_admin=False,
        )
        domain_data["panel_registered"] = True


async def async_setup_entry(hass: HomeAssistant, entry: IWantToWatchConfigEntry) -> bool:
    """Set up iWantToWatch from a config entry."""
    options = entry.options
    coordinator = IWantToWatchCoordinator(
        hass,
        base_url=entry.data[CONF_URL],
        api_key=entry.data[CONF_API_KEY],
        username=options.get(CONF_USERNAME, entry.data.get(CONF_USERNAME)),
        limit=options.get(CONF_LIMIT, entry.data.get(CONF_LIMIT, DEFAULT_LIMIT)),
        min_match=options.get(CONF_MIN_MATCH, entry.data.get(CONF_MIN_MATCH, DEFAULT_MIN_MATCH)),
        scan_interval_minutes=options.get(
            CONF_SCAN_INTERVAL,
            entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        ),
    )

    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data.setdefault("entries", {})[entry.entry_id] = coordinator

    await _async_register_panel_and_ws(hass)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: IWantToWatchConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        domain_data = hass.data.get(DOMAIN, {})
        entries = domain_data.get("entries", {})
        entries.pop(entry.entry_id, None)
        if not entries and domain_data.get("panel_registered"):
            async_remove_panel(hass, PANEL_URL_PATH)
            domain_data["panel_registered"] = False
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: IWantToWatchConfigEntry) -> None:
    """Reload the integration when options change."""
    await hass.config_entries.async_reload(entry.entry_id)
