function restoreWidgetFocus(card, toggleBtn, isOpen) {
  if (isOpen || !card || typeof document === "undefined" || !card.contains(document.activeElement)) return;
  if (typeof toggleBtn?.focus === "function") toggleBtn.focus();
  else document.activeElement?.blur?.();
}

function updateWidgetToggle(toggleBtn, isOpen) {
  if (!toggleBtn) return;
  toggleBtn.setAttribute("aria-expanded", String(isOpen));
  toggleBtn.style.opacity = isOpen ? "0" : "1";
  toggleBtn.style.pointerEvents = isOpen ? "none" : "auto";
}

function updateWidgetCard(card, isOpen, closedTransform) {
  if (!card) return;
  if ("inert" in card) card.inert = !isOpen;
  card.setAttribute("aria-hidden", String(!isOpen));
  card.style.opacity = isOpen ? "1" : "0";
  card.style.visibility = isOpen ? "visible" : "hidden";
  card.style.pointerEvents = isOpen ? "auto" : "none";
  card.style.transform = isOpen ? "translateY(0)" : closedTransform;
}

function updateWidgetDom(widget, isOpen, toggleSelector, cardSelector, closedTransform) {
  if (!widget) return;
  const toggleBtn = widget.querySelector(toggleSelector);
  const card = widget.querySelector(cardSelector);
  restoreWidgetFocus(card, toggleBtn, isOpen);
  widget.classList.toggle("is-open", isOpen);
  widget.classList.toggle("is-expanded", isOpen);
  updateWidgetToggle(toggleBtn, isOpen);
  updateWidgetCard(card, isOpen, closedTransform);
}

// Controls the small panels in the top bar.
export class MorphingWidgets {
  /**
   * @param {object} dependencies
   * @param {HTMLElement} [dependencies.searchWidgetElement]
   * @param {HTMLElement} [dependencies.filterWidgetElement]
   * @param {HTMLElement} [dependencies.disclaimerWidgetElement]
   * @param {HTMLElement} [dependencies.changelogWidgetElement]
   * @param {HTMLElement} [dependencies.localeWidgetElement]
   * @param {import("../app/usecases/filter_tree.js").FilterTreeUseCase} [dependencies.filterTreeUseCase]
   */
  constructor({ searchWidgetElement, filterWidgetElement, disclaimerWidgetElement, changelogWidgetElement, localeWidgetElement, filterTreeUseCase } = {}) {
    this.searchWidgetEl = searchWidgetElement || (typeof document !== "undefined" ? document.getElementById("search-widget") : null);
    this.filterWidgetEl = filterWidgetElement || (typeof document !== "undefined" ? document.getElementById("filter-widget") : null);
    this.disclaimerWidgetEl = disclaimerWidgetElement || (typeof document !== "undefined" ? document.getElementById("disclaimer-widget") : null);
    this.changelogWidgetEl = changelogWidgetElement || (typeof document !== "undefined" ? document.getElementById("changelog-widget") : null);
    this.localeWidgetEl = localeWidgetElement || (typeof document !== "undefined" ? document.getElementById("locale-widget") : null);
    this.filterTreeUseCase = filterTreeUseCase || null;

    this.isSearchOpen = false;
    this.isFilterOpen = false;
    this.isDisclaimerOpen = false;
    this.isChangelogOpen = false;
    this.isLocaleOpen = false;
    this._initialized = false;

    this._boundSearchWidgetClick = (event) => {
      const isCompact = typeof window !== "undefined" && window.innerWidth <= 768;
      if (isCompact && !this.isSearchOpen && !event.target?.closest?.("#search-clear, .search-clear")) {
        event.stopPropagation();
        this.openSearch();
      }
    };
    this._boundSearchOpenRequest = () => this.openSearch();
    this._boundSearchCloseRequest = () => this.closeSearch();

    this._boundFilterToggleClick = (event) => {
      event.stopPropagation();
      this.toggleFilter();
    };
    this._boundFilterClosePointerDown = (event) => {
      if (typeof event.preventDefault === "function") event.preventDefault();
    };
    this._boundFilterCloseClick = (event) => {
      event.stopPropagation();
      this.closeFilter();
    };
    this._boundFilterClearClick = (event) => {
      event.stopPropagation();
      if (this.filterTreeUseCase) {
        this.filterTreeUseCase.clear();
      }
    };
    this._boundFilterWidgetClick = (event) => {
      if (!this.isFilterOpen && !event.target?.closest?.("#filter-close-btn, .filter-chip, #filter-clear-btn")) {
        event.stopPropagation();
        this.openFilter();
      }
    };

    this._boundDisclaimerToggleClick = (event) => {
      event.stopPropagation();
      this.toggleDisclaimer();
    };
    this._boundDisclaimerClosePointerDown = (event) => {
      if (typeof event.preventDefault === "function") event.preventDefault();
    };
    this._boundDisclaimerCloseClick = (event) => {
      event.stopPropagation();
      this.closeDisclaimer();
    };
    this._boundDisclaimerWidgetClick = (event) => {
      if (!this.isDisclaimerOpen && !event.target?.closest?.("#disclaimer-close-btn")) {
        event.stopPropagation();
        this.openDisclaimer();
      }
    };

    this._boundChangelogToggleClick = (event) => {
      event.stopPropagation();
      this.toggleChangelog();
    };
    this._boundChangelogClosePointerDown = (event) => {
      if (typeof event.preventDefault === "function") event.preventDefault();
    };
    this._boundChangelogCloseClick = (event) => {
      event.stopPropagation();
      this.closeChangelog();
    };
    this._boundChangelogWidgetClick = (event) => {
      if (!this.isChangelogOpen && !event.target?.closest?.("#changelog-close-btn")) {
        event.stopPropagation();
        this.openChangelog();
      }
    };

    this._boundLocaleToggleClick = (event) => {
      event.stopPropagation();
      this.toggleLocale();
    };
    this._boundLocaleClosePointerDown = (event) => {
      if (typeof event.preventDefault === "function") event.preventDefault();
    };
    this._boundLocaleCloseClick = (event) => {
      event.stopPropagation();
      this.closeLocale();
    };
    this._boundLocaleWidgetClick = (event) => {
      if (!this.isLocaleOpen && !event.target?.closest?.("#locale-close-btn, [data-locale]")) {
        event.stopPropagation();
        this.openLocale();
      }
    };

    this._boundOutsideClick = (event) => {
      // Do not close a panel when its own control was clicked.
      if (event.target?.closest?.("#changelog-open-btn, .changelog-toggle-btn, #disclaimer-toggle-btn, .disclaimer-toggle-btn, #locale-toggle-btn, .locale-toggle-btn, #filter-toggle-btn, .filter-toggle-btn")) {
        return;
      }
      if (this.searchWidgetEl?.classList.contains("is-expanded") && !event.target?.closest?.("#search-widget")) {
        const input = this.searchWidgetEl.querySelector("#search-input, [type='search']");
        if (!input?.value?.trim()) this.closeSearch();
      }
      if (this.filterWidgetEl?.classList.contains("is-expanded") && !event.target?.closest?.("#filter-widget, .filter-chip, .hud-btn, #toggle-prereq-btn, #toggle-node-names-btn, #toggle-currency-btn, #tooltip")) {
        this.closeFilter();
      }
      if (this.disclaimerWidgetEl?.classList.contains("is-expanded") && !event.target?.closest?.("#disclaimer-widget")) {
        this.closeDisclaimer();
      }
      if (this.changelogWidgetEl?.classList.contains("is-expanded") && !event.target?.closest?.("#changelog-widget")) {
        this.closeChangelog();
      }
      if (this.localeWidgetEl?.classList.contains("is-expanded") && !event.target?.closest?.("#locale-widget")) {
        this.closeLocale();
      }
    };

    this._boundViewportDrag = () => this.closeAll();
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._initSearchWidget();
    this._updateSearchDOM();
    this._initFilterWidget();
    this._initDisclaimerWidget();
    this._initChangelogWidget();
    this._initLocaleWidget();
    this._bindOutsideClick();
    if (typeof document !== "undefined") {
      document.addEventListener("rd2:open-search", this._boundSearchOpenRequest);
      document.addEventListener("rd2:close-search", this._boundSearchCloseRequest);
      document.addEventListener("rd2:viewport-drag", this._boundViewportDrag);
    }
  }

  _initSearchWidget() {
    const doc = typeof document !== "undefined" ? document : null;
    const searchWidget = this.searchWidgetEl || doc?.getElementById("search-widget");
    this.searchWidgetEl = searchWidget;
    if (!searchWidget) return;
    searchWidget.addEventListener("click", this._boundSearchWidgetClick);
  }

  _initFilterWidget() {
    const doc = typeof document !== "undefined" ? document : null;
    const filterWidget = this.filterWidgetEl || doc?.getElementById("filter-widget");
    this.filterWidgetEl = filterWidget;
    if (!filterWidget) return;
    const toggleBtn = filterWidget.querySelector("#filter-toggle-btn, .filter-toggle-btn") || doc?.getElementById("filter-toggle-btn");
    const closeBtn = filterWidget.querySelector("#filter-close-btn, .filter-close-btn") || doc?.getElementById("filter-close-btn");
    const clearBtn = filterWidget.querySelector("#filter-clear-btn, .filter-clear-btn") || doc?.getElementById("filter-clear-btn");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", this._boundFilterToggleClick);
    }
    if (closeBtn) {
      closeBtn.addEventListener("pointerdown", this._boundFilterClosePointerDown);
      closeBtn.addEventListener("click", this._boundFilterCloseClick);
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", this._boundFilterClearClick);
    }

    filterWidget.addEventListener("click", this._boundFilterWidgetClick);
  }

  _initDisclaimerWidget() {
    const doc = typeof document !== "undefined" ? document : null;
    const disclaimerWidget = this.disclaimerWidgetEl || doc?.getElementById("disclaimer-widget");
    this.disclaimerWidgetEl = disclaimerWidget;
    if (!disclaimerWidget) return;
    const toggleBtn = disclaimerWidget.querySelector("#disclaimer-toggle-btn, .disclaimer-toggle-btn") || doc?.getElementById("disclaimer-toggle-btn");
    const closeBtn = disclaimerWidget.querySelector("#disclaimer-close-btn, .disclaimer-close-btn") || doc?.getElementById("disclaimer-close-btn");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", this._boundDisclaimerToggleClick);
    }
    if (closeBtn) {
      closeBtn.addEventListener("pointerdown", this._boundDisclaimerClosePointerDown);
      closeBtn.addEventListener("click", this._boundDisclaimerCloseClick);
    }

    disclaimerWidget.addEventListener("click", this._boundDisclaimerWidgetClick);
  }

  _initChangelogWidget() {
    const doc = typeof document !== "undefined" ? document : null;
    const changelogWidget = this.changelogWidgetEl || doc?.getElementById("changelog-widget");
    this.changelogWidgetEl = changelogWidget;
    if (!changelogWidget) return;
    const toggleBtn = changelogWidget.querySelector("#changelog-open-btn, .changelog-toggle-btn") || doc?.getElementById("changelog-open-btn");
    const closeBtn = changelogWidget.querySelector("#changelog-close-btn, .changelog-close-btn") || doc?.getElementById("changelog-close-btn");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", this._boundChangelogToggleClick);
    }
    if (closeBtn) {
      closeBtn.addEventListener("pointerdown", this._boundChangelogClosePointerDown);
      closeBtn.addEventListener("click", this._boundChangelogCloseClick);
    }

    changelogWidget.addEventListener("click", this._boundChangelogWidgetClick);
  }

  _initLocaleWidget() {
    const doc = typeof document !== "undefined" ? document : null;
    const localeWidget = this.localeWidgetEl || doc?.getElementById("locale-widget");
    this.localeWidgetEl = localeWidget;
    if (!localeWidget) return;
    const toggleBtn = localeWidget.querySelector("#locale-toggle-btn, .locale-toggle-btn") || doc?.getElementById("locale-toggle-btn");
    const closeBtn = localeWidget.querySelector("#locale-close-btn, .locale-close-btn") || doc?.getElementById("locale-close-btn");
    toggleBtn?.addEventListener("click", this._boundLocaleToggleClick);
    closeBtn?.addEventListener("pointerdown", this._boundLocaleClosePointerDown);
    closeBtn?.addEventListener("click", this._boundLocaleCloseClick);
    localeWidget.addEventListener("click", this._boundLocaleWidgetClick);
  }

  _bindOutsideClick() {
    if (typeof document === "undefined") return;
    document.addEventListener("click", this._boundOutsideClick);
  }

  destroy() {
    if (this.searchWidgetEl) {
      this.searchWidgetEl.removeEventListener("click", this._boundSearchWidgetClick);
    }
    if (this.filterWidgetEl) {
      const toggleBtn = this.filterWidgetEl.querySelector("#filter-toggle-btn, .filter-toggle-btn");
      const closeBtn = this.filterWidgetEl.querySelector("#filter-close-btn, .filter-close-btn");
      const clearBtn = this.filterWidgetEl.querySelector("#filter-clear-btn, .filter-clear-btn");
      toggleBtn?.removeEventListener("click", this._boundFilterToggleClick);
      closeBtn?.removeEventListener("pointerdown", this._boundFilterClosePointerDown);
      closeBtn?.removeEventListener("click", this._boundFilterCloseClick);
      clearBtn?.removeEventListener("click", this._boundFilterClearClick);
      this.filterWidgetEl.removeEventListener("click", this._boundFilterWidgetClick);
    }
    if (this.disclaimerWidgetEl) {
      const toggleBtn = this.disclaimerWidgetEl.querySelector("#disclaimer-toggle-btn, .disclaimer-toggle-btn");
      const closeBtn = this.disclaimerWidgetEl.querySelector("#disclaimer-close-btn, .disclaimer-close-btn");
      toggleBtn?.removeEventListener("click", this._boundDisclaimerToggleClick);
      closeBtn?.removeEventListener("pointerdown", this._boundDisclaimerClosePointerDown);
      closeBtn?.removeEventListener("click", this._boundDisclaimerCloseClick);
      this.disclaimerWidgetEl.removeEventListener("click", this._boundDisclaimerWidgetClick);
    }
    if (this.changelogWidgetEl) {
      const toggleBtn = this.changelogWidgetEl.querySelector("#changelog-open-btn, .changelog-toggle-btn");
      const closeBtn = this.changelogWidgetEl.querySelector("#changelog-close-btn, .changelog-close-btn");
      toggleBtn?.removeEventListener("click", this._boundChangelogToggleClick);
      closeBtn?.removeEventListener("pointerdown", this._boundChangelogClosePointerDown);
      closeBtn?.removeEventListener("click", this._boundChangelogCloseClick);
      this.changelogWidgetEl.removeEventListener("click", this._boundChangelogWidgetClick);
    }
    if (this.localeWidgetEl) {
      const toggleBtn = this.localeWidgetEl.querySelector("#locale-toggle-btn, .locale-toggle-btn");
      const closeBtn = this.localeWidgetEl.querySelector("#locale-close-btn, .locale-close-btn");
      toggleBtn?.removeEventListener("click", this._boundLocaleToggleClick);
      closeBtn?.removeEventListener("pointerdown", this._boundLocaleClosePointerDown);
      closeBtn?.removeEventListener("click", this._boundLocaleCloseClick);
      this.localeWidgetEl.removeEventListener("click", this._boundLocaleWidgetClick);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("rd2:open-search", this._boundSearchOpenRequest);
      document.removeEventListener("rd2:close-search", this._boundSearchCloseRequest);
      document.removeEventListener("click", this._boundOutsideClick);
      document.removeEventListener("rd2:viewport-drag", this._boundViewportDrag);
    }
    this._initialized = false;
  }

  closeAll() {
    let changed = false;
    if (this.isSearchOpen) {
      this.isSearchOpen = false;
      this._updateSearchDOM();
      changed = true;
    }
    if (this.isFilterOpen) {
      this.isFilterOpen = false;
      this._updateFilterDOM();
      changed = true;
    }
    if (this.isDisclaimerOpen) {
      this.isDisclaimerOpen = false;
      this._updateDisclaimerDOM();
      changed = true;
    }
    if (this.isChangelogOpen) {
      this.isChangelogOpen = false;
      this._updateChangelogDOM();
      changed = true;
    }
    if (this.isLocaleOpen) {
      this.isLocaleOpen = false;
      this._updateLocaleDOM();
      changed = true;
    }
    return changed;
  }

  toggleSearch() {
    if (this.isSearchOpen) this.closeSearch();
    else this.openSearch();
  }

  openSearch() {
    this.isSearchOpen = true;
    this.isFilterOpen = false;
    this.isDisclaimerOpen = false;
    this.isChangelogOpen = false;
    this.isLocaleOpen = false;
    this._updateFilterDOM();
    this._updateDisclaimerDOM();
    this._updateChangelogDOM();
    this._updateLocaleDOM();
    this._updateSearchDOM();
    const input = this.searchWidgetEl?.querySelector("#search-input, [type='search']");
    input?.focus?.({ preventScroll: true });
  }

  closeSearch() {
    this.isSearchOpen = false;
    this.searchWidgetEl?.querySelector("#search-input, [type='search']")?.blur?.();
    this._updateSearchDOM();
  }

  _updateSearchDOM() {
    const searchWidget = this.searchWidgetEl || (typeof document !== "undefined" ? document.getElementById("search-widget") : null);
    if (!searchWidget) return;
    const isCompact = typeof window !== "undefined" && window.innerWidth <= 768;
    const isMobileExpanded = this.isSearchOpen && isCompact;
    const searchField = searchWidget.querySelector(".search-field");
    searchWidget.classList.toggle("is-open", this.isSearchOpen);
    searchWidget.classList.toggle("is-expanded", isMobileExpanded);
    searchWidget.setAttribute("aria-expanded", String(isCompact ? isMobileExpanded : true));
    searchField?.classList.toggle("is-expanded", isMobileExpanded);
  }

  toggleFilter() {
    this.isFilterOpen = !this.isFilterOpen;
    if (this.isFilterOpen) {
      this.isSearchOpen = false;
      this.isDisclaimerOpen = false;
      this.isChangelogOpen = false;
      this.isLocaleOpen = false;
      this._updateSearchDOM();
      this._updateDisclaimerDOM();
      this._updateChangelogDOM();
      this._updateLocaleDOM();
    }
    this._updateFilterDOM();
  }

  openFilter() {
    this.isFilterOpen = true;
    this.isSearchOpen = false;
    this.isDisclaimerOpen = false;
    this.isChangelogOpen = false;
    this.isLocaleOpen = false;
    this._updateSearchDOM();
    this._updateDisclaimerDOM();
    this._updateChangelogDOM();
    this._updateLocaleDOM();
    this._updateFilterDOM();
  }

  closeFilter() {
    this.isFilterOpen = false;
    const toggleBtn = this.filterWidgetEl?.querySelector("#filter-toggle-btn, .filter-toggle-btn");
    const closeBtn = this.filterWidgetEl?.querySelector("#filter-close-btn, .filter-close-btn");
    if (closeBtn && typeof closeBtn.blur === "function") {
      closeBtn.blur();
    }
    if (toggleBtn && typeof toggleBtn.focus === "function") {
      toggleBtn.focus();
    }
    this._updateFilterDOM();
  }

  _updateFilterDOM() {
    const filterWidget = this.filterWidgetEl || (typeof document !== "undefined" ? document.getElementById("filter-widget") : null);
    updateWidgetDom(filterWidget, this.isFilterOpen, "#filter-toggle-btn, .filter-toggle-btn", "#filter-card, .filter-card", "translateY(-6px)");
  }

  toggleDisclaimer() {
    this.isDisclaimerOpen = !this.isDisclaimerOpen;
    if (this.isDisclaimerOpen) {
      this.isSearchOpen = false;
      this.isFilterOpen = false;
      this.isChangelogOpen = false;
      this.isLocaleOpen = false;
      this._updateSearchDOM();
      this._updateFilterDOM();
      this._updateChangelogDOM();
      this._updateLocaleDOM();
    }
    this._updateDisclaimerDOM();
  }

  openDisclaimer() {
    this.isDisclaimerOpen = true;
    this.isSearchOpen = false;
    this.isFilterOpen = false;
    this.isChangelogOpen = false;
    this.isLocaleOpen = false;
    this._updateSearchDOM();
    this._updateFilterDOM();
    this._updateChangelogDOM();
    this._updateLocaleDOM();
    this._updateDisclaimerDOM();
  }

  closeDisclaimer() {
    this.isDisclaimerOpen = false;
    const disclaimerWidget = this.disclaimerWidgetEl || (typeof document !== "undefined" ? document.getElementById("disclaimer-widget") : null);
    const toggleBtn = disclaimerWidget?.querySelector("#disclaimer-toggle-btn, .disclaimer-toggle-btn");
    const closeBtn = disclaimerWidget?.querySelector("#disclaimer-close-btn, .disclaimer-close-btn");
    if (closeBtn && typeof closeBtn.blur === "function") {
      closeBtn.blur();
    }
    if (toggleBtn && typeof toggleBtn.focus === "function") {
      toggleBtn.focus();
    }
    this._updateDisclaimerDOM();
  }

  _updateDisclaimerDOM() {
    const disclaimerWidget = this.disclaimerWidgetEl || (typeof document !== "undefined" ? document.getElementById("disclaimer-widget") : null);
    updateWidgetDom(disclaimerWidget, this.isDisclaimerOpen, "#disclaimer-toggle-btn, .disclaimer-toggle-btn", "#disclaimer-card, .disclaimer-card", "translateY(6px)");
  }

  toggleChangelog() {
    this.isChangelogOpen = !this.isChangelogOpen;
    if (this.isChangelogOpen) {
      this.isSearchOpen = false;
      this.isFilterOpen = false;
      this.isDisclaimerOpen = false;
      this.isLocaleOpen = false;
      this._updateSearchDOM();
      this._updateFilterDOM();
      this._updateDisclaimerDOM();
      this._updateLocaleDOM();
    }
    this._updateChangelogDOM();
  }

  openChangelog() {
    this.isChangelogOpen = true;
    this.isSearchOpen = false;
    this.isFilterOpen = false;
    this.isDisclaimerOpen = false;
    this.isLocaleOpen = false;
    this._updateSearchDOM();
    this._updateFilterDOM();
    this._updateDisclaimerDOM();
    this._updateLocaleDOM();
    this._updateChangelogDOM();
  }

  closeChangelog() {
    this.isChangelogOpen = false;
    const changelogWidget = this.changelogWidgetEl || (typeof document !== "undefined" ? document.getElementById("changelog-widget") : null);
    const toggleBtn = changelogWidget?.querySelector("#changelog-open-btn, .changelog-toggle-btn");
    const closeBtn = changelogWidget?.querySelector("#changelog-close-btn, .changelog-close-btn");
    if (closeBtn && typeof closeBtn.blur === "function") {
      closeBtn.blur();
    }
    if (toggleBtn && typeof toggleBtn.focus === "function") {
      toggleBtn.focus();
    }
    this._updateChangelogDOM();
  }

  _updateChangelogDOM() {
    const changelogWidget = this.changelogWidgetEl || (typeof document !== "undefined" ? document.getElementById("changelog-widget") : null);
    updateWidgetDom(changelogWidget, this.isChangelogOpen, "#changelog-open-btn, .changelog-toggle-btn", "#changelog-card, .changelog-card", "translateY(6px)");
  }

  toggleLocale() {
    this.isLocaleOpen = !this.isLocaleOpen;
    if (this.isLocaleOpen) {
      this.isSearchOpen = false;
      this.isFilterOpen = false;
      this.isDisclaimerOpen = false;
      this.isChangelogOpen = false;
      this._updateSearchDOM();
      this._updateFilterDOM();
      this._updateDisclaimerDOM();
      this._updateChangelogDOM();
    }
    this._updateLocaleDOM();
  }

  openLocale() {
    this.isLocaleOpen = true;
    this.isSearchOpen = false;
    this.isFilterOpen = false;
    this.isDisclaimerOpen = false;
    this.isChangelogOpen = false;
    this._updateSearchDOM();
    this._updateFilterDOM();
    this._updateDisclaimerDOM();
    this._updateChangelogDOM();
    this._updateLocaleDOM();
  }

  closeLocale() {
    this.isLocaleOpen = false;
    const localeWidget = this.localeWidgetEl || (typeof document !== "undefined" ? document.getElementById("locale-widget") : null);
    const toggleBtn = localeWidget?.querySelector("#locale-toggle-btn, .locale-toggle-btn");
    const closeBtn = localeWidget?.querySelector("#locale-close-btn, .locale-close-btn");
    closeBtn?.blur?.();
    toggleBtn?.focus?.();
    this._updateLocaleDOM();
  }

  _updateLocaleDOM() {
    const localeWidget = this.localeWidgetEl || (typeof document !== "undefined" ? document.getElementById("locale-widget") : null);
    updateWidgetDom(localeWidget, this.isLocaleOpen, "#locale-toggle-btn, .locale-toggle-btn", "#locale-card, .locale-card", "translateY(6px)");
  }
}
