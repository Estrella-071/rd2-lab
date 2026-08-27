import { closeCompendiumMenus } from "./compendium_controls.js";

function forceReflow(element) {
  return element.offsetWidth;
}

function isVisibleModal(element) {
  return Boolean(
    element
    && !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
  );
}

function getOpenNestedModal(compendium) {
  if (isVisibleModal(compendium.comingSoonModal)) {
    return { kind: "coming-soon", element: compendium.comingSoonModal };
  }
  if (isVisibleModal(compendium.modalEl)) {
    return { kind: "compact", element: compendium.modalEl };
  }
  return null;
}

function getFocusTarget(triggerElement) {
  if (triggerElement?.focus) return triggerElement;
  if (typeof document !== "undefined") return document.activeElement;
  return null;
}

/**
 * Resolve focusable controls for the currently active nested dialog.
 */
export function getModalFocusable(compendium, modal) {
  const isVisible = (element) => {
    if (
      element.hidden
      || element.closest?.("[hidden], [inert], [aria-hidden='true']")
    ) return false;
    const view = element.ownerDocument?.defaultView;
    if (!view) return true;
    const style = view.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  return [...modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")]
    .filter(isVisible);
}

function trapFocus(compendium, event, scope) {
  if (event.key !== "Tab") return false;
  const focusable = compendium._getModalFocusable(scope);
  if (focusable.length === 0) {
    event.preventDefault();
    scope.focus?.();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!scope.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}


export function handleModalKeydown(compendium, event) {
  if (
    !compendium.overlay
    || compendium.overlay.hidden
    || compendium.overlay.getAttribute("aria-hidden") === "true"
  ) return;
  const modal = getOpenNestedModal(compendium);
  if (!modal) {
    if (event.key === "Escape") {
      if (!closeCompendiumMenus({ restoreFocus: true })) compendium.close();
      event.preventDefault();
      return;
    }
    trapFocus(compendium, event, compendium.overlay);
    return;
  }

  if (event.key === "Escape") {
    if (modal.kind === "coming-soon") compendium._hideComingSoonModal();
    else compendium.closeCompactModal();
    event.preventDefault();
    return;
  }
  trapFocus(compendium, event, modal.element);
}


export function showComingSoonModal(compendium, opener = document.activeElement) {
  if (!compendium.comingSoonModal) return;
  compendium._modalReturnFocus.set("coming-soon", opener?.focus ? opener : null);
  compendium.comingSoonModal.hidden = false;
  compendium.comingSoonModal.setAttribute("aria-hidden", "false");
  compendium.comingSoonModal.removeAttribute("inert");
  compendium.comingSoonModal.classList.remove("is-exiting");
  compendium.comingSoonCloseBtn?.focus?.();
  requestAnimationFrame(() => {
    if (
      compendium.comingSoonModal
      && !compendium.comingSoonModal.hidden
      && compendium.comingSoonModal.getAttribute("aria-hidden") !== "true"
    ) {
      compendium.comingSoonModal.classList.add("is-visible");
    }
  });
}


export function hideComingSoonModal(compendium, { restoreFocus = true, immediate = false } = {}) {
  if (compendium.comingSoonModal) {
    compendium.comingSoonModal.classList.remove("is-visible");
    compendium.comingSoonModal.setAttribute("aria-hidden", "true");
    compendium.comingSoonModal.setAttribute("inert", "");
    if (compendium._comingSoonCloseTimer) clearTimeout(compendium._comingSoonCloseTimer);
    if (immediate) {
      compendium.comingSoonModal.hidden = true;
      compendium.comingSoonModal.classList.remove("is-exiting");
      compendium._comingSoonCloseTimer = null;
    } else {
      compendium.comingSoonModal.classList.add("is-exiting");
      compendium._comingSoonCloseTimer = setTimeout(() => {
        compendium.comingSoonModal.hidden = true;
        compendium.comingSoonModal.classList.remove("is-exiting");
        compendium._comingSoonCloseTimer = null;
      }, 220);
    }
  }
  if (restoreFocus) compendium._restoreModalFocus("coming-soon");
  else compendium._modalReturnFocus.delete("coming-soon");
  const normalTab = document.querySelector('#compendium-monster-tabs [data-monster-difficulty="normal"]');
  const hardTab = document.querySelector('#compendium-monster-tabs [data-monster-difficulty="hard"]');
  if (normalTab) {
    normalTab.classList.add("is-active");
    normalTab.setAttribute("aria-selected", "true");
  }
  if (hardTab) {
    hardTab.classList.remove("is-active");
    hardTab.setAttribute("aria-selected", "false");
  }
  compendium._syncTabsIndicator(document.getElementById("compendium-monster-tabs"), normalTab, true);
}


export function restoreModalFocus(compendium, kind) {
  const returnFocus = compendium._modalReturnFocus.get(kind);
  compendium._modalReturnFocus.delete(kind);
  if (returnFocus?.isConnected && !returnFocus.closest?.("[hidden]")) returnFocus.focus?.();
}


export function isCompendiumOpen(compendium) {
  return compendium.overlay
    && !compendium.overlay.hidden
    && compendium.overlay.getAttribute("aria-hidden") !== "true"
    && !compendium.overlay.classList.contains("is-exiting");
}


export function restoreCompendiumFocus(compendium) {
  const returnFocus = compendium._returnFocus;
  compendium._returnFocus = null;
  if (returnFocus?.isConnected && !returnFocus.closest?.("[hidden]")) {
    returnFocus.focus?.();
    return;
  }
  if (typeof document !== "undefined") {
    document.getElementById("tree-center-compendium-btn")?.focus?.();
  }
}


export function openCompendium(compendium, triggerElement = null) {
  if (!compendium.overlay) return;

  // A rapid close→open sequence must invalidate the pending close timer;
  // otherwise the stale callback hides the newly reopened overlay and tears
  // down the Spine context that was just reacquired by render().
  if (compendium._closeTimer) {
    clearTimeout(compendium._closeTimer);
    compendium._closeTimer = null;
  }

  const wasHidden = compendium.overlay.hidden
    || compendium.overlay.getAttribute("aria-hidden") === "true"
    || compendium.overlay.classList.contains("is-exiting");
  if (wasHidden) {
    const activeElement = getFocusTarget(triggerElement);
    compendium._returnFocus = activeElement?.focus ? activeElement : null;
  }

  const compendiumShockwaveRing = typeof document !== "undefined" ? document.getElementById("compendium-shockwave-ring") : null;
  if (compendiumShockwaveRing) {
    compendiumShockwaveRing.classList.remove("is-contracting");
    compendiumShockwaveRing.classList.add("is-expanding");
  }

  compendium.overlay.hidden = false;
  compendium.overlay.setAttribute("role", "dialog");
  compendium.overlay.setAttribute("aria-hidden", "false");
  compendium.overlay.removeAttribute("inert");
  compendium.overlay.classList.remove("is-exiting");
  forceReflow(compendium.overlay);
  compendium.overlay.classList.add("is-entering");

  if (!compendium._userChangedViewMode && typeof window !== "undefined") {
    compendium.viewMode = window.innerWidth <= 768 ? "grid" : "cards";
  }
  compendium._syncViewModeButtons();

  compendium.render({ animated: false });
  compendium._syncCategoryTabs();

  // Move keyboard focus into the full-screen view. Without this handoff,
  // Tab continues through the hidden-behind-the-overlay browsing controls
  // instead of exposing the first available compendium action.
  if (wasHidden) {
    document.getElementById("compendium-back-btn")?.focus?.({ preventScroll: true });
  }

  if (compendium._openTimer) clearTimeout(compendium._openTimer);
  compendium._openTimer = setTimeout(() => {
    if (compendiumShockwaveRing) compendiumShockwaveRing.classList.remove("is-expanding");
    if (compendium.overlay) compendium.overlay.classList.remove("is-entering");
  }, 520);
}


export function closeCompendium(compendium, targetNodeIdToLocate = null) {
  if (!compendium.overlay) return;

  closeCompendiumMenus();
  if (compendium.modalEl && !compendium.modalEl.hidden) {
    closeCompactModal(compendium, { restoreFocus: false });
  }
  if (compendium.comingSoonModal && !compendium.comingSoonModal.hidden) {
    hideComingSoonModal(compendium, { restoreFocus: false, immediate: true });
  }

  const compendiumShockwaveRing = typeof document !== "undefined" ? document.getElementById("compendium-shockwave-ring") : null;
  if (compendiumShockwaveRing) {
    compendiumShockwaveRing.classList.remove("is-expanding");
    compendiumShockwaveRing.classList.add("is-contracting");
  }

  compendium._restoreCompendiumFocus();

  compendium.overlay.classList.remove("is-entering");
  compendium.overlay.classList.add("is-exiting");
  compendium.overlay.setAttribute("aria-hidden", "true");
  compendium.overlay.setAttribute("inert", "");

  if (compendium._spineObserver) {
    compendium._spineObserver.disconnect();
  }
  if (compendium.spineEngine) {
    compendium.spineEngine.disposeAll();
  }
  compendium._activeSpineElement = null;

  if (targetNodeIdToLocate && typeof compendium.onLocateNode === "function") {
    compendium.onLocateNode(targetNodeIdToLocate);
  }

  if (compendium._closeTimer) clearTimeout(compendium._closeTimer);
  compendium._closeTimer = setTimeout(() => {
    if (compendium.overlay) {
      compendium.overlay.hidden = true;
      compendium.overlay.setAttribute("aria-hidden", "true");
      compendium.overlay.classList.remove("is-exiting");
    }
    if (compendiumShockwaveRing) {
      compendiumShockwaveRing.classList.remove("is-contracting");
    }
    compendium._closeTimer = null;
  }, 280);
}


export function openCompactModal(compendium, cardElement, triggerElement = null) {
  if (!compendium.modalEl || !compendium.modalCardSlot) return;
  const previousVisual = compendium.modalCardSlot.querySelector?.(".monster-spine-visual");
  if (previousVisual && compendium.spineEngine) {
    compendium.spineEngine.releaseCanvas(previousVisual);
  }
  const activeElement = getFocusTarget(triggerElement);
  compendium._modalReturnFocus.set("compact", activeElement?.focus ? activeElement : null);
  compendium.modalCardSlot.innerHTML = "";
  compendium.modalCardSlot.appendChild(cardElement);
  compendium.modalEl.setAttribute("role", "dialog");
  compendium.modalEl.setAttribute("aria-modal", "true");
  const cardTitle = cardElement?.querySelector?.(".tooltip-title")?.textContent?.trim() || "";
  const modalLabel = compendium.localization?.t?.("compendium.details", { name: cardTitle }, `View details for ${cardTitle}`) || `View details for ${cardTitle}`;
  compendium.modalEl.setAttribute("aria-label", modalLabel);
  compendium.modalEl.setAttribute("aria-hidden", "false");
  compendium.modalEl.removeAttribute("inert");
  compendium.modalEl.hidden = false;
  compendium.modalCloseBtn?.focus?.();

  // 彈窗內的 Spine 怪物立即喚醒
  const visual = cardElement?.querySelector?.(".monster-spine-visual");
  if (visual?.__monsterVisualDefinition && compendium.spineEngine) {
    // Modal cards live outside the compendium scroll root. Leaving the visual
    // attached to that root's observer produces an immediate non-intersecting
    // entry that disposes the instance acquired below.
    compendium._spineObserver?.unobserve?.(visual);
    compendium.spineEngine.acquireCanvas(visual, visual.__monsterVisualDefinition);
  }
}

export function closeCompactModal(compendium, { restoreFocus = true } = {}) {
  if (compendium.modalEl) {
    const visual = compendium.modalCardSlot?.querySelector?.(".monster-spine-visual");
    if (visual && compendium.spineEngine) {
      compendium.spineEngine.releaseCanvas(visual);
    }
    compendium.modalEl.hidden = true;
    compendium.modalEl.setAttribute("aria-hidden", "true");
    compendium.modalEl.setAttribute("inert", "");
    compendium.modalEl.removeAttribute("role");
    compendium.modalEl.removeAttribute("aria-modal");
    if (compendium.modalCardSlot) {
      compendium.modalCardSlot.innerHTML = "";
    }
  }
  const returnFocusEl = compendium._modalReturnFocus.get("compact");
  if (restoreFocus && returnFocusEl?.isConnected && typeof returnFocusEl.focus === "function") {
    returnFocusEl.focus();
  }
  compendium._modalReturnFocus.delete("compact");
}
