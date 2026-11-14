class IWantToWatchPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._narrow = false;
    this._initialized = false;
    this._tab = "top"; // "top" | "shortlist" | "search" | "ask"
    this._entries = [];
    this._entryId = null;
    this._feed = null;

    // Filters for Top 50
    this._filterAvail = "all"; // "all" | "jellyfin" | "streaming"
    this._filterMinMatch = 0;

    // Search & Ask AI
    this._searchResults = [];
    this._searchQuery = "";
    this._searchYear = "";
    this._askQuery = "";
    this._askAvailableOnly = false;
    this._askResults = [];
    this._askConsidered = null;

    // Detail modal
    this._detail = null;
    this._detailLoading = false;

    // Busy / UI state
    this._loading = false;
    this._searching = false;
    this._asking = false;
    this._error = null;
    this._toast = null;
    this._radarrBusy = new Set();
    this._radarrStatus = new Map();
    this._shortlistBusy = new Set();
    this._reactionBusy = new Set();
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
      const msg = { type: "iwanttowatch/feed", limit: 50, min_match: 0 };
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

  async _runAsk() {
    const text = this._askQuery.trim();
    if (!text) return;
    this._asking = true;
    this._error = null;
    this._render();
    try {
      const msg = {
        type: "iwanttowatch/ask",
        text,
        available_only: this._askAvailableOnly,
      };
      if (this._entryId) msg.entry_id = this._entryId;
      const res = await this._hass.callWS(msg);
      this._askResults = res?.picks || [];
      this._askConsidered = res?.considered ?? null;
    } catch (err) {
      this._error = err?.message || "Ask AI failed";
    } finally {
      this._asking = false;
      this._render();
    }
  }

  async _openDetail(tmdbId) {
    this._detailLoading = true;
    this._detail = { tmdb_id: tmdbId };
    this._render();
    try {
      const msg = { type: "iwanttowatch/title_detail", tmdb_id: tmdbId };
      if (this._entryId) msg.entry_id = this._entryId;
      this._detail = await this._hass.callWS(msg);
    } catch (err) {
      this._detail = null;
      this._showToast(err?.message || "Failed to load movie details", true);
    } finally {
      this._detailLoading = false;
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
      this._askResults = this._askResults.map((m) =>
        m.tmdb_id === tmdbId ? { ...m, in_shortlist: !currentlyInShortlist } : m
      );
      if (this._detail && this._detail.tmdb_id === tmdbId) {
        this._detail = { ...this._detail, shortlisted: !currentlyInShortlist };
      }
      await this._loadFeed();
    } catch (err) {
      this._showToast(err?.message || "Shortlist update failed", true);
    } finally {
      this._shortlistBusy.delete(tmdbId);
      this._render();
    }
  }

  async _setReaction(tmdbId, reaction, watched = true) {
    this._reactionBusy.add(tmdbId);
    this._render();
    try {
      const msg = {
        type: "iwanttowatch/reaction",
        tmdb_id: tmdbId,
        reaction,
        watched,
      };
      if (this._entryId) msg.entry_id = this._entryId;
      await this._hass.callWS(msg);
      const label =
        reaction === "loved"
          ? "Marked Loved"
          : reaction === "liked"
            ? "Marked Liked"
            : reaction === "disliked"
              ? "Marked Disliked"
              : watched
                ? "Marked Watched"
                : "Cleared rating";
      this._showToast(label);
      if (this._detail && this._detail.tmdb_id === tmdbId) {
        await this._openDetail(tmdbId);
      }
      await this._loadFeed();
    } catch (err) {
      this._showToast(err?.message || "Failed to update rating", true);
    } finally {
      this._reactionBusy.delete(tmdbId);
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
      if (this._detail && this._detail.tmdb_id === tmdbId) {
        this._detail = { ...this._detail, radarr: status };
      }
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

  _filteredTopMovies() {
    const all = this._feed?.high_rated_recommendations || [];
    return all.filter((m) => {
      if (this._filterMinMatch > 0 && (m.match == null || m.match < this._filterMinMatch)) {
        return false;
      }
      if (this._filterAvail === "jellyfin" && !m.in_jellyfin) return false;
      if (this._filterAvail === "streaming" && !(m.streaming_services?.length > 0)) return false;
      return true;
    });
  }

  _renderCard(m, radarrConfigured) {
    const tid = m.tmdb_id;
    const inShortlist = Boolean(m.in_shortlist);
    const shortlistBusy = this._shortlistBusy.has(tid);
    const radarrBusy = this._radarrBusy.has(tid);
    const reactBusy = this._reactionBusy.has(tid);
    const rStatus = this._radarrStatus.get(tid);

    let radarrLabel = "Radarr";
    let radarrDone = false;
    if (radarrBusy) {
      radarrLabel = "Queuing...";
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
        <div class="poster-wrap clickable" data-action="detail" data-tmdb="${tid}" title="View details">
          ${poster}
          ${
            m.match != null
              ? `<span class="match-badge ${this._matchClass(m.match)}">${m.match}%</span>`
              : ""
          }
        </div>
        <div class="card-body">
          <div class="title-row clickable" data-action="detail" data-tmdb="${tid}">
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
          ${m.why ? `<p class="ai-why">AI: ${this._esc(m.why)}</p>` : ""}
          ${m.overview ? `<p class="overview">${this._esc(m.overview)}</p>` : ""}
          <div class="actions">
            <button
              class="btn ${inShortlist ? "btn-active" : "btn-secondary"}"
              data-action="shortlist"
              data-tmdb="${tid}"
              data-in="${inShortlist}"
              ${shortlistBusy ? "disabled" : ""}
            >
              ${shortlistBusy ? "..." : inShortlist ? "✓ Shortlisted" : "+ Shortlist"}
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
            <button class="btn btn-secondary" data-action="react" data-tmdb="${tid}" data-reaction="loved" title="Loved" ${reactBusy ? "disabled" : ""}>♥</button>
            <button class="btn btn-secondary" data-action="react" data-tmdb="${tid}" data-reaction="liked" title="Liked" ${reactBusy ? "disabled" : ""}>👍</button>
            <button class="btn btn-secondary" data-action="react" data-tmdb="${tid}" data-reaction="disliked" title="Disliked" ${reactBusy ? "disabled" : ""}>👎</button>
            <button class="btn btn-secondary" data-action="react" data-tmdb="${tid}" data-reaction="" title="Mark Watched" ${reactBusy ? "disabled" : ""}>✓ Watched</button>
          </div>
        </div>
      </article>
    `;
  }

  _renderModal() {
    if (!this._detail) return "";
    if (this._detailLoading) {
      return `
        <div class="modal-backdrop" data-action="close-modal">
          <div class="modal" onclick="event.stopPropagation()">
            <div class="empty">Loading movie details...</div>
          </div>
        </div>
      `;
    }

    const d = this._detail;
    const tid = d.tmdb_id;
    const posterUrl = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null;
    const inShortlist = Boolean(d.shortlisted);
    const shortlistBusy = this._shortlistBusy.has(tid);
    const reactBusy = this._reactionBusy.has(tid);
    const radarrBusy = this._radarrBusy.has(tid);
    const radarr = d.radarr || this._radarrStatus.get(tid);
    const radarrConfigured = Boolean(radarr?.configured || this._feed?.radarr_configured);

    const directors = (d.directors || []).map((p) => p.name).join(", ");
    const cast = (d.cast || []).map((p) => p.name).join(", ");
    const genres = (d.genres || []).map((g) => `<span class="chip">${this._esc(g)}</span>`).join("");
    const reasons = (d.reasons || [])
      .map((r) => `<li>${this._esc(r)}</li>`)
      .join("");
    const seen = d.seen;
    const curReaction = seen?.reaction || null;

    let radarrBtnLabel = "Request in Radarr";
    let radarrDisabled = radarrBusy;
    if (radarrBusy) {
      radarrBtnLabel = "Requesting...";
    } else if (radarr?.has_file) {
      radarrBtnLabel = "Downloaded in Radarr";
      radarrDisabled = true;
    } else if (radarr?.monitored) {
      radarrBtnLabel = "Monitored in Radarr";
      radarrDisabled = true;
    }

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <div class="modal" id="detail-modal">
          <div class="modal-header">
            <h2>${this._esc(d.title || "Movie Details")} ${d.year ? `(${this._esc(d.year)})` : ""}</h2>
            <button class="btn btn-secondary" data-action="close-modal">✕</button>
          </div>
          <div class="modal-body">
            <div class="modal-top">
              ${
                posterUrl
                  ? `<img class="modal-poster" src="${this._esc(posterUrl)}" alt="${this._esc(d.title)}" />`
                  : ""
              }
              <div class="modal-info">
                ${d.tagline ? `<p class="tagline">"${this._esc(d.tagline)}"</p>` : ""}
                <div class="meta-row">
                  ${d.match != null ? `<span class="chip imdb">${d.match}% Match</span>` : ""}
                  ${d.runtime ? `<span class="chip">${d.runtime} min</span>` : ""}
                  ${d.certificate ? `<span class="chip">${this._esc(d.certificate)}</span>` : ""}
                  ${d.in_jellyfin ? `<span class="chip jellyfin">On Jellyfin</span>` : ""}
                  ${genres}
                </div>
                ${d.overview ? `<p class="modal-overview">${this._esc(d.overview)}</p>` : ""}
                ${directors ? `<p class="credits"><strong>Director:</strong> ${this._esc(directors)}</p>` : ""}
                ${cast ? `<p class="credits"><strong>Cast:</strong> ${this._esc(cast)}</p>` : ""}
              </div>
            </div>
            ${
              reasons
                ? `<div class="reasons-box"><strong>How it fits you</strong><ul>${reasons}</ul></div>`
                : ""
            }
            <div class="modal-actions">
              <button
                class="btn ${inShortlist ? "btn-active" : "btn-secondary"}"
                data-action="shortlist"
                data-tmdb="${tid}"
                data-in="${inShortlist}"
                ${shortlistBusy ? "disabled" : ""}
              >
                ${shortlistBusy ? "Saving..." : inShortlist ? "✓ Shortlisted" : "+ Add to Shortlist"}
              </button>
              ${
                radarrConfigured
                  ? `<button
                      class="btn ${radarrDisabled && !radarrBusy ? "btn-active" : "btn-primary"}"
                      data-action="radarr"
                      data-tmdb="${tid}"
                      ${radarrDisabled ? "disabled" : ""}
                    >
                      ${radarrBtnLabel}
                    </button>`
                  : ""
              }
            </div>
            <div class="modal-actions">
              <span class="rate-label">Rate / Watched:</span>
              <button class="btn ${curReaction === "loved" ? "btn-active" : "btn-secondary"}" data-action="react" data-tmdb="${tid}" data-reaction="loved" ${reactBusy ? "disabled" : ""}>♥ Loved</button>
              <button class="btn ${curReaction === "liked" ? "btn-active" : "btn-secondary"}" data-action="react" data-tmdb="${tid}" data-reaction="liked" ${reactBusy ? "disabled" : ""}>👍 Liked</button>
              <button class="btn ${curReaction === "disliked" ? "btn-active" : "btn-secondary"}" data-action="react" data-tmdb="${tid}" data-reaction="disliked" ${reactBusy ? "disabled" : ""}>👎 Disliked</button>
              <button class="btn ${seen && !curReaction ? "btn-active" : "btn-secondary"}" data-action="react" data-tmdb="${tid}" data-reaction="" ${reactBusy ? "disabled" : ""}>✓ Watched</button>
              ${
                seen
                  ? `<button class="btn btn-secondary" data-action="clear-react" data-tmdb="${tid}" ${reactBusy ? "disabled" : ""}>Clear</button>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _render() {
    const allTop = this._feed?.high_rated_recommendations || [];
    const topMovies = this._filteredTopMovies();
    const shortlisted = this._feed?.shortlisted || [];
    const radarrConfigured = Boolean(this._feed?.radarr_configured);

    let list = [];
    if (this._tab === "top") list = topMovies;
    else if (this._tab === "shortlist") list = shortlisted;
    else if (this._tab === "search") list = this._searchResults;
    else if (this._tab === "ask") list = this._askResults;

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
        .brand h1 { margin: 0; font-size: 20px; font-weight: 600; }
        .user-pill {
          font-size: 12px;
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: var(--secondary-text-color, #94a3b8);
        }
        .controls { display: flex; align-items: center; gap: 8px; }
        select, input[type="text"], input[type="number"] {
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
        .content { max-width: 1400px; margin: 0 auto; padding: 16px; }
        .filter-bar, .search-bar {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
          align-items: center;
        }
        .search-bar input[name="query"], .search-bar input[name="ask"] {
          flex: 1;
          min-width: 200px;
        }
        .search-bar input[name="year"] { width: 96px; }
        .check-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--secondary-text-color, #94a3b8);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
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
        .clickable { cursor: pointer; }
        .poster-wrap {
          position: relative;
          flex: 0 0 92px;
          height: 138px;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(255,255,255,0.05);
        }
        .poster-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .poster-placeholder {
          width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
          font-size: 11px; color: var(--secondary-text-color, #94a3b8); text-align: center; padding: 6px;
          box-sizing: border-box;
        }
        .match-badge {
          position: absolute; top: 6px; left: 6px; font-size: 11px; font-weight: 700;
          padding: 2px 6px; border-radius: 6px; color: #fff;
        }
        .match-badge.high { background: #16a34a; }
        .match-badge.mid { background: #d97706; }
        .match-badge.low { background: #64748b; }
        .card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
        .title-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
        .title-row h3 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.25; }
        .year { font-size: 12px; color: var(--secondary-text-color, #94a3b8); }
        .meta-row { display: flex; flex-wrap: wrap; gap: 5px; }
        .chip {
          font-size: 11px; padding: 2px 7px; border-radius: 6px;
          background: rgba(255,255,255,0.08); color: var(--primary-text-color, #e2e8f0);
        }
        .chip.imdb { background: rgba(245, 197, 24, 0.18); color: #facc15; }
        .chip.jellyfin { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
        .ai-why {
          margin: 0; font-size: 12px; color: #7dd3fc; line-height: 1.35;
        }
        .overview {
          margin: 0; font-size: 12px; line-height: 1.4; color: var(--secondary-text-color, #94a3b8);
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .actions { margin-top: auto; display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; }
        .btn {
          border: none; border-radius: 8px; padding: 6px 9px; font-size: 12px;
          font-weight: 500; cursor: pointer;
        }
        .btn:disabled { opacity: 0.6; cursor: default; }
        .btn-primary { background: var(--primary-color, #03a9f4); color: #fff; }
        .btn-secondary { background: rgba(255,255,255,0.1); color: var(--primary-text-color, #f1f5f9); }
        .btn-active { background: rgba(22, 163, 74, 0.22); color: #86efac; }
        .banner {
          padding: 12px 14px; border-radius: 10px; margin-bottom: 14px; font-size: 13px;
          background: rgba(239, 68, 68, 0.16); color: #fca5a5;
        }
        .empty {
          text-align: center; padding: 40px 16px; color: var(--secondary-text-color, #94a3b8); font-size: 14px;
        }
        .modal-backdrop {
          position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.72);
          display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        .modal {
          background: var(--card-background-color, #1e222b);
          border: 1px solid var(--divider-color, rgba(255,255,255,0.12));
          border-radius: 14px; max-width: 720px; width: 100%; max-height: 90vh;
          overflow-y: auto; padding: 16px; box-sizing: border-box;
        }
        .modal-header {
          display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px;
        }
        .modal-header h2 { margin: 0; font-size: 18px; }
        .modal-top { display: flex; gap: 14px; flex-wrap: wrap; }
        .modal-poster { width: 140px; border-radius: 10px; object-fit: cover; }
        .modal-info { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
        .tagline { margin: 0; font-style: italic; font-size: 13px; color: var(--secondary-text-color, #94a3b8); }
        .modal-overview { margin: 0; font-size: 13px; line-height: 1.45; }
        .credits { margin: 0; font-size: 12px; color: var(--secondary-text-color, #94a3b8); }
        .reasons-box {
          margin-top: 12px; padding: 10px 12px; border-radius: 10px;
          background: rgba(255,255,255,0.05); font-size: 13px;
        }
        .reasons-box ul { margin: 6px 0 0; padding-left: 18px; }
        .modal-actions {
          margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
        }
        .rate-label { font-size: 12px; color: var(--secondary-text-color, #94a3b8); }
        .toast {
          position: fixed; bottom: 20px; right: 20px; padding: 10px 14px; border-radius: 10px;
          font-size: 13px; background: #1e293b; color: #f8fafc;
          box-shadow: 0 8px 24px rgba(0,0,0,0.35); z-index: 50;
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
            Top 50 Matches (${allTop.length})
          </button>
          <button class="tab ${this._tab === "shortlist" ? "active" : ""}" data-tab="shortlist">
            Shortlist (${shortlisted.length})
          </button>
          <button class="tab ${this._tab === "search" ? "active" : ""}" data-tab="search">
            Search
          </button>
          <button class="tab ${this._tab === "ask" ? "active" : ""}" data-tab="ask">
            Ask AI
          </button>
        </div>
      </header>

      <main class="content">
        ${this._error ? `<div class="banner">${this._esc(this._error)}</div>` : ""}

        ${
          this._tab === "top"
            ? `
              <div class="filter-bar">
                <button class="tab ${this._filterAvail === "all" ? "active" : ""}" data-filter-avail="all">All</button>
                <button class="tab ${this._filterAvail === "jellyfin" ? "active" : ""}" data-filter-avail="jellyfin">On Jellyfin</button>
                <button class="tab ${this._filterAvail === "streaming" ? "active" : ""}" data-filter-avail="streaming">Streaming</button>
                <select data-action="min-match">
                  <option value="0" ${this._filterMinMatch === 0 ? "selected" : ""}>Min Match: Any</option>
                  <option value="70" ${this._filterMinMatch === 70 ? "selected" : ""}>70%+ Match</option>
                  <option value="80" ${this._filterMinMatch === 80 ? "selected" : ""}>80%+ Match</option>
                  <option value="85" ${this._filterMinMatch === 85 ? "selected" : ""}>85%+ Match</option>
                  <option value="90" ${this._filterMinMatch === 90 ? "selected" : ""}>90%+ Match</option>
                </select>
              </div>
            `
            : ""
        }

        ${
          this._tab === "search"
            ? `
              <form class="search-bar" id="search-form">
                <input type="text" name="query" placeholder="Search movies..." value="${this._esc(this._searchQuery)}" />
                <input type="number" name="year" placeholder="Year" value="${this._esc(this._searchYear)}" />
                <button class="btn btn-primary" type="submit" ${this._searching ? "disabled" : ""}>
                  ${this._searching ? "Searching..." : "Search"}
                </button>
              </form>
            `
            : ""
        }

        ${
          this._tab === "ask"
            ? `
              <form class="search-bar" id="ask-form">
                <input type="text" name="ask" placeholder="e.g. a tense thriller under 2 hours..." value="${this._esc(this._askQuery)}" />
                <label class="check-label">
                  <input type="checkbox" name="avail" ${this._askAvailableOnly ? "checked" : ""} />
                  Available only
                </label>
                <button class="btn btn-primary" type="submit" ${this._asking ? "disabled" : ""}>
                  ${this._asking ? "Asking AI..." : "Ask AI"}
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
                    ? "Search for a movie to view match score, availability, shortlist, rate, or request in Radarr."
                    : this._tab === "ask"
                      ? "Ask AI in plain English to pick movies from your feed."
                      : "No movies match the current filter."
                }</div>`
              : `<section class="grid">${list
                  .map((m) => this._renderCard(m, radarrConfigured))
                  .join("")}</section>`
        }
      </main>
      ${this._renderModal()}
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

    root.querySelectorAll("[data-filter-avail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._filterAvail = btn.dataset.filterAvail;
        this._render();
      });
    });

    const minMatchSel = root.querySelector('[data-action="min-match"]');
    if (minMatchSel) {
      minMatchSel.addEventListener("change", (e) => {
        this._filterMinMatch = Number(e.target.value);
        this._render();
      });
    }

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
        this._askResults = [];
        this._loadFeed();
      });
    }

    const searchForm = root.getElementById("search-form");
    if (searchForm) {
      const qInput = searchForm.querySelector('input[name="query"]');
      const yInput = searchForm.querySelector('input[name="year"]');
      qInput.addEventListener("input", (e) => {
        this._searchQuery = e.target.value;
      });
      yInput.addEventListener("input", (e) => {
        this._searchYear = e.target.value;
      });
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this._runSearch();
      });
    }

    const askForm = root.getElementById("ask-form");
    if (askForm) {
      const aInput = askForm.querySelector('input[name="ask"]');
      const availCheck = askForm.querySelector('input[name="avail"]');
      aInput.addEventListener("input", (e) => {
        this._askQuery = e.target.value;
      });
      availCheck.addEventListener("change", (e) => {
        this._askAvailableOnly = e.target.checked;
      });
      askForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this._runAsk();
      });
    }

    root.querySelectorAll('[data-action="detail"]').forEach((el) => {
      el.addEventListener("click", () => {
        this._openDetail(Number(el.dataset.tmdb));
      });
    });

    const modal = root.getElementById("detail-modal");
    if (modal) {
      modal.addEventListener("click", (e) => e.stopPropagation());
    }

    root.querySelectorAll('[data-action="close-modal"]').forEach((el) => {
      el.addEventListener("click", () => {
        this._detail = null;
        this._render();
      });
    });

    root.querySelectorAll('[data-action="shortlist"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        this._toggleShortlist(Number(btn.dataset.tmdb), btn.dataset.in === "true");
      });
    });

    root.querySelectorAll('[data-action="radarr"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        this._requestRadarr(Number(btn.dataset.tmdb));
      });
    });

    root.querySelectorAll('[data-action="react"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const reaction = btn.dataset.reaction || null;
        this._setReaction(Number(btn.dataset.tmdb), reaction, true);
      });
    });

    root.querySelectorAll('[data-action="clear-react"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        this._setReaction(Number(btn.dataset.tmdb), null, false);
      });
    });
  }
}

customElements.define("iwanttowatch-panel", IWantToWatchPanel);
