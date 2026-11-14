"""Sensor platform for iWantToWatch."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import IWantToWatchConfigEntry
from .const import DOMAIN
from .coordinator import IWantToWatchCoordinator


@dataclass(frozen=True, kw_only=True)
class IWantToWatchSensorDescription(SensorEntityDescription):
    """Describe an iWantToWatch sensor."""

    payload_key: str


SENSOR_DESCRIPTIONS: tuple[IWantToWatchSensorDescription, ...] = (
    IWantToWatchSensorDescription(
        key="recommendations",
        translation_key="recommendations",
        name="Recommendations",
        icon="mdi:movie-open-star",
        native_unit_of_measurement="movies",
        payload_key="high_rated_recommendations",
    ),
    IWantToWatchSensorDescription(
        key="shortlist",
        translation_key="shortlist",
        name="Shortlist",
        icon="mdi:bookmark-multiple",
        native_unit_of_measurement="movies",
        payload_key="shortlisted",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: IWantToWatchConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up iWantToWatch sensors based on a config entry."""
    coordinator = entry.runtime_data
    async_add_entities(
        IWantToWatchSensor(coordinator, entry, description)
        for description in SENSOR_DESCRIPTIONS
    )


class IWantToWatchSensor(CoordinatorEntity[IWantToWatchCoordinator], SensorEntity):
    """Sensor exposing iWantToWatch movie lists."""

    entity_description: IWantToWatchSensorDescription
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: IWantToWatchCoordinator,
        entry: IWantToWatchConfigEntry,
        description: IWantToWatchSensorDescription,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="iWantToWatch",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=coordinator.base_url,
        )

    @property
    def _movies(self) -> list[dict[str, Any]]:
        data = self.coordinator.data or {}
        movies = data.get(self.entity_description.payload_key, [])
        return movies if isinstance(movies, list) else []

    @property
    def native_value(self) -> int:
        """Return the number of movies in this list."""
        return len(self._movies)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the movie list and metadata as attributes."""
        data = self.coordinator.data or {}
        movies = self._movies
        attrs: dict[str, Any] = {
            "user": data.get("user"),
            "generated_at": data.get("generated_at"),
            "movies": movies,
        }
        if movies:
            top = movies[0]
            attrs["top_title"] = top.get("title")
            attrs["top_year"] = top.get("year")
            attrs["top_match"] = top.get("match")
            attrs["top_imdb_rating"] = top.get("imdb_rating")
            attrs["top_poster_url"] = top.get("poster_url")
            attrs["top_in_jellyfin"] = top.get("in_jellyfin")
            attrs["top_streaming_services"] = top.get("streaming_services", [])
        return attrs
