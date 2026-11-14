# iWantToWatch for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

Home Assistant custom integration for [iWantToWatch](https://github.com/sinoop/iwanttowatch), exposing your high-match movie recommendations and shortlisted films as sensors for dashboards and automations.

## Features

- **UI Configuration (Config Flow & Options Flow)** — no YAML required.
- **iWantToWatch Sidebar Tab** — built-in Home Assistant sidebar panel (mobile & desktop) with:
  - **Top 50 Matches** with match %, IMDb rating, Jellyfin status, streaming providers, and overview
  - **Shortlist** viewing and one-click add/remove
  - **Movie Search** (by title and optional year)
  - **Request to Radarr** directly from any movie card
- **Two Sensors per Account:**
  - `sensor.iwanttowatch_<user>_recommendations`: Count of high-match recommendations, with full movie details in `movies` and top-pick convenience attributes (`top_title`, `top_year`, `top_match`, `top_imdb_rating`, `top_poster_url`, `top_in_jellyfin`, `top_streaming_services`).
  - `sensor.iwanttowatch_<user>_shortlist`: Count of shortlisted movies with the same rich attributes.
- **Per-user or default admin polling** via `GET /api/v1/integrations/home-assistant`.

## Prerequisites

- A running [iWantToWatch](https://github.com/sinoop/iwanttowatch) instance with `/api/v1/integrations/home-assistant`.
- An API key generated in iWantToWatch (the MCP/Integration Bearer API key).

## Installation via HACS (Custom Repository)

1. Open **HACS → Integrations** in Home Assistant.
2. Click the **⋮** menu (top right) and select **Custom repositories**.
3. Add `https://github.com/sinoop/ha-iwanttowatch` with category **Integration**.
4. Search for **iWantToWatch** in HACS, click **Download**, and restart Home Assistant.
5. Go to **Settings → Devices & Services → Add Integration**, search for **iWantToWatch**, and enter:
   - **Server URL** (e.g., `http://192.168.1.50:8000`)
   - **API Key**
   - **Username** (optional; defaults to the server's primary admin user)
   - **Max movies per list** (`1–50`, default `10`)
   - **Minimum match %** (`0–100`, default `75`)
   - **Update interval** in minutes (`1–1440`, default `30`)

## Example Dashboard Card (Markdown)

```yaml
type: markdown
title: Tonight's Movie Picks
content: >
  {% for m in state_attr('sensor.iwanttowatch_default_recommendations', 'movies')[:5] %}
  - **{{ m.title }}** ({{ m.year }}) — {{ m.match }}% match{% if m.imdb_rating %} · IMDb {{ m.imdb_rating }}{% endif %}{% if m.in_jellyfin %} · *On Jellyfin*{% elif m.streaming_services %} · {{ m.streaming_services | join(', ') }}{% endif %}
  {% endfor %}
```
