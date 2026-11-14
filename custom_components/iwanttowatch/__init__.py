"""The iWantToWatch integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

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
from .coordinator import IWantToWatchCoordinator

PLATFORMS: list[Platform] = [Platform.SENSOR]

type IWantToWatchConfigEntry = ConfigEntry[IWantToWatchCoordinator]


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
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: IWantToWatchConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: IWantToWatchConfigEntry) -> None:
    """Reload the integration when options change."""
    await hass.config_entries.async_reload(entry.entry_id)
