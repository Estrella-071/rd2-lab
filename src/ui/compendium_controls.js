/**
 * Bind and synchronize the compendium's category, filter, sort, and view controls.
 */
function forceReflow(element) {
  return element.offsetHeight;
}

function setMenuExpanded(widget, toggle, menu, expanded) {
  if (!widget || !toggle || !menu) return;
  const isExpanded = Boolean(expanded);
  widget.classList.toggle("is-expanded", isExpanded);
  toggle.setAttribute("aria-expanded", String(isExpanded));
  menu.setAttribute("aria-hidden", String(!isExpanded));
  if (isExpanded) {
    menu.removeAttribute("inert");
    menu.setAttribute("role", "listbox");
  } else {
    menu.setAttribute("inert", "");
    menu.removeAttribute("role");
  }
  const options = [...menu.querySelectorAll(".category-option-item, .sort-option-item")];
  options.forEach((option) => {
    if (isExpanded) {
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(option.classList.contains("is-selected")));
    } else {
      option.removeAttribute("role");
      option.removeAttribute("aria-selected");
    }
  });
  const firstAvailableOption = options
    .find((option) => !option.classList.contains("is-selected"));
  options.forEach((option) => {
    option.tabIndex = isExpanded && option === firstAvailableOption ? 0 : -1;
  });
}

function getMenuConfigs() {
  if (typeof document === "undefined") return [];
  return [
    {
      widget: document.getElementById("compendium-category-widget"),
      toggle: document.getElementById("compendium-category-toggle-btn"),
      menu: document.getElementById("compendium-category-menu"),
    },
    {
      widget: document.getElementById("compendium-sort-widget"),
      toggle: document.getElementById("compendium-sort-toggle-btn"),
      menu: document.getElementById("compendium-sort-menu"),
    },
  ];
}

export function closeCompendiumMenus({ restoreFocus = false, exceptWidget = null } = {}) {
  let focusTarget = null;
  for (const config of getMenuConfigs()) {
    if (!config.widget || config.widget === exceptWidget) continue;
    if (config.widget.classList.contains("is-expanded") && !focusTarget) {
      focusTarget = config.toggle;
    }
    setMenuExpanded(config.widget, config.toggle, config.menu, false);
  }
  if (restoreFocus) focusTarget?.focus?.();
  return Boolean(focusTarget);
}

function focusMenuOption(menu, option) {
  if (!menu || !option) return;
  menu.querySelectorAll(".category-option-item, .sort-option-item").forEach((candidate) => {
    candidate.tabIndex = candidate === option ? 0 : -1;
  });
  option.focus();
}

function bindMenuKeyboard(compendium, { widget, toggle, menu }) {
  if (!widget || !toggle || !menu) return;
  compendium._listen(toggle, "keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    closeCompendiumMenus({ exceptWidget: widget });
    setMenuExpanded(widget, toggle, menu, true);
    const options = [...menu.querySelectorAll(".category-option-item, .sort-option-item")]
      .filter((option) => !option.classList.contains("is-selected"));
    focusMenuOption(menu, event.key === "ArrowUp" ? options.at(-1) : options[0]);
  });
  compendium._listen(menu, "keydown", (event) => {
    const activeOption = event.target.closest?.(".category-option-item, .sort-option-item");
    if (!activeOption) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuExpanded(widget, toggle, menu, false);
      toggle.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = [...menu.querySelectorAll(".category-option-item, .sort-option-item")]
      .filter((option) => !option.classList.contains("is-selected"));
    const currentIndex = Math.max(0, options.indexOf(activeOption));
    let nextOption;
    if (event.key === "Home") {
      nextOption = options[0];
    } else if (event.key === "End") {
      nextOption = options.at(-1);
    } else if (event.key === "ArrowUp") {
      nextOption = options[(currentIndex - 1 + options.length) % options.length];
    } else {
      nextOption = options[(currentIndex + 1) % options.length];
    }
    focusMenuOption(menu, nextOption);
  });
}

export function bindCompendiumControls(compendium) {
  // 1. Back button
  const backBtn = document.getElementById("compendium-back-btn");
  if (backBtn) {
    compendium._listen(backBtn, "click", () => compendium.close());
  }

  // 2. Category Dropdown
  const catWidget = document.getElementById("compendium-category-widget");
  const catToggleBtn = document.getElementById("compendium-category-toggle-btn");
  const catMenu = document.getElementById("compendium-category-menu");
  const catLabel = document.getElementById("compendium-category-current-label");
  const catOptions = document.querySelectorAll(".category-option-item");
  setMenuExpanded(catWidget, catToggleBtn, catMenu, false);

  if (catToggleBtn) {
    compendium._listen(catToggleBtn, "click", (e) => {
      e.stopPropagation();
      const shouldExpand = !catWidget?.classList.contains("is-expanded");
      closeCompendiumMenus({ exceptWidget: catWidget });
      setMenuExpanded(catWidget, catToggleBtn, catMenu, shouldExpand);
    });
  }
  bindMenuKeyboard(compendium, {
    widget: catWidget,
    toggle: catToggleBtn,
    menu: catMenu,
  });

  catOptions.forEach((opt) => {
    compendium._listen(opt, "click", (e) => {
      e.stopPropagation();
      catOptions.forEach((o) => {
        o.classList.remove("is-selected");
        o.setAttribute("aria-pressed", "false");
        o.setAttribute("aria-selected", "false");
      });
      opt.classList.add("is-selected");
      opt.setAttribute("aria-pressed", "true");
      opt.setAttribute("aria-selected", "true");
      setMenuExpanded(catWidget, catToggleBtn, catMenu, false);

      compendium.category = opt.dataset.value || "dice";
      if (catLabel) catLabel.textContent = opt.textContent.trim();
      compendium._syncCategoryTabs();
      compendium.render();
      catToggleBtn?.focus?.();
    });
  });

  // 3. Branch Tabs (Dice)
  const branchTabsContainer = document.getElementById("compendium-tabs");
  const branchTabs = document.querySelectorAll("#compendium-tabs .compendium-tab");
  branchTabs.forEach((tab) => {
    compendium._listen(tab, "click", () => {
      branchTabs.forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      compendium.branch = tab.dataset.branch || "all";
      compendium._syncTabsIndicator(branchTabsContainer, tab, true);
      compendium.render();
    });
  });

  // 4. Event Tabs
  const eventTabsContainer = document.getElementById("compendium-event-tabs");
  const eventTabs = document.querySelectorAll("#compendium-event-tabs .compendium-tab");
  eventTabs.forEach((tab) => {
    compendium._listen(tab, "click", () => {
      eventTabs.forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      compendium.eventMode = tab.dataset.eventMode || "all";
      compendium._syncTabsIndicator(eventTabsContainer, tab, true);
      compendium.render();
    });
  });

  // 5. Monster Difficulty Tabs
  const monsterTabsContainer = document.getElementById("compendium-monster-tabs");
  const monsterTabs = document.querySelectorAll("#compendium-monster-tabs .compendium-tab");

  monsterTabs.forEach((tab) => {
    compendium._listen(tab, "click", () => {
      const diff = tab.dataset.monsterDifficulty;
      monsterTabs.forEach((t) => {
        const isTarget = t === tab;
        t.classList.toggle("is-active", isTarget);
        t.setAttribute("aria-selected", String(isTarget));
      });
      compendium._syncTabsIndicator(monsterTabsContainer, tab, true);

      if (diff === "hard") {
        compendium._showComingSoonModal(tab);
      } else {
        compendium.monsterDifficulty = "normal";
        compendium.render();
      }
    });
  });

  if (compendium.comingSoonCloseBtn) {
    compendium._listen(compendium.comingSoonCloseBtn, "click", (e) => {
      e.stopPropagation();
      compendium._hideComingSoonModal();
    });
  }

  if (compendium.comingSoonModal) {
    compendium._listen(compendium.comingSoonModal, "click", (e) => {
      if (e.target === compendium.comingSoonModal) {
        compendium._hideComingSoonModal();
      }
    });
  }

  // 6. View Mode Toggle (Cards / Grid)
  const modeBtns = document.querySelectorAll(".view-toggle-btn");
  modeBtns.forEach((btn) => {
    compendium._listen(btn, "click", () => {
      compendium._userChangedViewMode = true;
      modeBtns.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", "true");
      compendium.viewMode = btn.dataset.mode || "cards";
      compendium.render();
    });
  });
  compendium._syncViewModeButtons();

  // 7. Search Input
  const searchInput = document.getElementById("compendium-search-input");
  if (searchInput) {
    compendium._listen(searchInput, "input", (e) => {
      if (compendium._searchTimer) clearTimeout(compendium._searchTimer);
      compendium._searchTimer = setTimeout(() => {
        compendium.search = e.target.value;
        compendium.render();
      }, 80);
    });
  }

  // 8. Custom Sort Widget
  const sortWidget = document.getElementById("compendium-sort-widget");
  const sortToggleBtn = document.getElementById("compendium-sort-toggle-btn");
  const sortMenu = document.getElementById("compendium-sort-menu");
  const sortLabel = document.getElementById("compendium-sort-current-label");
  const sortOptions = document.querySelectorAll(".sort-option-item");
  setMenuExpanded(sortWidget, sortToggleBtn, sortMenu, false);

  if (sortToggleBtn) {
    compendium._listen(sortToggleBtn, "click", (e) => {
      e.stopPropagation();
      const shouldExpand = !sortWidget?.classList.contains("is-expanded");
      closeCompendiumMenus({ exceptWidget: sortWidget });
      setMenuExpanded(sortWidget, sortToggleBtn, sortMenu, shouldExpand);
    });
  }
  bindMenuKeyboard(compendium, {
    widget: sortWidget,
    toggle: sortToggleBtn,
    menu: sortMenu,
  });

  sortOptions.forEach((opt) => {
    compendium._listen(opt, "click", (e) => {
      e.stopPropagation();
      sortOptions.forEach((o) => {
        o.classList.remove("is-selected");
        o.setAttribute("aria-pressed", "false");
        o.setAttribute("aria-selected", "false");
      });
      opt.classList.add("is-selected");
      opt.setAttribute("aria-pressed", "true");
      opt.setAttribute("aria-selected", "true");
      setMenuExpanded(sortWidget, sortToggleBtn, sortMenu, false);

      compendium.sort = opt.dataset.value || "default";
      if (sortLabel) sortLabel.textContent = opt.textContent.trim();
      compendium.render();
      sortToggleBtn?.focus?.();
    });
  });

  // 9. Compact Modal Close
  if (compendium.modalCloseBtn) {
    compendium._listen(compendium.modalCloseBtn, "click", () => compendium.closeCompactModal());
  }
  const backdrop = document.querySelector(".compendium-modal-backdrop");
  if (backdrop) {
    compendium._listen(backdrop, "click", () => compendium.closeCompactModal());
  }

  // Global click to close popovers/dropdowns
  compendium._listen(window, "click", (e) => {
    if (!e.target.closest("#compendium-category-widget")) {
      setMenuExpanded(catWidget, catToggleBtn, catMenu, false);
    }
    if (!e.target.closest("#compendium-sort-widget")) {
      setMenuExpanded(sortWidget, sortToggleBtn, sortMenu, false);
    }
    if (!e.target.closest(".rune-slider-popover") && !e.target.closest(".rune-rank-badge-btn")) {
      document.querySelectorAll(".rune-slider-popover").forEach((p) => (p.hidden = true));
    }
  });
}


export function listen(compendium, target, type, handler) {
  if (!target?.addEventListener) return;
  target.addEventListener(type, handler);
  compendium._controlListeners.push({ target, type, handler });
}


export function syncCategoryTabs(compendium) {
  const diceTabs = document.getElementById("compendium-tabs");
  const eventTabs = document.getElementById("compendium-event-tabs");
  const monsterTabs = document.getElementById("compendium-monster-tabs");
  const sortWidget = document.getElementById("compendium-sort-widget");
  const viewToggle = document.querySelector(".compendium-view-toggle");

  if (diceTabs) diceTabs.hidden = compendium.category !== "dice";
  if (eventTabs) eventTabs.hidden = compendium.category !== "event";
  if (monsterTabs) monsterTabs.hidden = compendium.category !== "monster";
  if (sortWidget) sortWidget.hidden = compendium.category !== "dice";
  if (viewToggle) viewToggle.hidden = false;

  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      if (compendium.category === "dice" && diceTabs) compendium._syncTabsIndicator(diceTabs, null, false);
      if (compendium.category === "event" && eventTabs) compendium._syncTabsIndicator(eventTabs, null, false);
      if (compendium.category === "monster" && monsterTabs) compendium._syncTabsIndicator(monsterTabs, null, false);
    });
  }
}


export function syncViewModeButtons(compendium) {
  const modeBtns = document.querySelectorAll(".view-toggle-btn");
  modeBtns.forEach((btn) => {
    const active = (btn.dataset.mode || "cards") === compendium.viewMode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}


export function syncTabsIndicator(compendium, container, activeTab = null, animated = true) {
  if (!container || typeof document === "undefined") return;
  let indicator = container.querySelector(".compendium-tabs-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "compendium-tabs-indicator";
    indicator.setAttribute("aria-hidden", "true");
    container.prepend(indicator);
  }

  const currentTab = activeTab || container.querySelector(".compendium-tab.is-active");
  if (!currentTab || container.hidden || container.style.display === "none") {
    indicator.style.opacity = "0";
    return;
  }

  if (typeof currentTab.getBoundingClientRect !== "function" || typeof container.getBoundingClientRect !== "function") {
    indicator.style.opacity = "1";
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const tabRect = currentTab.getBoundingClientRect();

  if (tabRect.width === 0 || tabRect.height === 0) {
    const retryCount = Number(indicator.dataset.positionRetry || "0");
    indicator.style.opacity = "0";
    if (
      retryCount < 2
      && container.isConnected
      && !container.closest?.("[hidden]")
      && typeof requestAnimationFrame !== "undefined"
    ) {
      indicator.dataset.positionRetry = String(retryCount + 1);
      requestAnimationFrame(() => compendium._syncTabsIndicator(container, currentTab, false));
    }
    return;
  }
  delete indicator.dataset.positionRetry;

  const left = tabRect.left - containerRect.left;
  const width = tabRect.width;
  const color = currentTab.style.getPropertyValue("--tab-color")?.trim() || "#ffffff";

  if (!animated) {
    const oldTransition = indicator.style.transition;
    indicator.style.transition = "none";
    indicator.style.width = `${width}px`;
    indicator.style.transform = `translateX(${left}px)`;
    indicator.style.backgroundColor = color;
    indicator.style.boxShadow = `0 0 14px ${color}`;
    indicator.style.opacity = "1";
    if (typeof indicator.offsetHeight === "number") forceReflow(indicator);
    indicator.style.transition = oldTransition;
    return;
  }

  indicator.style.opacity = "1";
  indicator.style.width = `${width}px`;
  indicator.style.transform = `translateX(${left}px)`;
  indicator.style.backgroundColor = color;
  indicator.style.boxShadow = `0 0 14px ${color}`;
}
