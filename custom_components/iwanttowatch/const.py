"""Constants for the iWantToWatch integration."""

from __future__ import annotations

DOMAIN = "iwanttowatch"

CONF_API_KEY = "api_key"
CONF_LIMIT = "limit"
CONF_MIN_MATCH = "min_match"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_URL = "url"
CONF_USERNAME = "username"

DEFAULT_LIMIT = 10
DEFAULT_MIN_MATCH = 75
DEFAULT_SCAN_INTERVAL = 30  # minutes
REQUEST_TIMEOUT = 15  # seconds
