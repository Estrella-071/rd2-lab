/**
 * Shared, presentation-only compendium formatting and range-control helpers.
 */
export function resolveEventDuration(event, mode, localization = null) {
  const modeFlag = mode === "coop" ? event?.mode_flags?.coop : event?.mode_flags?.versus;
  if (modeFlag === false) return "-";

  const rawValue = mode === "coop" ? event?.coop_time : event?.versus_time;
  if (event?.mode_flags?.display_time !== false && rawValue) return rawValue;

  const semanticLabels = {
    instant: ["event.duration.instant", "立即生效"],
    passive: ["event.duration.passive", "永久"],
    single_trigger: ["event.duration.single", "觸發 1 次"]
  };
  const semantic = semanticLabels[event?.timing_type];
  if (semantic) return localization?.t?.(semantic[0], {}, semantic[1]) || semantic[1];
  return rawValue || localization?.t?.("event.duration.passive", {}, "Permanent") || "Permanent";
}

export function translate(compendium, key, values = {}, fallback = "") {
  return compendium?.localization?.t?.(key, values, fallback) || fallback || key;
}

export function resolvePublicIconFilename(value, fallback) {
  const candidate = String(value || "").replace(/^icons\//, "");
  return /^[A-Za-z0-9_.-]+\.png$/.test(candidate) ? candidate : fallback;
}

export function attachElasticSlider(sliderInput, { maxRank = 50, onUpdate } = {}) {
  if (!sliderInput) return () => {};
  let isDragging = false;
  let activePointerId = null;
  let springTimer = null;

  const updateSliderUI = (rank, pct, overshootX = 0) => {
    sliderInput.value = String(rank);
    if (typeof sliderInput.style?.setProperty === "function") {
      sliderInput.style.setProperty("--slider-pct", `${pct}%`);
      sliderInput.style.setProperty("--overshoot-x", overshootX ? `${overshootX.toFixed(2)}px` : "0px");
    }
    if (typeof onUpdate === "function") {
      onUpdate(rank, pct, overshootX);
    }
  };

  const handlePointerMove = (e) => {
    if (!isDragging || e.pointerId !== activePointerId) return;
    const rect = sliderInput.getBoundingClientRect();
    if (!rect.width) return;

    const rawOffset = e.clientX - rect.left;
    const progress = rawOffset / rect.width;

    let rank;
    let pct;
    let overshootX;

    if (progress < 0) {
      const deltaX = rawOffset;
      const k = 48;
      const maxOvershoot = 26;
      overshootX = -(Math.abs(deltaX) * maxOvershoot) / (Math.abs(deltaX) + k);
      rank = 1;
      pct = 0;
    } else if (progress > 1) {
      const deltaX = rawOffset - rect.width;
      const k = 48;
      const maxOvershoot = 26;
      overshootX = (deltaX * maxOvershoot) / (deltaX + k);
      rank = maxRank;
      pct = 100;
    } else {
      rank = Math.round(1 + progress * (maxRank - 1));
      rank = Math.max(1, Math.min(maxRank, rank));
      pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
      overshootX = 0;
    }

    updateSliderUI(rank, pct, overshootX);
  };

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    activePointerId = e.pointerId;
    sliderInput.classList.add("is-dragging");
    sliderInput.classList.remove("is-springing");
    try {
      sliderInput.setPointerCapture(activePointerId);
    } catch (_) {}
    handlePointerMove(e);
  };

  const handlePointerUp = (e) => {
    if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    isDragging = false;
    try {
      sliderInput.releasePointerCapture(activePointerId);
    } catch (_) {}
    activePointerId = null;

    sliderInput.classList.remove("is-dragging");
    sliderInput.classList.add("is-springing");

    const curVal = Number.parseInt(sliderInput.value, 10) || 1;
    const targetPct = maxRank > 1 ? ((curVal - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(curVal, targetPct, 0);

    if (springTimer) clearTimeout(springTimer);
    springTimer = setTimeout(() => {
      sliderInput.classList.remove("is-springing");
      springTimer = null;
    }, 380);
  };

  const handleInput = (event) => {
    if (isDragging) return;
    const rank = Number.parseInt(event.target.value, 10) || 1;
    const pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(rank, pct, 0);
  };

  sliderInput.addEventListener("pointerdown", handlePointerDown);
  sliderInput.addEventListener("pointermove", handlePointerMove);
  sliderInput.addEventListener("pointerup", handlePointerUp);
  sliderInput.addEventListener("pointercancel", handlePointerUp);
  sliderInput.addEventListener("input", handleInput);

  return () => {
    if (springTimer) clearTimeout(springTimer);
    springTimer = null;
    isDragging = false;
    activePointerId = null;
    sliderInput.removeEventListener("pointerdown", handlePointerDown);
    sliderInput.removeEventListener("pointermove", handlePointerMove);
    sliderInput.removeEventListener("pointerup", handlePointerUp);
    sliderInput.removeEventListener("pointercancel", handlePointerUp);
    sliderInput.removeEventListener("input", handleInput);
    sliderInput.classList.remove("is-dragging", "is-springing");
  };
}
