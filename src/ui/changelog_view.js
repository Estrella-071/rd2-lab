/**
 * Structured game-data changelog view.
 *
 * The view renders `site/data/changelog.json`; it intentionally does not own
 * version constants or hand-written release copy.  The canonical metadata
 * document supplies the current game-data version shown beside the control.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatChange(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  const ids = Array.isArray(value.ids) ? value.ids.join(", ") : "";
  const id = value.id || ids;
  const label = value.label || value.name || value.entity || value.table || "";
  const detail = value.detail || value.summary_zh || value.note || value.message || "";
  const officialDetails = Array.isArray(value.official_summaries_zh)
    ? value.official_summaries_zh.filter(Boolean).map((item) => `官方公告：${item}`)
    : [];
  return [value.entity_type || value.type || "", id, label && `（${label}）`, detail && `：${detail}`, ...officialDetails.map((item) => `；${item}`)]
    .filter(Boolean)
    .join("");
}

const CATEGORY_LABELS = {
  added: "新增",
  modified: "修改",
  removed: "移除",
  schema_changes: "資料結構變更",
  important_values: "重要數值變更"
};

const CATEGORY_MARKS = {
  added: "+",
  modified: "↗",
  removed: "−",
  schema_changes: "⌘",
  important_values: "!"
};

function formatChangelogDate(value, localization) {
  if (!value) return localization?.t?.("changelog.datePending", {}, "Date pending") || "Date pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(localization?.getIntlLocale?.() || "zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date).replaceAll("/", "．");
}

function countEntryChanges(entry) {
  const categories = entry?.categories && typeof entry.categories === "object" && !Array.isArray(entry.categories)
    ? entry.categories
    : entry;
  return Object.keys(CATEGORY_LABELS).reduce((total, key) => total + (Array.isArray(categories?.[key]) ? categories[key].length : 0), 0);
}

function getFriendlySummary(entry, localization) {
  const version = entry?.version || "";
  const bullets = [];

  if (version === "1.0.3") {
    bullets.push(
      localization?.t?.("changelog.1.0.3.1", {}, "Synced version 1.0.3 data, including values and text for all 239 nodes.") || "Synced version 1.0.3 data, including values and text for all 239 nodes.",
      localization?.t?.("changelog.1.0.3.2", {}, "Added wave tactic branches and SP Golem value calculations.") || "Added wave tactic branches and SP Golem value calculations."
    );
  } else if (version === "1.0.2") {
    bullets.push(
      localization?.t?.("changelog.1.0.2.1", {}, "Adjusted gold and core costs for several high-tier nodes.") || "Adjusted gold and core costs for several high-tier nodes.",
      localization?.t?.("changelog.1.0.2.2", {}, "Added localization content for shop dialogs and violation notices.") || "Added localization content for shop dialogs and violation notices."
    );
  } else if (version === "1.0.0") {
    bullets.push(localization?.t?.("changelog.1.0.0.1", {}, "Created the initial data snapshot with 239 talent nodes across five factions and the compendium.") || "Created the initial data snapshot with 239 talent nodes across five factions and the compendium.");
  } else {
    if (Array.isArray(entry.official_notices) && entry.official_notices.length > 0) {
      entry.official_notices.forEach((n) => {
        const title = n?.[`title_${localization?.getLocale?.()}`] || n?.title_en || n?.title_zh;
        if (title) bullets.push(title);
      });
    }
    if (bullets.length === 0) {
      bullets.push(localization?.t?.("changelog.versionUpdate", { version }, `Updated game data to version v${version}`) || `Updated game data to version v${version}`);
    }
  }
  return bullets;
}

export class ChangelogView {
  constructor({ container, openButton, closeButton, versionBadge, morphingWidgets, localization } = {}) {
    this.container = container || null;
    this.openButton = openButton || null;
    this.closeButton = closeButton || null;
    this.versionBadge = versionBadge || null;
    this.morphingWidgets = morphingWidgets || null;
    this.localization = localization || null;
    this.metadata = null;
    this.changelog = { entries: [] };
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.render();
  }

  setData({ metadata, changelog } = {}) {
    if (metadata && typeof metadata === "object") this.metadata = metadata;
    if (changelog && typeof changelog === "object") this.changelog = changelog;
    this.render();
  }

  setLocalization(localization) {
    this.localization = localization || null;
    this.render();
  }

  currentVersion() {
    return this.metadata?.canonical?.game_version
      || this.metadata?.canonical_version
      || this.localization?.t?.("common.unknown", {}, "Unknown")
      || "Unknown";
  }

  render() {
    const version = this.currentVersion();
    if (this.versionBadge) {
      this.versionBadge.textContent = `v${version}`;
      this.versionBadge.setAttribute("aria-label", this.localization?.t?.("changelog.versionAria", { version }, `Current game data version ${version}`) || `Current game data version ${version}`);
      this.versionBadge.dataset.version = version;
    }

    const currentVersionEl = document.getElementById("changelog-current-version");
    if (currentVersionEl) currentVersionEl.textContent = `v${version}`;

    const entries = Array.isArray(this.changelog?.entries) ? this.changelog.entries : [];
    const latestEntry = entries.at(-1) || {};
    const latestDate = formatChangelogDate(latestEntry.date, this.localization);

    const lastUpdateEl = document.getElementById("changelog-last-update");
    if (lastUpdateEl) lastUpdateEl.textContent = latestDate;

    const entriesContainer = document.getElementById("changelog-entries-container") || this.container?.querySelector("#changelog-entries-container");
    if (entriesContainer) {
      const itemsHtml = entries.slice().reverse().map((entry) => {
        const entryVer = entry.version || this.localization?.t?.("common.unknown", {}, "Unknown") || "Unknown";
        const entryDate = formatChangelogDate(entry.date, this.localization);
        const bullets = getFriendlySummary(entry, this.localization);
        return `
          <article class="changelog-entry-item">
            <header class="changelog-entry-head">
              <span class="changelog-entry-ver">v${escapeHtml(entryVer)}</span>
              <span class="changelog-entry-date">${escapeHtml(entryDate)}</span>
            </header>
            <ul class="changelog-entry-bullets">
              ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
            </ul>
          </article>
        `;
      }).join("");

      entriesContainer.innerHTML = itemsHtml || `<p class="changelog-empty">${escapeHtml(this.localization?.t?.("changelog.empty", {}, "No version updates are available.") || "No version updates are available.")}</p>`;
    }
  }

  open() {
    if (this.morphingWidgets) {
      this.morphingWidgets.openChangelog();
    } else {
      const widget = document.getElementById("changelog-widget");
      widget?.classList.add("is-expanded");
      const toggle = document.getElementById("changelog-open-btn");
      toggle?.setAttribute("aria-expanded", "true");
    }
  }

  close() {
    if (this.morphingWidgets) {
      this.morphingWidgets.closeChangelog();
    } else {
      const widget = document.getElementById("changelog-widget");
      widget?.classList.remove("is-expanded");
      const toggle = document.getElementById("changelog-open-btn");
      toggle?.setAttribute("aria-expanded", "false");
    }
  }

  destroy() {
    this._initialized = false;
  }
}

export { escapeHtml as escapeChangelogHtml };
