class IWantToWatchPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._narrow = false;
    this._initialized = false;
    this._tab = "top"; // "top" | "shortlist" | "search"
    this._entries = [];
    this._entryId = null;
    this._feed = null;
    this._searchResults = [];
    this._searchQuery = "";
    this._searchYear = "";
    this._loading = false;
    this._searching = false;
    this._error = null;
    this._toast = null;
    this._radarrBusy = new Set();
    this._radarrStatus = new Map();
    this._shortlistBusy = new Set();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && hass) {
      this._init();
    }
  }

  set narrow(narrow) {
    this._narrow = Boolean(narrow);
    this._render();
  }

  async _init() {
    if (this._initialized) return;
    this._initialized = true;
    await this._loadEntries();
    await this._loadFeed();
  }

  async _loadEntries() {
    try {
      const res = await this._hass.callWS({ type: "iwanttowatch/entries" });
      this._entries = res?.entries || [];
      if (!this._entryId && this._entries.length > 0) {
        this._entryId = this._entries[0].entry_id;
      }
    } catch (err) {
      this._error = err?.message || "Failed to load iWantToWatch accounts";
    }
  }

  async _loadFeed() {
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const msg = {
        type: "iwanttowatch/feed",
        limit: 50,
        min_match: 0,
      };
      if (this._entryId) msg.entry_id = this._entryId;
      this._feed = await this._hass.callWS(msg);
    } catch (err) {
      this._error = err?.message || "Failed to load iWantToWatch feed";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _runSearch() {
    const q = this._searchQuery.trim();
    if (!q) return;
    this._searching = true;
    this._error = null;
    this._render();
    try {
      const msg = { type: "iwanttowatch/search", query: q };
      if (this._entryId) msg.entry_id = this._entryId;
      const y = parseInt(this._searchYear.trim(), 10);
      if (!Number.isNaN(y) && y > 1880 && y < 2100) msg.year = y;
      const res = await this._hass.callWS(msg);
      this._searchResults = res?.results || [];
    } catch (err) {
      this._error = err?.message || "Search failed";
    } finally {
      this._searching = false;
      this._render();
    }
  }

  async _toggleShortlist(tmdbId, currentlyInShortlist) {
    this._shortlistBusy.add(tmdbId);
    this._render();
    try {
      const msg = {
        type: "iwanttowatch/shortlist",
        tmdb_id: tmdbId,
        add: !currentlyInShortlist,
      };
      if (this._entryId) msg.entry_id = this._entryId;
      await this._hass.callWS(msg);
      this._showToast(currentlyInShortlist ? "Removed from shortlist" : "Added to shortlist");
      this._searchResults = this._searchResults.map((m) =>
        m.tmdb_id === tmdbId ? { ...m, in_shortlist: !currentlyInShortlist } : m
      );
      await this._loadFeed();
    } catch (err) {
      this._showToast(err?.message || "Shortlist update failed", true);
    } finally {
      this._shortlistBusy.delete(tmdbId);
      this._render();
    }
  }

  async _requestRadarr(tmdbId) {
    this._radarrBusy.add(tmdbId);
    this._render();
    try {
      const msg = { type: "iwanttowatch/radarr_request", tmdb_id: tmdbId };
      if (this._entryId) msg.entry_id = this._entryId;
      const status = await this._hass.callWS(msg);
      this._radarrStatus.set(tmdbId, status);
      this._showToast(`Queued in Radarr (${status?.status || "requested"})`);
    } catch (err) {
      this._showToast(err?.message || "Radarr request failed", true);
    } finally {
      this._radarrBusy.delete(tmdbId);
      this._render();
    }
  }

  _showToast(text, isError = false) {
    this._toast = { text, isError };
    this._render();
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = null;
      this._render();
    }, 3200);
  }

  _esc(val) {
    return String(val ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _matchClass(match) {
    if (match == null) return "neutral";
    if (match >= 85) return "high";
    if (match >= 70) return "mid";
    return "low";
  }

  _renderCard(m, radarrConfigured) {
    const tid = m.tmdb_id;
    const inShortlist = Boolean(m.in_shortlist);
    const shortlistBusy = this._shortlistBusy.has(tid);
    const radarrBusy = this._radarrBusy.has(tid);
    const rStatus = this._radarrStatus.get(tid);

    let radarrLabel = "Request Radarr";
    let radarrDone = false;
    if (radarrBusy) {
      radarrLabel = "Requesting...";
    } else if (rStatus) {
      if (rStatus.has_file) {
        radarrLabel = "Downloaded";
        radarrDone = true;
      } else if (rStatus.monitored) {
        radarrLabel = "In Radarr";
        radarrDone = true;
      }
    }

    const poster = m.poster_url
      ? `<img src="${this._esc(m.poster_url)}" alt="${this._esc(m.title)}" loading="lazy" />`
      : `<div class="poster-placeholder">No Poster</div>`;

    const services = (m.streaming_services || [])
      .map((s) => `<span class="chip">${this._esc(s)}</span>`)
      .join("");

    return `
      <article class="card">
        <div class="poster-wrap">
          ${poster}
          ${
            m.match != null
              ? `<span class="match-badge ${this._matchClass(m.match)}">${m.match}%</span>`
              : ""
          }
        </div>
        <div class="card-body">
          <div class="title-row">
            <h3>${this._esc(m.title)}</h3>
            ${m.year ? `<span class="year">${this._esc(m.year)}</span>` : ""}
          </div>
          <div class="meta-row">
            ${
              m.imdb_rating != null
                ? `<span class="chip imdb">IMDb ${Number(m.imdb_rating).toFixed(1)}</span>`
                : ""
            }
            ${m.in_jellyfin ? `<span class="chip jellyfin">On Jellyfin</span>` : ""}
            ${services}
          </div>
          ${m.overview ? `<p class="overview">${this._esc(m.overview)}</p>` : ""}
          <div class="actions">
            <button
              class="btn ${inShortlist ? "btn-active" : "btn-secondary"}"
              data-action="shortlist"
              data-tmdb="${tid}"
              data-in="${inShortlist}"
              ${shortlistBusy ? "disabled" : ""}
            >
              ${shortlistBusy ? "Saving..." : inShortlist ? "✓ Shortlisted" : "+ Shortlist"}
            </button>
            ${
              radarrConfigured
                ? `<button
                    class="btn ${radarrDone ? "btn-active" : "btn-primary"}"
                    data-action="radarr"
                    data-tmdb="${tid}"
                    ${radarrBusy || radarrDone ? "disabled" : ""}
                  >
                    ${radarrLabel}
                  </button>`
                : ""
            }
          </div>
        </div>
      </article>
    `;
  }

  _render() {
    const topMovies = this._feed?.high_rated_recommendations || [];
    const shortlisted = this._feed?.shortlisted || [];
    const radarrConfigured = Boolean(this._feed?.radarr_configured);

    let list = [];
    if (this._tab === "top") list = topMovies;
    else if (this._tab === "shortlist") list = shortlisted;
    else list = this._searchResults;

    const entryOptions = this._entries
      .map(
        (e) =>
          `<option value="${this._esc(e.entry_id)}" ${
            e.entry_id === this._entryId ? "selected" : ""
          }>${this._esc(e.title)}</option>`
      )
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100vh;
          background: var(--primary-background-color, #111318);
          color: var(--primary-text-color, #f1f5f9);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        }
        .topbar {
          position: sticky;
          top: 0;
          z-index: 10;
          background: var(--app-header-background-color, var(--card-background-color, #1a1d24));
          border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.1));
          padding: 12px 16px;
        }
        .topbar-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .brand h1 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
        }
        .user-pill {
          font-size: 12px;
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: var(--secondary-text-color, #94a3b8);
        }
        .controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        select, input {
          background: var(--primary-background-color, #111318);
          color: var(--primary-text-color, #f1f5f9);
          border: 1px solid var(--divider-color, rgba(255,255,255,0.16));
          border-radius: 8px;
          padding: 7px 10px;
          font-size: 14px;
        }
        .tabs {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          overflow-x: auto;
        }
        .tab {
          border: 1px solid var(--divider-color, rgba(255,255,255,0.12));
          background: transparent;
          color: var(--secondary-text-color, #94a3b8);
          padding: 7px 14px;
          border-radius: 999px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
        }
        .tab.active {
          background: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
          color: #fff;
        }
        .content {
          max-width: 1400px;
          margin: 0 auto;
          padding: 16px;
        }
        .search-bar {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .search-bar input[name="query"] {
          flex: 1;
          min-width: 200px;
        }
        .search-bar input[name="year"] {
          width: 96px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
        }
        .card {
          display: flex;
          gap: 12px;
          background: var(--card-background-color, #1e222b);
          border: 1px solid var(--divider-color, rgba(255,255,255,0.08));
          border-radius: 12px;
          padding: 12px;
        }
        .poster-wrap {
          position: relative;
          flex: 0 0 92px;
          height: 138px;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(255,255,255,0.05);
        }
        .poster-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .poster-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: var(--secondary-text-color, #94a3b8);
          text-align: center;
          padding: 6px;
          box-sizing: border-box;
        }
        .match-badge {
          position: absolute;
          top: 6px;
          left: 6px;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 6px;
          color: #fff;
        }
        .match-badge.high { background: #16a34a; }
        .match-badge.mid { background: #d97706; }
        .match-badge.low { background: #64748b; }
        .card-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .title-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
        }
        .title-row h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          line-height: 1.25;
        }
        .year {
          font-size: 12px;
          color: var(--secondary-text-color, #94a3b8);
        }
        .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .chip {
          font-size: 11px;
          padding: 2px 7px;
          border-radius: 6px;
          background: rgba(255,255,255,0.08);
          color: var(--primary-text-color, #e2e8f0);
        }
        .chip.imdb { background: rgba(245, 197, 24, 0.18); color: #facc15; }
        .chip.jellyfin { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
        .overview {
          margin: 0;
          font-size: 12px;
          line-height: 1.4;
          color: var(--secondary-text-color, #94a3b8);
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .actions {
          margin-top: auto;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding-top: 4px;
        }
        .btn {
          border: none;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-primary {
          background: var(--primary-color, #03a9f4);
          color: #fff;
        }
        .btn-secondary {
          background: rgba(255,255,255,0.1);
          color: var(--primary-text-color, #f1f5f9);
        }
        .btn-active {
          background: rgba(22, 163, 74, 0.22);
          color: #86efac;
        }
        .banner {
          padding: 12px 14px;
          border-radius: 10px;
          margin-bottom: 14px;
          font-size: 13px;
          background: rgba(239, 68, 68, 0.16);
          color: #fca5a5;
        }
        .empty {
          text-align: center;
          padding: 40px 16px;
          color: var(--secondary-text-color, #94a3b8);
          font-size: 14px;
        }
        .toast {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 13px;
          background: #1e293b;
          color: #f8fafc;
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          z-index: 50;
        }
        .toast.err { background: #991b1b; }
      </style>

      <header class="topbar">
        <div class="topbar-row">
          <div class="brand">
            ${
              this._narrow
                ? `<button class="btn btn-secondary" data-action="menu" aria-label="Menu">☰</button>`
                : ""
            }
            <h1>iWantToWatch</h1>
            ${this._feed?.user ? `<span class="user-pill">${this._esc(this._feed.user)}</span>` : ""}
          </div>
          <div class="controls">
            ${
              this._entries.length > 1
                ? `<select data-action="entry">${entryOptions}</select>`
                : ""
            }
            <button class="btn btn-secondary" data-action="refresh" ${this._loading ? "disabled" : ""}>
              ${this._loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${this._tab === "top" ? "active" : ""}" data-tab="top">
            Top 50 Matches (${topMovies.length})
          </button>
          <button class="tab ${this._tab === "shortlist" ? "active" : ""}" data-tab="shortlist">
            Shortlist (${shortlisted.length})
          </button>
          <button class="tab ${this._tab === "search" ? "active" : ""}" data-tab="search">
            Search
          </button>
        </div>
      </header>

      <main class="content">
        ${this._error ? `<div class="banner">${this._esc(this._error)}</div>` : ""}
        ${
          this._tab === "search"
            ? `
              <form class="search-bar" id="search-form">
                <input
                  type="text"
                  name="query"
                  placeholder="Search movies..."
                  value="${this._esc(this._searchQuery)}"
                />
                <input
                  type="number"
                  name="year"
                  placeholder="Year"
                  value="${this._esc(this._searchYear)}"
                />
                <button class="btn btn-primary" type="submit" ${this._searching ? "disabled" : ""}>
                  ${this._searching ? "Searching..." : "Search"}
                </button>
              </form>
            `
            : ""
        }

        ${
          this._loading && !this._feed
            ? `<div class="empty">Loading movies from iWantToWatch...</div>`
            : list.length === 0
              ? `<div class="empty">${
                  this._tab === "search"
                    ? "Search for a movie to view match score, availability, shortlist, or request in Radarr."
                    : "No movies found in this list."
                }</div>`
              : `<section class="grid">${list
                  .map((m) => this._renderCard(m, radarrConfigured))
                  .join("")}</section>`
        }
      </main>
      ${
        this._toast
          ? `<div class="toast ${this._toast.isError ? "err" : ""}">${this._esc(this._toast.text)}</div>`
          : ""
      }
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._tab = btn.dataset.tab;
        this._render();
      });
    });

    const menuBtn = root.querySelector('[data-action="menu"]');
    if (menuBtn) {
      menuBtn.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
      });
    }

    const refreshBtn = root.querySelector('[data-action="refresh"]');
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this._loadFeed());
    }

    const entrySel = root.querySelector('[data-action="entry"]');
    if (entrySel) {
      entrySel.addEventListener("change", (e) => {
        this._entryId = e.target.value;
        this._searchResults = [];
        this._loadFeed();
      });
    }

    const form = root.getElementById("search-form");
    if (form) {
      const qInput = form.querySelector('input[name="query"]');
      const yInput = form.querySelector('input[name="year"]');
      qInput.addEventListener("input", (e) => {
        this._searchQuery = e.target.value;
      });
      yInput.addEventListener("input", (e) => {
        this._searchYear = e.target.value;
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this._runSearch();
      });
    }

    root.querySelectorAll('[data-action="shortlist"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = Number(btn.dataset.tmdb);
        const isIn = btn.dataset.in === "true";
        this._toggleShortlist(tid, isIn);
      });
    });

    root.querySelectorAll('[data-action="radarr"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = Number(btn.dataset.tmdb);
        this._requestRadarr(tid);
      });
    });
  }
}

customElements.define("iwanttowatch-panel", IWantToWatchPanel);
