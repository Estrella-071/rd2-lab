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

export function attachElasticSlider(sliderInput, { maxRank = 50, onUpdate, onCommit, onBegin, thumbRadius = 10 } = {}) {
  if (!sliderInput) return () => {};
  let isDragging = false;
  let activePointerId = null;
  let springTimer = null;
  let currentRank = Math.max(1, Math.min(maxRank, Number.parseInt(sliderInput.value, 10) || 1));
  let dwellRank = currentRank;
  let confirmedRank = currentRank;
  let dwellStartTime = 0;

  const getNow = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

  const updateSliderUI = (rank, pct, overshootX = 0) => {
    currentRank = rank;
    sliderInput.value = String(rank);
    if (typeof sliderInput.style?.setProperty === "function") {
      sliderInput.style.setProperty("--slider-pct", `${pct}%`);
      sliderInput.style.setProperty("--overshoot-x", overshootX ? `${overshootX.toFixed(2)}px` : "0px");
    }
    if (typeof onUpdate === "function") {
      onUpdate(rank, pct, overshootX);
    }
  };

  const computeRankAndProgress = (clientX) => {
    const rect = sliderInput.getBoundingClientRect?.() || { left: 0, width: 0 };
    if (!rect.width) return { rank: currentRank, pct: 0, overshootX: 0 };

    const rawOffset = clientX - rect.left;
    const effectiveWidth = Math.max(1, rect.width - 2 * thumbRadius);
    const effectiveOffset = rawOffset - thumbRadius;
    const progress = effectiveOffset / effectiveWidth;

    let rank;
    let pct;
    let overshootX;

    if (progress < 0) {
      const deltaX = effectiveOffset;
      const k = 48;
      const maxOvershoot = 26;
      overshootX = -(Math.abs(deltaX) * maxOvershoot) / (Math.abs(deltaX) + k);
      rank = 1;
      pct = 0;
    } else if (progress > 1) {
      const deltaX = effectiveOffset - effectiveWidth;
      const k = 48;
      const maxOvershoot = 26;
      overshootX = (deltaX * maxOvershoot) / (deltaX + k);
      rank = maxRank;
      pct = 100;
    } else {
      // 刻度磁吸與滯後死區 (Hysteresis deadband): 當前等級邊界微幅擴展 8%，避免臨界邊界晃動
      const curProgress = maxRank > 1 ? (currentRank - 1) / (maxRank - 1) : 0;
      const diff = progress - curProgress;
      const step = maxRank > 1 ? 1 / (maxRank - 1) : 1;
      const hysteresisThreshold = 0.58 * step;

      if (Math.abs(diff) <= hysteresisThreshold) {
        rank = currentRank;
      } else {
        rank = Math.round(1 + progress * (maxRank - 1));
      }

      rank = Math.max(1, Math.min(maxRank, rank));
      pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
      overshootX = 0;
    }

    return { rank, pct, overshootX };
  };

  const handlePointerMove = (e) => {
    if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    const now = getNow();
    const { rank, pct, overshootX } = computeRankAndProgress(e.clientX);

    if (rank !== dwellRank) {
      if (now - dwellStartTime >= 60) {
        confirmedRank = dwellRank;
      }
      dwellRank = rank;
      dwellStartTime = now;
    }

    updateSliderUI(rank, pct, overshootX);
  };

  const handlePointerDown = (e) => {
    if (e.button !== 0 && typeof e.button === "number") return;
    if (typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    try {
      if (typeof sliderInput.focus === "function") sliderInput.focus();
    } catch (_) {}

    if (typeof onBegin === "function") {
      onBegin();
    }

    isDragging = true;
    activePointerId = e.pointerId;
    sliderInput.classList?.add?.("is-dragging");
    sliderInput.classList?.remove?.("is-springing");
    try {
      if (activePointerId !== null && typeof sliderInput.setPointerCapture === "function") {
        sliderInput.setPointerCapture(activePointerId);
      }
    } catch (_) {}

    dwellRank = currentRank;
    confirmedRank = currentRank;
    dwellStartTime = getNow();
    handlePointerMove(e);
  };

  let suppressNextNativeChange = false;

  const handlePointerUp = (e) => {
    if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    isDragging = false;
    try {
      if (activePointerId !== null && typeof sliderInput.releasePointerCapture === "function") {
        sliderInput.releasePointerCapture(activePointerId);
      }
    } catch (_) {}
    activePointerId = null;

    sliderInput.classList?.remove?.("is-dragging");
    sliderInput.classList?.add?.("is-springing");

    const now = getNow();
    let finalRank = currentRank;

    // 抬手防抖過濾：如果在前一個等級停留超過 60ms，且在抬手最後 40ms 內發生了 ±1 級的微小離地抖動，鎖定停留確認的等級
    if (now - dwellStartTime < 40 && Math.abs(currentRank - confirmedRank) === 1) {
      finalRank = confirmedRank;
    } else if (now - dwellStartTime >= 60) {
      finalRank = dwellRank;
    }

    const targetPct = maxRank > 1 ? ((finalRank - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(finalRank, targetPct, 0);

    suppressNextNativeChange = true;
    if (typeof onCommit === "function") {
      onCommit(finalRank);
    }

    setTimeout(() => {
      suppressNextNativeChange = false;
    }, 60);

    if (springTimer) clearTimeout(springTimer);
    springTimer = setTimeout(() => {
      sliderInput.classList?.remove?.("is-springing");
      springTimer = null;
    }, 380);
  };

  const handleInput = (event) => {
    if (isDragging) return;
    const rank = Math.max(1, Math.min(maxRank, Number.parseInt(event.target?.value, 10) || 1));
    const pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(rank, pct, 0);
  };

  const handleChange = (event) => {
    if (isDragging) return;
    if (suppressNextNativeChange) {
      suppressNextNativeChange = false;
      sliderInput.value = String(currentRank);
      return;
    }
    const rank = Math.max(1, Math.min(maxRank, Number.parseInt(event.target?.value, 10) || 1));
    const pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(rank, pct, 0);
    if (typeof onCommit === "function") {
      onCommit(rank);
    }
  };

  sliderInput.addEventListener("pointerdown", handlePointerDown);
  sliderInput.addEventListener("pointermove", handlePointerMove);
  sliderInput.addEventListener("pointerup", handlePointerUp);
  sliderInput.addEventListener("pointercancel", handlePointerUp);
  sliderInput.addEventListener("input", handleInput);
  if (typeof onCommit === "function") {
    sliderInput.addEventListener("change", handleChange);
  }

  return () => {
    if (springTimer) clearTimeout(springTimer);
    springTimer = null;
    isDragging = false;
    activePointerId = null;
    suppressNextNativeChange = false;
    sliderInput.removeEventListener("pointerdown", handlePointerDown);
    sliderInput.removeEventListener("pointermove", handlePointerMove);
    sliderInput.removeEventListener("pointerup", handlePointerUp);
    sliderInput.removeEventListener("pointercancel", handlePointerUp);
    sliderInput.removeEventListener("input", handleInput);
    if (typeof onCommit === "function") {
      sliderInput.removeEventListener("change", handleChange);
    }
    sliderInput.classList?.remove?.("is-dragging", "is-springing");
  };
}
