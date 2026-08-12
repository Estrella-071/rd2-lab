// Draws the dice tree and its selection states.

import { computeUpstreamTopologyPath } from "../domain/dag_topology.js";
import { getSimulationNodeView, getUnlockConditionLabel, calculateAllFactionLevels } from "../domain/simulation_plan.js";
import { escapeHtml } from "../domain/game_text.js";

const FACTION_SELECTION_COLORS = {
  1: { name: "自然", base: "#89E464", runner: "#D7FFA4" },
  2: { name: "工學", base: "#F5DA68", runner: "#FFFFA2" },
  3: { name: "魔法", base: "#4692F1", runner: "#7CFAFD" },
  4: { name: "秩序", base: "#9F95C1", runner: "#FFFEFF" },
  5: { name: "渾沌", base: "#A93BEA", runner: "#EE6CFA" },
};

const BRANCH_GLOW_COLORS = Object.freeze({
  1: "#7ee352",
  2: "#f6c445",
  3: "#50b5ff",
  4: "#baa8e5",
  5: "#d656ff"
});

const NODE_TYPE_CLASSES = Object.freeze({
  DICE: "node-type-dice",
  DICE_RUNE: "node-type-dice-rune",
  PLAYER_PASSIVE: "node-type-player-passive",
  PERK: "node-type-perk"
});

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SIMULATION_OCCLUSION_FILL = "#2f2942";

function ensureSimulationOcclusionLayer(svg, ownerDocument) {
  let layer = svg.querySelector("g.node-simulation-occlusion-layer");
  if (layer) return layer;

  layer = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  layer.setAttribute("class", "node-simulation-occlusion-layer");
  layer.setAttribute("pointer-events", "none");
  const firstNode = Array.from(svg.children || []).find((child) => child.classList?.contains?.("node"));
  if (firstNode) firstNode.before(layer);
  else svg.appendChild(layer);
  return layer;
}

function collectExistingSimulationOcclusions(layer) {
  const existing = new Map();
  layer.querySelectorAll?.("g.node-simulation-occlusion").forEach((element) => {
    const nodeId = element.dataset?.occlusionFor;
    if (nodeId) existing.set(String(nodeId), element);
  });
  return existing;
}

function resolveNodeElementId(nodeElement) {
  return String(nodeElement.dataset?.nodeId || nodeElement.id?.replace("node-", "") || "");
}

const CENTER_STAT_BRANCH_BY_COLOR = Object.freeze({
  "8ae665": 1,
  "f9da67": 2,
  "4591f0": 3,
  "9c97bc": 4,
  "aa3cea": 5
});

const FILTER_ACTION_TYPES = new Set(["SET_FILTER", "CLEAR_FILTERS"]);

function estimateTextWidth(text, fontSize = 12) {
  let w = 0;
  for (const ch of String(text || "")) {
    if (ch.codePointAt(0) > 255) {
      w += fontSize * 1.08;
    } else {
      w += fontSize * 0.62;
    }
  }
  return Math.round(w);
}

function selectionLayerMarkup(nodeType, isBig, colors) {
  if (nodeType === "DICE") {
    const x = -68;
    const y = -71;
    const width = 136;
    const height = 142;
    const radius = 17;
    const perimeter = 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
    const dashLength = 80;
    const dashGap = Math.round(perimeter / 2 - dashLength);
    return `
      <rect class="sel-box-base" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="none" stroke="${colors.base}" />
      <rect class="sel-box-runner" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="none" stroke="${colors.runner}" style="stroke-dasharray: ${dashLength} ${dashGap} ${dashLength} ${dashGap}; stroke-dashoffset: 0; --path-len: ${Math.round(perimeter)};" />
    `;
  }
  if (isBig) {
    return `
      <rect class="sel-box-base" x="-50" y="-50" width="100" height="100" rx="21" ry="21" transform="rotate(45)" fill="none" stroke="#FFFFFF" />
    `;
  }
  if (nodeType === "PERK") {
    const x = -69;
    const y = -39;
    const width = 138;
    const height = 78;
    const radius = 15;
    const perimeter = 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
    const dashLength = 65;
    const dashGap = Math.round(perimeter / 2 - dashLength);
    return `
      <rect class="sel-box-base" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="none" stroke="${colors.base}" />
      <rect class="sel-box-runner" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="none" stroke="${colors.runner}" style="stroke-dasharray: ${dashLength} ${dashGap} ${dashLength} ${dashGap}; stroke-dashoffset: 0; --path-len: ${Math.round(perimeter)};" />
    `;
  }
  const isRune = nodeType === "DICE_RUNE";
  const circleRadius = isRune ? 42.5 : 47;
  const centerY = isRune ? 4 : 0;
  const perimeter = 2 * Math.PI * circleRadius;
  const dashLength = isRune ? 45 : 50;
  const dashGap = Math.round(perimeter / 2 - dashLength);
  return `
    <circle class="sel-box-base" cx="0" cy="${centerY}" r="${circleRadius}" fill="none" stroke="${colors.base}" />
    <circle class="sel-box-runner" cx="0" cy="${centerY}" r="${circleRadius}" fill="none" stroke="${colors.runner}" style="stroke-dasharray: ${dashLength} ${dashGap} ${dashLength} ${dashGap}; stroke-dashoffset: 0; --path-len: ${Math.round(perimeter)};" />
  `;
}

export class TreeView {
  /**
   * @param {object} dependencies
   * @param {import("../app/store/app_store.js").AppStore} dependencies.store
   * @param {import("../app/usecases/select_node.js").SelectNodeUseCase} dependencies.selectNodeUseCase
   * @param {import("../app/usecases/navigate_viewport.js").NavigateViewportUseCase} dependencies.navigateViewportUseCase
   * @param {HTMLElement} [dependencies.container]
   * @param {SVGElement} [dependencies.svgElement]
   * @param {import("../domain/localization.js").LocalizationService} [dependencies.localization]
   */
  constructor({ store, selectNodeUseCase, navigateViewportUseCase, container, svgElement, localization }) {
    this.store = store;
    this.selectNodeUseCase = selectNodeUseCase;
    this.navigateViewportUseCase = navigateViewportUseCase;
    this.container = container;
    this.svg = svgElement;
    this.localization = localization || null;

    this.nodePositions = new Map();
    this.parsedEdges = [];
    this.edgesMap = new Map();
    this.nodesMap = new Map();
    this._renderedMatchingNodeIds = new Set();
    this._renderedHighlightEdgeKeys = new Set();
    this._specialBadgeOriginals = new Map();
    this._rankBadgeOriginals = new Map();
    this._unsubscribe = null;
    this._initialized = false;
    this._nodePressHandlers = new Map();
    this._suppressNextClick = false;
    this._boundContainerClick = (event) => this._handleClick(event);
    this._boundPointerDown = (event) => {
      // A new pointer gesture starts a fresh click decision. If a drag did
      // not produce a browser click, do not carry suppression into the next
      // intentional node click.
      this._suppressNextClick = false;

      // On compact screens, consume the first outside tap as a close gesture.
      if (typeof window !== "undefined" && window.innerWidth <= 768) {
        const selectedNodeId = this.store?.getState?.()?.selectedNodeId;
        const tooltip = typeof document !== "undefined" ? document.getElementById("tooltip") : null;
        if (selectedNodeId && !tooltip?.contains?.(event?.target)) {
          this._suppressNextClick = true;
          this._dismissSelection();
        }
      }
    };
    this._boundPointerUp = () => {
      if (!this._suppressNextClick) return;
      // Native click dispatch follows pointerup in the same task. Clearing on
      // the next task preserves that suppression while avoiding stale state
      // when a drag ends without producing a click.
      setTimeout(() => {
        this._suppressNextClick = false;
      }, 0);
    };
    this._boundViewportDrag = () => {
      // ViewportController emits this before pointerup once movement crosses
      // the drag threshold. The following synthetic click must not reselect
      // the node under the finger/mouse.
      this._suppressNextClick = true;
    };
  }

  /**
   * Initialize tree view listeners and subscribe to store updates.
   * @param {SVGElement} [svgElement]
   */
  init(svgElement) {
    if (svgElement) {
      this.svg = svgElement;
    }
    if (this._initialized) return;
    this._initialized = true;
    this._setSceneAccessibility();
    if (this.container) {
      this.container.addEventListener("click", this._boundContainerClick);
      this.container.addEventListener("pointerdown", this._boundPointerDown, true);
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("rd2:viewport-drag", this._boundViewportDrag);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("pointerup", this._boundPointerUp);
      window.addEventListener("pointercancel", this._boundPointerUp);
    }
    if (this.svg) {
      this._indexNodes();
      if (this.nodePositions.size > 0) {
        this._indexEdges();
      }
    }
    this._unsubscribe = this.store.subscribe((state, action) => {
      if (action?.type === "UPDATE_VIEWPORT" || action?.type === "SET_VIEWPORT") return;
      this.render(state, action);
    });
    this.render(this.store.getState());
  }

  _setSceneAccessibility() {
    const scene = this.container?.querySelector?.("#scene");
    if (!scene || typeof scene.setAttribute !== "function") return;
    scene.setAttribute("role", "group");
  }

  /** Refresh labels after the active locale changes without rebuilding SVG. */
  refreshLocalizedLabels(localization = this.localization) {
    if (localization) this.localization = localization;
    if (!this.svg) return;
    this._indexNodes();
    this._indexEdges();
    this.render(this.store.getState());
  }

  _ensureSelectionLayer(el, node, colors) {
    if (
      !el
      || typeof document === "undefined"
      || typeof document.createElementNS !== "function"
      || el.querySelector(".node-selection-layer")
    ) return;

    const nType = node?.node_type || node?.type;
    const isBig = Boolean(node?.is_big || el.querySelector("use[href*='sprite-187']"));
    const scaleContainer = el.querySelector("g[transform^='scale']") || el;
    const gSel = document.createElementNS("http://www.w3.org/2000/svg", "g");
    gSel.setAttribute("class", "node-selection-layer");
    gSel.setAttribute("pointer-events", "none");

    gSel.innerHTML = selectionLayerMarkup(nType, isBig, colors);

    const nodeBody = el.querySelector(".node-body");
    if (nodeBody) {
      let insertTarget = null;
      if (nType === "DICE" || nType === "PERK") insertTarget = nodeBody.querySelector("use, image, .dice-shadow");
      else if (isBig || nType === "PLAYER_PASSIVE") insertTarget = nodeBody.firstElementChild?.nextElementSibling;
      if (insertTarget) insertTarget.before(gSel);
      else nodeBody.appendChild(gSel);
    } else {
      scaleContainer.appendChild(gSel);
    }
  }

  _ensureFilterGlow(el, node) {
    if (
      !el
      || typeof document === "undefined"
      || typeof document.createElementNS !== "function"
    ) return;
    const nodeBody = el.querySelector(".node-body");
    if (!nodeBody || nodeBody.querySelector(".node-filter-glow")) return;

    const nType = node?.node_type || node?.type;
    const isBig = Boolean(node?.is_big || el.querySelector("use[href*='sprite-187']"));
    const glowEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      nType === "DICE" || nType === "PERK" ? "rect" : "ellipse",
    );
    glowEl.setAttribute("class", "node-filter-glow");
    glowEl.setAttribute("pointer-events", "none");
    const branchNum = Number(node?.branch || node?.faction || 1) || 1;
    glowEl.setAttribute("fill", `url(#filter-glow-gradient-${branchNum})`);

    if (nType === "DICE") {
      glowEl.setAttribute("x", "-84");
      glowEl.setAttribute("y", "-87");
      glowEl.setAttribute("width", "168");
      glowEl.setAttribute("height", "174");
      glowEl.setAttribute("rx", "28");
      glowEl.setAttribute("ry", "28");
    } else if (nType === "PERK") {
      glowEl.setAttribute("x", "-82");
      glowEl.setAttribute("y", "-52");
      glowEl.setAttribute("width", "164");
      glowEl.setAttribute("height", "104");
      glowEl.setAttribute("rx", "22");
      glowEl.setAttribute("ry", "22");
    } else if (nType === "DICE_RUNE") {
      glowEl.setAttribute("cx", "0");
      glowEl.setAttribute("cy", "4");
      glowEl.setAttribute("rx", "55");
      glowEl.setAttribute("ry", "59");
    } else if (isBig) {
      glowEl.setAttribute("cx", "0");
      glowEl.setAttribute("cy", "0");
      glowEl.setAttribute("rx", "84");
      glowEl.setAttribute("ry", "84");
    } else {
      glowEl.setAttribute("cx", "0");
      glowEl.setAttribute("cy", "0");
      glowEl.setAttribute("rx", "60");
      glowEl.setAttribute("ry", "65");
    }
    nodeBody.insertBefore(glowEl, nodeBody.firstChild);
  }

  _ensureRuneOverlay(el) {
    if (
      !el
      || typeof document === "undefined"
      || typeof document.createElementNS !== "function"
    ) return;
    const nodeBody = el.querySelector(".node-body");
    if (!nodeBody || nodeBody.querySelector(".node-icon-overlay-group")) return;

    const svgRoot = el.ownerSVGElement || this.svg;
    if (!svgRoot || typeof svgRoot.querySelector !== "function") return;
    let defs = svgRoot.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svgRoot.insertBefore(defs, svgRoot.firstChild);
    }
    if (!svgRoot.querySelector("#rune-cylinder-clip")) {
      const clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clip.setAttribute("id", "rune-cylinder-clip");
      clip.innerHTML = `<circle cx="0" cy="-10" r="39.5" />`;
      defs.appendChild(clip);
    }

    const origIcon = nodeBody.querySelector("use.node-icon:not(.node-icon-overlay)");
    if (!origIcon) return;
    const gOverlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
    gOverlay.setAttribute("class", "node-icon-overlay-group");
    gOverlay.setAttribute("clip-path", "url(#rune-cylinder-clip)");
    gOverlay.setAttribute("pointer-events", "none");
    const overlay = origIcon.cloneNode(true);
    overlay.setAttribute("class", "node-icon node-icon-overlay");
    gOverlay.appendChild(overlay);
    nodeBody.appendChild(gOverlay);
  }

  _indexNodes() {
    this._removeNodePressListeners();
    this.nodesMap = new Map();
    this._renderedMatchingNodeIds = new Set();
    if (!this.svg) return;

    const nodeElements = this.svg.querySelectorAll("g.node, .tree-node, [data-node-id]") || [];
    const state = this.store?.getState?.() || {};
    const nodesStoreMap = state.nodesMap || new Map();
    this._ensureFilterGradients();
    this._ensureSimulationOcclusionLayer(nodeElements, nodesStoreMap);
    nodeElements.forEach((element) => this._indexNodeElement(element, state, nodesStoreMap));
    this._indexCenterStats();
  }

  _ensureSimulationOcclusionLayer(nodeElements, nodesStoreMap) {
    const ownerDocument = this.svg?.ownerDocument
      || (typeof document !== "undefined" ? document : null);
    if (!this.svg || !ownerDocument?.createElementNS) return;

    const layer = ensureSimulationOcclusionLayer(this.svg, ownerDocument);
    const existing = collectExistingSimulationOcclusions(layer);
    this.nodeOcclusionMap = new Map();
    const activeIds = this._syncSimulationOcclusionNodes(nodeElements, nodesStoreMap, layer, existing, ownerDocument);
    existing.forEach((element, id) => {
      if (!activeIds.has(id)) element.remove?.();
    });
    this.simulationOcclusionLayer = layer;
  }

  _syncSimulationOcclusionNodes(nodeElements, nodesStoreMap, layer, existing, ownerDocument) {
    const activeIds = new Set();
    for (const nodeElement of nodeElements || []) {
      const id = resolveNodeElementId(nodeElement);
      if (!id) continue;
      const node = nodesStoreMap.get(id);
      const nodeType = String(node?.node_type || node?.type || "").toUpperCase();
      if (!nodeType) continue;

      let occlusion = existing.get(id);
      if (!occlusion) {
        occlusion = this._createSimulationOcclusion(nodeElement, node, id, ownerDocument);
        if (!occlusion) continue;
        layer.appendChild(occlusion);
      }
      occlusion.dataset.occlusionType = nodeType;
      this.nodeOcclusionMap.set(id, occlusion);
      activeIds.add(id);
    }
    return activeIds;
  }

  _createSimulationOcclusion(nodeElement, node, id, ownerDocument) {
    const nodeType = String(node?.node_type || node?.type || "").toUpperCase();
    const occlusion = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
    occlusion.setAttribute("class", "node-simulation-occlusion");
    occlusion.dataset.occlusionFor = String(id);
    occlusion.dataset.occlusionType = nodeType;
    occlusion.setAttribute("pointer-events", "none");

    const nodeTransform = nodeElement.getAttribute?.("transform");
    if (nodeTransform) occlusion.setAttribute("transform", nodeTransform);

    const scaledGroup = Array.from(nodeElement.children || []).find((child) => (
      child.tagName?.toLowerCase?.() === "g"
      && String(child.getAttribute?.("transform") || "").startsWith("scale(")
    ));
    const localGroup = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
    const scaleTransform = scaledGroup?.getAttribute?.("transform");
    if (scaleTransform) localGroup.setAttribute("transform", scaleTransform);

    const shape = this._createSimulationOcclusionShape(nodeElement, node, ownerDocument);
    if (!shape) return null;
    localGroup.appendChild(shape);
    occlusion.appendChild(localGroup);
    return occlusion;
  }

  _createSimulationOcclusionShape(nodeElement, node, ownerDocument) {
    const nodeType = String(node?.node_type || node?.type || "").toUpperCase();
    const nodeBody = nodeElement.querySelector?.(".node-body");

    if (nodeType === "DICE" || nodeType === "PERK") {
      const backingRect = Array.from(nodeBody?.children || []).find((child) => child.tagName?.toLowerCase?.() === "rect");
      if (!backingRect?.cloneNode) return null;
      const shape = backingRect.cloneNode(false);
      shape.setAttribute("class", "node-simulation-occlusion-shape");
      shape.setAttribute("fill", SIMULATION_OCCLUSION_FILL);
      shape.setAttribute("stroke", "none");
      shape.removeAttribute("filter");
      shape.removeAttribute("opacity");
      return shape;
    }

    if (nodeType === "PLAYER_PASSIVE") {
      const isLarge = Boolean(node?.is_big)
        || Boolean(nodeElement.querySelector?.("use[href*='sprite-187']"));
      const shape = ownerDocument.createElementNS(SVG_NAMESPACE, isLarge ? "rect" : "circle");
      shape.setAttribute("class", "node-simulation-occlusion-shape");
      shape.setAttribute("fill", SIMULATION_OCCLUSION_FILL);
      shape.setAttribute("stroke", "none");
      shape.removeAttribute("filter");
      shape.removeAttribute("opacity");
      if (isLarge) {
        shape.setAttribute("x", "-50");
        shape.setAttribute("y", "-50");
        shape.setAttribute("width", "100");
        shape.setAttribute("height", "100");
        shape.setAttribute("rx", "21");
        shape.setAttribute("ry", "21");
        shape.setAttribute("transform", "rotate(45)");
      } else {
        shape.setAttribute("cx", "0");
        shape.setAttribute("cy", "0");
        shape.setAttribute("r", "47");
      }
      return shape;
    }

    if (nodeType === "DICE_RUNE") {
      const shape = ownerDocument.createElementNS(SVG_NAMESPACE, "ellipse");
      shape.setAttribute("class", "node-simulation-occlusion-shape");
      shape.setAttribute("cx", "0");
      shape.setAttribute("cy", "4");
      shape.setAttribute("rx", "42.5");
      shape.setAttribute("ry", "47");
      shape.setAttribute("fill", SIMULATION_OCCLUSION_FILL);
      shape.setAttribute("stroke", "none");
      return shape;
    }

    return null;
  }

  _ensureFilterGradients() {
    if (typeof document === "undefined" || typeof document.createElementNS !== "function" || !this.svg) return;
    let defs = this.svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      this.svg.insertBefore(defs, this.svg.firstChild);
    }
    for (const [branch, color] of Object.entries(BRANCH_GLOW_COLORS)) {
      const gradId = `filter-glow-gradient-${branch}`;
      if (defs.querySelector(`#${gradId}`)) continue;
      const gradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
      gradient.setAttribute("id", gradId);
      gradient.setAttribute("cx", "50%");
      gradient.setAttribute("cy", "50%");
      gradient.setAttribute("r", "50%");
      gradient.innerHTML = `
        <stop offset="35%" stop-color="${color}" stop-opacity="0.88" />
        <stop offset="70%" stop-color="${color}" stop-opacity="0.4" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
      `;
      defs.appendChild(gradient);
    }
  }

  _indexNodeElement(element, state, nodesStoreMap) {
    const id = String(element.dataset?.nodeId || element.id?.replace("node-", "") || "");
    if (!id) return;
    this.nodesMap.set(id, element);
    if (element.classList.contains("is-highlight-match")) this._renderedMatchingNodeIds.add(id);
    this._recordNodePosition(element, id);
    const node = nodesStoreMap.get(id);
    this._setNodeAccessibility(element, id, node, state);
    this._setNodeTypeClasses(element, node);
    this._setNodeFactionColors(element, node);
    this._ensureFilterGlow(element, node);
    if (node?.node_type === "DICE_RUNE" || node?.type === "DICE_RUNE") {
      this._ensureRuneOverlay(element, node);
    }
    this._updateCostBadge(element, node);
    this._updateNodeNameBadge(element, node);
    this._rememberRankBadge(id, element);
    this._bindNodePressHandlers(element, id);
  }

  _recordNodePosition(element, id) {
    if (this.nodePositions.has(id)) return;
    const transform = element.getAttribute?.("transform") || "";
    const match = /translate(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*)/.exec(transform);
    if (!match) return;
    this.nodePositions.set(id, {
      x: Number.parseFloat(match[1]),
      y: Number.parseFloat(match[2])
    });
  }

  _setNodeAccessibility(element, id, node, state) {
    if (typeof element.setAttribute !== "function") return;
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-pressed", String(String(state.selectedNodeId) === id));
    element.setAttribute("aria-label", node?.name_zh || node?.name || `Node ${id}`);
  }

  _setNodeFactionColors(element, node) {
    const branch = Number(node?.branch || node?.faction || 1) || 1;
    const colors = FACTION_SELECTION_COLORS[branch] || FACTION_SELECTION_COLORS[1];
    if (typeof element.style?.setProperty !== "function") return;
    element.style.setProperty("--node-hover-color", colors.base);
    element.style.setProperty("--node-hover-runner", colors.runner);
  }

  _setNodeTypeClasses(element, node) {
    if (typeof element?.classList?.toggle !== "function") return;
    const nodeType = String(node?.node_type || node?.type || "").toUpperCase();
    for (const [type, className] of Object.entries(NODE_TYPE_CLASSES)) {
      element.classList.toggle(className, nodeType === type);
    }

    const isPassive = nodeType === "PLAYER_PASSIVE";
    const isLarge = isPassive && Boolean(node?.is_big);
    element.classList.toggle("node-size-small", isPassive && !isLarge);
    element.classList.toggle("node-size-large", isLarge);
  }

  _updateCostBadge(element, node) {
    const costBadge = element.querySelector(".cost-badge");
    if (!costBadge) return;
    const specialLabel = getUnlockConditionLabel(node);
    const goldCosts = Array.isArray(node?.gold_costs) ? node.gold_costs : [];
    const coreCosts = Array.isArray(node?.core_costs) ? node.core_costs : [];
    const unlockGold = goldCosts[0] ?? node?.unlock_gold ?? 0;
    const unlockCore = coreCosts[0] ?? node?.unlock_core ?? 0;

    if (specialLabel) {
      this._updateSpecialCostBadge(costBadge, specialLabel, unlockGold, unlockCore);
    } else if (unlockGold === 0 && unlockCore === 0) {
      costBadge.style.display = "none";
    } else if (unlockGold > 0 && unlockCore > 0) {
      this._updateDualCostBadge(costBadge, unlockGold, unlockCore);
    } else {
      this._updateSingleCostBadge(costBadge, unlockGold, unlockCore);
    }
  }

  _updateSpecialCostBadge(costBadge, specialLabel, unlockGold, unlockCore) {
    costBadge.style.display = "";
    costBadge.classList.add("is-special-cost-badge");
    const rects = costBadge.querySelectorAll("rect");
    const baseY = Number.parseFloat(rects[0]?.getAttribute("y") || "-84");
    const iconY = baseY + 5;
    const textY = baseY + 19.5;
    if (unlockGold === 0 && unlockCore === 0) {
      this._updateSpecialOnlyBadge(costBadge, specialLabel, rects, textY);
      return;
    }
    this._updateSpecialCurrencyBadge(costBadge, specialLabel, rects, iconY, textY, unlockGold, unlockCore);
  }

  _updateSpecialOnlyBadge(costBadge, specialLabel, rects, textY) {
    costBadge.querySelectorAll("use, image").forEach((node) => node.remove());
    costBadge.querySelectorAll("text.cost-special-label").forEach((node) => node.remove());
    const textWidth = estimateTextWidth(specialLabel, 14.5);
    const badgeWidth = Math.max(76, textWidth + 28);
    const leftX = -badgeWidth / 2;
    this._setBadgeRects(rects, leftX, badgeWidth);
    let valueElement = costBadge.querySelector(".cost-value, text");
    if (!valueElement) {
      valueElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
      valueElement.setAttribute("class", "cost-value");
      costBadge.appendChild(valueElement);
    }
    valueElement.classList.add("is-special-cost-text");
    valueElement.setAttribute("x", "0");
    valueElement.setAttribute("y", String(textY));
    valueElement.setAttribute("text-anchor", "middle");
    valueElement.style?.setProperty("text-anchor", "middle", "important");
    valueElement.style.fill = "#ffd859";
    valueElement.style.fontWeight = "800";
    valueElement.style.fontSize = "14.5px";
    valueElement.textContent = specialLabel;
  }

  _updateSpecialCurrencyBadge(costBadge, specialLabel, rects, iconY, textY, unlockGold, unlockCore) {
    const valueString = String(unlockCore > 0 ? unlockCore : unlockGold);
    const textWidth = estimateTextWidth(specialLabel, 14.5);
    const currencyWidth = 18 + 6 + estimateTextWidth(valueString, 15);
    const badgeWidth = Math.round(14 + textWidth + 12 + currencyWidth + 14);
    const leftX = -badgeWidth / 2;
    this._setBadgeRects(rects, leftX, badgeWidth);
    costBadge.querySelectorAll("text, use, image").forEach((node) => node.remove());

    const labelX = Math.round(leftX + 14);
    const iconX = Math.round(labelX + textWidth + 12);
    const numX = Math.round(iconX + 18 + 6);
    const labelElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    labelElement.setAttribute("class", "cost-special-label");
    labelElement.setAttribute("x", String(labelX));
    labelElement.setAttribute("y", String(textY));
    labelElement.setAttribute("text-anchor", "start");
    labelElement.style.setProperty("text-anchor", "start", "important");
    labelElement.style.fill = "#ffd859";
    labelElement.style.fontWeight = "800";
    labelElement.style.fontSize = "14.5px";
    labelElement.textContent = specialLabel;
    costBadge.appendChild(labelElement);

    const iconUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    iconUse.setAttribute("class", "node-icon");
    iconUse.setAttribute("width", "18");
    iconUse.setAttribute("height", "18");
    iconUse.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const href = unlockCore > 0 ? "#sprite-186" : "#sprite-185";
    iconUse.setAttribute("href", href);
    iconUse.setAttribute("xlink:href", href);
    iconUse.setAttribute("x", String(iconX));
    iconUse.setAttribute("y", String(iconY));
    costBadge.appendChild(iconUse);

    const valueElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    valueElement.setAttribute("class", "cost-value");
    valueElement.setAttribute("x", String(numX));
    valueElement.setAttribute("y", String(textY));
    valueElement.setAttribute("text-anchor", "start");
    valueElement.style.setProperty("text-anchor", "start", "important");
    valueElement.style.fill = "#ffffff";
    valueElement.style.fontWeight = "700";
    valueElement.style.fontSize = "15px";
    valueElement.textContent = valueString;
    costBadge.appendChild(valueElement);
  }

  _setBadgeRects(rects, leftX, badgeWidth) {
    if (rects[0]) {
      rects[0].setAttribute("x", String(leftX));
      rects[0].setAttribute("width", String(badgeWidth));
    }
    if (rects[1]) {
      rects[1].setAttribute("x", String(leftX + 1.5));
      rects[1].setAttribute("width", String(badgeWidth - 3));
    }
  }

  _updateDualCostBadge(costBadge, unlockGold, unlockCore) {
    costBadge.style.display = "";
    const iconUses = costBadge.querySelectorAll("use.node-icon, use");
    const valueTexts = costBadge.querySelectorAll(".cost-value, text");
    this._setCurrencyIcon(iconUses[0], "#sprite-185");
    if (valueTexts[0]) valueTexts[0].textContent = unlockGold.toLocaleString();
    this._setCurrencyIcon(iconUses[1], "#sprite-186");
    if (valueTexts[1]) valueTexts[1].textContent = unlockCore.toLocaleString();
  }

  _updateSingleCostBadge(costBadge, unlockGold, unlockCore) {
    costBadge.style.display = "";
    const iconUse = costBadge.querySelector("use.node-icon, use");
    const href = unlockCore > 0 ? "#sprite-186" : "#sprite-185";
    this._setCurrencyIcon(iconUse, href);
    const valueElement = costBadge.querySelector(".cost-value, text");
    if (!valueElement) return;
    const value = unlockCore > 0 ? unlockCore : unlockGold;
    valueElement.textContent = value.toLocaleString();
  }

  _setCurrencyIcon(iconUse, href) {
    if (!iconUse) return;
    iconUse.setAttribute("href", href);
    iconUse.setAttribute("xlink:href", href);
  }

  _updateNodeNameBadge(element, node) {
    const isRune = node?.node_type === "DICE_RUNE" || node?.type === "DICE_RUNE";
    const nodeName = node?.name_zh || node?.name;
    if (isRune || !nodeName) return;

    const textWidth = estimateTextWidth(nodeName, 14.5);
    const badgeWidth = Math.max(76, Math.round(textWidth + 28));
    const leftX = -badgeWidth / 2;
    const isLarge = node?.node_type === "DICE"
      || node?.type === "DICE"
      || node?.node_type === "PERK"
      || node?.is_big;
    const baseY = isLarge ? -92 : -84;
    const textY = baseY + 19.5;
    let nameBadge = element.querySelector?.(".node-name-badge");
    if (!nameBadge && typeof document !== "undefined" && typeof document.createElementNS === "function") {
      nameBadge = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nameBadge.setAttribute("class", "node-name-badge");
      nameBadge.setAttribute("pointer-events", "none");
      nameBadge.innerHTML = `
        <rect x="${leftX}" y="${baseY}" width="${badgeWidth}" height="28" rx="14" fill="#1b1528" stroke="#5a3fa2" stroke-width="2" opacity="0.94" filter="url(#badge-shadow)"></rect>
        <rect x="${leftX + 1.5}" y="${baseY + 1.5}" width="${badgeWidth - 3}" height="25" rx="12.5" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"></rect>
        <text class="node-name-badge-text" x="0" y="${textY}" text-anchor="middle" fill="#ffffff" font-size="14.5px" font-weight="800" font-family="'Noto Sans TC','Microsoft JhengHei UI',sans-serif" style="text-anchor:middle!important;">${escapeHtml(nodeName)}</text>
      `;
      element.appendChild(nameBadge);
    } else if (nameBadge) {
      const rects = nameBadge.querySelectorAll?.("rect") || [];
      const outerRect = rects[0];
      const innerRect = rects[1];
      outerRect?.setAttribute?.("x", String(leftX));
      outerRect?.setAttribute?.("y", String(baseY));
      outerRect?.setAttribute?.("width", String(badgeWidth));
      innerRect?.setAttribute?.("x", String(leftX + 1.5));
      innerRect?.setAttribute?.("y", String(baseY + 1.5));
      innerRect?.setAttribute?.("width", String(badgeWidth - 3));
      const text = nameBadge.querySelector?.(".node-name-badge-text");
      if (text) {
        text.textContent = nodeName;
        text.setAttribute?.("y", String(textY));
      }
    }
  }

  _rememberRankBadge(id, element) {
    const rankBadge = element.querySelector(".rank-badge .rank-value, .rank-badge text");
    if (rankBadge) this._rankBadgeOriginals.set(id, rankBadge.textContent);
  }

  _bindNodePressHandlers(element, id) {
    if (typeof element.addEventListener !== "function") return;
    const pointerdown = () => element.classList.add("is-pressing");
    const endPress = () => element.classList.remove("is-pressing");
    const keydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault?.();
      event.stopPropagation?.();
      this._selectNode(id);
    };
    element.addEventListener("pointerdown", pointerdown);
    element.addEventListener("pointerup", endPress);
    element.addEventListener("pointercancel", endPress);
    element.addEventListener("pointerleave", endPress);
    element.addEventListener("keydown", keydown);
    this._nodePressHandlers.set(element, { pointerdown, endPress, keydown });
  }

  _indexCenterStats() {
    this._centerStatEls = new Map();
    const centerStats = this.svg?.querySelectorAll?.(".tree-center-stat-value") || [];
    centerStats.forEach((element) => {
      const fill = (element.getAttribute("style") || element.getAttribute("fill") || "").toLowerCase();
      const color = Object.keys(CENTER_STAT_BRANCH_BY_COLOR).find((candidate) => fill.includes(candidate));
      const branch = color ? CENTER_STAT_BRANCH_BY_COLOR[color] : 0;
      if (branch) this._centerStatEls.set(branch, element);
    });
    const centerNames = this.svg?.querySelectorAll?.(".tree-center-stat-name") || [];
    centerNames.forEach((element, index) => {
      const key = `faction.${index + 1}`;
      if (this.localization?.t) element.textContent = this.localization.t(key, {}, element.textContent || key);
    });
    const normalTitle = this.svg?.querySelector?.(".compendium-core-compact-title.normal-title");
    const simulationTitle = this.svg?.querySelector?.(".compendium-core-compact-title.simulation-title");
    if (normalTitle && this.localization?.t) normalTitle.textContent = this.localization.t("compendium.centerTitle", {}, normalTitle.textContent || "Compendium");
    if (simulationTitle && this.localization?.t) simulationTitle.textContent = this.localization.t("compendium.simulationCenterTitle", {}, simulationTitle.textContent || "Dice tree");
  }

  _removeNodePressListeners() {
    for (const [element, handlers] of this._nodePressHandlers) {
      element.removeEventListener?.("pointerdown", handlers.pointerdown);
      element.removeEventListener?.("pointerup", handlers.endPress);
      element.removeEventListener?.("pointercancel", handlers.endPress);
      element.removeEventListener?.("pointerleave", handlers.endPress);
      element.removeEventListener?.("keydown", handlers.keydown);
    }
    this._nodePressHandlers.clear();
  }

  /**
   * Record pre-calculated node positions.
   * @param {Map<string, { x: number, y: number }>} positions
   */
  setNodePositions(positions) {
    this.nodePositions = positions;
    if (this.svg) {
      this._indexEdges();
    }
  }

  /**
   * Pre-index all edge paths in the SVG to link them to their start and end nodes.
   */
  _indexEdges() {
    if (!this.svg) return;
    this.parsedEdges = [];
    this.edgesMap = new Map();
    this._renderedHighlightEdgeKeys = new Set();
    const edgePaths = this.svg.querySelectorAll("path.edge, .edge, .tree-edge, [data-edge-key]") || [];
    edgePaths.forEach((pathEl) => this._indexEdgePath(pathEl));
    this.cachedCenterLinks = Array.from(this.svg.querySelectorAll("path.tree-center-link")).map((element) => ({
      el: element,
      branch: this._centerLinkBranch(element)
    }));
    this.cachedBranchMarks = Array.from(this.svg.querySelectorAll(".tree-center [data-branch]")).map((element) => ({
      el: element,
      branch: Number(element.dataset?.branch)
    }));
  }

  _indexEdgePath(pathElement) {
    const endpoints = this._resolveEdgeEndpoints(pathElement);
    if (!endpoints.startNodeId || !endpoints.endNodeId) return;
    const { startNodeId, endNodeId } = endpoints;
    const key = `${startNodeId}->${endNodeId}`;
    if (pathElement.dataset) {
      pathElement.dataset.edgeKey = key;
      pathElement.dataset.startNodeId = startNodeId;
      pathElement.dataset.endNodeId = endNodeId;
    }
    this.parsedEdges.push({ element: pathElement, startId: String(startNodeId), endId: String(endNodeId), key });
    this.edgesMap.set(key, pathElement);
    if (pathElement.classList.contains("is-highlight-edge")) this._renderedHighlightEdgeKeys.add(key);
  }

  _resolveEdgeEndpoints(pathElement) {
    let startNodeId = pathElement.dataset?.startNodeId;
    let endNodeId = pathElement.dataset?.endNodeId;
    if (startNodeId && endNodeId) return { startNodeId, endNodeId };
    const match = /M\s+([\d.-]+)\s+([\d.-]+)\s+L\s+([\d.-]+)\s+([\d.-]+)/.exec(pathElement.getAttribute?.("d") || "");
    if (!match) return { startNodeId, endNodeId };
    const points = [
      { x: Number.parseFloat(match[1]), y: Number.parseFloat(match[2]) },
      { x: Number.parseFloat(match[3]), y: Number.parseFloat(match[4]) }
    ];
    for (const [id, point] of this.nodePositions) {
      if (!startNodeId && Math.hypot(point.x - points[0].x, point.y - points[0].y) < 14) startNodeId = id;
      if (!endNodeId && Math.hypot(point.x - points[1].x, point.y - points[1].y) < 14) endNodeId = id;
      if (startNodeId && endNodeId) break;
    }
    return { startNodeId, endNodeId };
  }

  _centerLinkBranch(element) {
    const path = element.getAttribute("d") || "";
    const branches = ["1460.00", "1840.00", "2160.00", "1720.00", "2280.00"];
    const index = branches.findIndex((marker) => path.includes(marker));
    return index < 0 ? 0 : index + 1;
  }

  _handleClick(e) {
    if (this._suppressNextClick) {
      this._suppressNextClick = false;
      return;
    }

    const nodeEl = e.target.closest("g.node, .tree-node, [data-node-id]");
    if (!nodeEl) {
      // Clicked on background
      if (e.target.closest("svg") || e.target === this.container || e.target.id === "viewport" || e.target.id === "scene") {
        this._dismissSelection();
      }
      return;
    }

    const nodeId = nodeEl.dataset?.nodeId || nodeEl.id?.replace("node-", "");
    if (nodeId) {
      this._selectNode(nodeId);
    }
  }

  _dismissSelection() {
    const state = this.store?.getState?.() || {};
    this.selectNodeUseCase?.deselect?.({
      resetPrereqMode: !state.selectedNodeId && Boolean(state.showPrereqMode)
    });
  }

  _selectNode(nodeId) {
    const pos = this.nodePositions.get(String(nodeId));
    this.selectNodeUseCase.execute(nodeId, {
      point: pos,
      nodePositions: this.nodePositions
    });

    this.navigateViewportUseCase?.centerOnNodeForTooltip(nodeId, false);
  }

  _syncHighlightClasses(nextMatchingNodeIds, nextHighlightEdgeKeys) {
    for (const nodeId of this._renderedMatchingNodeIds) {
      if (!nextMatchingNodeIds.has(nodeId)) {
        this.nodesMap.get(nodeId)?.classList.remove("is-highlight-match");
      }
    }
    for (const nodeId of nextMatchingNodeIds) {
      if (!this._renderedMatchingNodeIds.has(nodeId)) {
        this.nodesMap.get(nodeId)?.classList.add("is-highlight-match");
      }
    }
    this._renderedMatchingNodeIds = new Set(nextMatchingNodeIds);

    for (const edgeKey of this._renderedHighlightEdgeKeys) {
      if (!nextHighlightEdgeKeys.has(edgeKey)) {
        this.edgesMap.get(edgeKey)?.classList.remove("is-highlight-edge");
      }
    }
    for (const edgeKey of nextHighlightEdgeKeys) {
      if (!this._renderedHighlightEdgeKeys.has(edgeKey)) {
        this.edgesMap.get(edgeKey)?.classList.add("is-highlight-edge");
      }
    }
    this._renderedHighlightEdgeKeys = new Set(nextHighlightEdgeKeys);
  }

  /**
   * Render or update node classes based on active store state.
   * @param {object} state
   * @param {object|null} [action]
   */
  render(state, action = null) {
    if (!this.svg) return;
    const context = this._createRenderContext(state, action);
    const linkedSelectedIds = this._collectLinkedSelectedIds(context.selectedNodeId, context.nodesMap);
    this._ensureSelectionLayers(context.selectedNodeId, linkedSelectedIds, context.nodesMap);
    this._updateBodyClasses(context);
    if (!context.isFilterOnlyUpdate) {
      this._updateNodeStates(context, linkedSelectedIds);
      this._updateEdgeStates(context);
      this._updateCenterFactionLevels(context.isSimulation, context.simulation, context.nodesMap);
    }
    this._updateCenterLinks(context);
    this._updateCenterBranchMarks(context.activeBranches);
  }

  _createRenderContext(state, action) {
    const isFilterOnlyUpdate = FILTER_ACTION_TYPES.has(action?.type);
    const {
      selectedNodeId,
      activePrereqIds,
      activeEdgeIds,
      matchingNodeIds,
      filters,
      showPrereqMode,
      nodesMap
    } = state;
    const simulation = state.simulation || { active: false, ranks: {} };
    const hasSearch = Boolean(filters?.search);
    const hasFactionFilter = Boolean(filters?.factions?.size > 0);
    const hasTypeFilter = Boolean(filters?.nodeTypes?.size > 0);
    const hasAnyFilter = hasFactionFilter || hasTypeFilter;
    const hasFilter = hasAnyFilter || hasSearch;
    const activeBranches = this._collectActiveBranches({
      filters,
      selectedNodeId,
      nodesMap,
      isFilterOnlyUpdate,
      hasFilter,
      matchingNodeIds
    });
    const filterActivePathNodeIds = this._computeFilterActivePath({
      hasFilter,
      matchingNodeIds,
      nodesMap,
      activeBranches
    });
    const nextMatchingNodeIds = hasFilter ? new Set(matchingNodeIds || []) : new Set();
    const nextHighlightEdgeKeys = this._computeFilterEdgeKeys(hasFilter, filterActivePathNodeIds);
    this._syncHighlightClasses(nextMatchingNodeIds, nextHighlightEdgeKeys);
    return {
      isFilterOnlyUpdate,
      selectedNodeId,
      activePrereqIds,
      activeEdgeIds,
      matchingNodeIds,
      filters,
      showPrereqMode,
      nodesMap,
      simulation,
      isSimulation: Boolean(simulation.active),
      hasSearch,
      hasFactionFilter,
      hasTypeFilter,
      hasAnyFilter,
      hasFilter,
      hasSelection: Boolean(selectedNodeId),
      hasPrereqHighlight: Boolean(showPrereqMode && activePrereqIds?.size > 0),
      activeBranches
    };
  }

  _collectActiveBranches({ filters, selectedNodeId, nodesMap, isFilterOnlyUpdate, hasFilter, matchingNodeIds }) {
    const activeBranches = new Set();
    filters?.factions?.forEach((faction) => activeBranches.add(Number(faction)));
    if (!isFilterOnlyUpdate && selectedNodeId && nodesMap) {
      const selectedNode = nodesMap.get(String(selectedNodeId));
      if (selectedNode) activeBranches.add(Number(selectedNode.branch || selectedNode.faction));
    }
    if (hasFilter && matchingNodeIds?.size > 0 && nodesMap) {
      const upstream = computeUpstreamTopologyPath(matchingNodeIds, nodesMap);
      upstream.activeBranches.forEach((branch) => activeBranches.add(branch));
    }
    return activeBranches;
  }

  _computeFilterActivePath({ hasFilter, matchingNodeIds, nodesMap }) {
    if (!hasFilter || !matchingNodeIds?.size || !nodesMap) return matchingNodeIds || new Set();
    return computeUpstreamTopologyPath(matchingNodeIds, nodesMap).activePathNodeIds;
  }

  _computeFilterEdgeKeys(hasFilter, filterActivePathNodeIds) {
    const keys = new Set();
    if (!hasFilter) return keys;
    for (const { key, startId, endId } of this.parsedEdges) {
      if (filterActivePathNodeIds.has(startId) && filterActivePathNodeIds.has(endId)) keys.add(key);
    }
    return keys;
  }

  _collectLinkedSelectedIds(selectedNodeId, nodesMap) {
    const linkedSelectedIds = new Set();
    if (!selectedNodeId || !nodesMap) return linkedSelectedIds;
    const selectedNode = nodesMap.get(String(selectedNodeId));
    const diceName = selectedNode?.dice_type || selectedNode?.rune_dice;
    if (!diceName) return linkedSelectedIds;
    nodesMap.forEach((node) => {
      if (String(node.id) === String(selectedNodeId)) return;
      const nodeType = node.node_type || node.type;
      const nodeDice = node.dice_type || node.rune_dice;
      if (nodeType === "DICE_RUNE" && (nodeDice === diceName || node.rune_dice === diceName)) {
        linkedSelectedIds.add(String(node.id));
      }
    });
    return linkedSelectedIds;
  }

  _ensureSelectionLayers(selectedNodeId, linkedSelectedIds, nodesMap) {
    const ids = new Set(linkedSelectedIds);
    if (selectedNodeId) ids.add(selectedNodeId);
    ids.forEach((nodeId) => {
      const id = String(nodeId);
      const node = nodesMap?.get(id);
      const element = this.nodesMap.get(id);
      if (!node || !element) return;
      const branch = Number(node.branch || node.faction || 1) || 1;
      const colors = FACTION_SELECTION_COLORS[branch] || FACTION_SELECTION_COLORS[1];
      this._ensureSelectionLayer(element, node, colors);
    });
  }

  _updateBodyClasses(context) {
    if (typeof document === "undefined" || !document.body) return;
    const {
      hasAnyFilter,
      hasSearch,
      hasPrereqHighlight,
      isSimulation,
      hasFactionFilter,
      filters,
      selectedNodeId,
      nodesMap
    } = context;
    document.body.classList.toggle("has-active-filter", hasAnyFilter);
    document.body.classList.toggle("has-search-active", hasSearch);
    document.body.classList.toggle("has-prereq-highlight", hasPrereqHighlight);
    document.body.classList.toggle("simulation-mode", isSimulation);
    const targetNode = selectedNodeId ? nodesMap?.get(String(selectedNodeId)) : null;
    const targetBranch = targetNode ? Number(targetNode.branch || targetNode.faction) : 0;
    const shouldOverrideFilter = !hasFactionFilter || filters?.factions?.has(targetBranch);
    document.body.classList.toggle("prereq-overrides-filter", Boolean(hasPrereqHighlight && shouldOverrideFilter));
  }

  _updateNodeStates(context, linkedSelectedIds) {
    this.nodesMap.forEach((element, nodeId) => {
      const isSelected = String(context.selectedNodeId) === String(nodeId);
      const isLinkedSelected = linkedSelectedIds.has(String(nodeId));
      const isPrereq = context.activePrereqIds ? context.activePrereqIds.has(nodeId) : false;
      const isMatching = context.matchingNodeIds ? context.matchingNodeIds.has(nodeId) : true;
      const isDimmed = this._isNodeDimmed(context, isPrereq, isLinkedSelected, isMatching);
      element.classList.toggle("is-selected", isSelected);
      element.setAttribute?.("aria-pressed", String(isSelected));
      element.classList.toggle("is-linked-selected", isLinkedSelected);
      element.classList.toggle("is-prereq-active", isPrereq);
      element.classList.toggle("is-prereq-target", isSelected);
      element.classList.toggle("is-active-path", isPrereq && !isSelected);
      const simulationView = context.isSimulation
        ? getSimulationNodeView(nodeId, context.simulation, context.nodesMap)
        : null;
      this._renderSimulationBadges(element, nodeId, simulationView, context.isSimulation);
      this._updateNodeSimulationClasses(element, simulationView, context);
      this._updateNodeOcclusionClasses(nodeId, simulationView, context, isSelected, isLinkedSelected);
      element.classList.toggle("is-dimmed", isDimmed);
    });
  }

  _isNodeDimmed(context, isPrereq, isLinkedSelected, isMatching) {
    if (context.isSimulation) return false;
    if (context.hasSelection) return !isPrereq && !isLinkedSelected;
    if (context.hasFilter) return !isMatching;
    return false;
  }

  _updateNodeSimulationClasses(element, simulationView, context) {
    if (!context.isSimulation) {
      element.classList.remove("is-sim-unlocked", "is-sim-special", "is-sim-locked", "is-sim-visible");
      return;
    }
    element.classList.toggle("is-sim-unlocked", Boolean(simulationView?.isUnlocked));
    element.classList.toggle("is-sim-special", Boolean(simulationView?.isSpecial));
    element.classList.toggle("is-sim-locked", Boolean(simulationView?.isLocked));
    element.classList.toggle("is-sim-visible", Boolean(simulationView?.isVisible));
  }

  _updateNodeOcclusionClasses(nodeId, simulationView, context, isSelected, isLinkedSelected) {
    const element = this.nodeOcclusionMap?.get(String(nodeId));
    if (!element) return;
    const isSimulation = Boolean(context.isSimulation);
    element.classList.toggle("is-sim-locked", isSimulation && Boolean(simulationView?.isLocked));
    element.classList.toggle("is-sim-special", isSimulation && Boolean(simulationView?.isSpecial));
    element.classList.toggle("is-selected", Boolean(isSelected));
    element.classList.toggle("is-linked-selected", Boolean(isLinkedSelected));
  }

  _updateEdgeStates(context) {
    const activePathNodeIds = context.activePrereqIds || new Set();
    this.parsedEdges.forEach((edge) => this._updateEdgeState(edge, activePathNodeIds, context));
  }

  _updateEdgeState(edge, activePathNodeIds, context) {
    const { element, startId, endId, key } = edge;
    const isPrereqConnected = activePathNodeIds.has(startId) && activePathNodeIds.has(endId);
    const isExplicitActive = context.activeEdgeIds ? context.activeEdgeIds.has(key) : false;
    const isActive = isPrereqConnected || isExplicitActive;
    element.classList.toggle("is-active-edge", Boolean(isActive));
    element.classList.toggle("is-prereq-edge", Boolean(isActive));
    element.classList.toggle("is-edge-active", Boolean(isActive));
    element.classList.toggle("is-dimmed-edge", context.hasSelection && !isActive);
    element.classList.toggle("is-dimmed", context.hasSelection && !isActive);
    this._updateEdgeSimulationClasses(element, startId, endId, context);
  }

  _updateEdgeSimulationClasses(element, startId, endId, context) {
    if (!context.isSimulation) {
      element.classList.remove("is-simulation-active-edge", "is-simulation-locked-edge");
      return;
    }
    const startView = getSimulationNodeView(startId, context.simulation, context.nodesMap);
    const endView = getSimulationNodeView(endId, context.simulation, context.nodesMap);
    const simulationActive = Boolean(startView.isVisible && endView.isVisible);
    element.classList.toggle("is-simulation-active-edge", simulationActive);
    element.classList.toggle("is-simulation-locked-edge", !simulationActive);
  }

  _updateCenterLinks(context) {
    this.cachedCenterLinks?.forEach(({ el, branch }) => {
      const isBranchActive = context.activeBranches.has(branch);
      el.classList.toggle("is-highlight-edge", Boolean(context.hasFilter && isBranchActive));
      if (!context.isFilterOnlyUpdate) {
        el.classList.toggle("is-prereq-edge", Boolean(context.hasPrereqHighlight && isBranchActive));
      }
    });
  }

  _updateCenterBranchMarks(activeBranches) {
    this.cachedBranchMarks?.forEach(({ el, branch }) => {
      el.classList.toggle("is-branch-active", activeBranches.has(branch));
    });
  }

  _updateCenterFactionLevels(isSimulation, simulation, nodesMap) {
    if (!this._centerStatEls || this._centerStatEls.size === 0) return;
    const ranks = isSimulation ? simulation?.ranks : null;
    const levels = calculateAllFactionLevels({ ranks, nodes: nodesMap });
    for (let b = 1; b <= 5; b++) {
      const el = this._centerStatEls.get(b);
      if (el) {
        el.textContent = String(levels[b] ?? 0);
      }
    }
  }

  _renderSimulationBadges(element, nodeId, simulationView, active) {
    const id = String(nodeId);
    const rankText = element.querySelector(".rank-badge .rank-value, .rank-badge text");
    const originalRank = this._rankBadgeOriginals.get(id);
    if (active && rankText && simulationView?.node) {
      rankText.textContent = `${simulationView.rank}/${simulationView.maxRank}`;
    } else if (!active && rankText && originalRank !== undefined) {
      rankText.textContent = originalRank;
    }
  }

  /**
   * Destroy listeners and unsubscribe from store.
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.container?.removeEventListener?.("click", this._boundContainerClick);
    this.container?.removeEventListener?.("pointerdown", this._boundPointerDown, true);
    if (typeof document !== "undefined") {
      document.removeEventListener?.("rd2:viewport-drag", this._boundViewportDrag);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener?.("pointerup", this._boundPointerUp);
      window.removeEventListener?.("pointercancel", this._boundPointerUp);
    }
    this._removeNodePressListeners();
    this._suppressNextClick = false;
    this._initialized = false;
  }
}
