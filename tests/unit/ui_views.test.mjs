import test from "node:test";
import assert from "node:assert/strict";

import { AppStore } from "../../src/app/store/app_store.js";
import { SelectNodeUseCase } from "../../src/app/usecases/select_node.js";
import { FilterTreeUseCase } from "../../src/app/usecases/filter_tree.js";
import { NavigateViewportUseCase } from "../../src/app/usecases/navigate_viewport.js";
import { SyncGolemRankUseCase } from "../../src/app/usecases/sync_golem_rank.js";

import {
  TreeView,
  TooltipView,
  CompendiumView,
  MinimapView,
  ControlsView,
  MorphingWidgets
} from "../../src/ui/index.js";
import { attachElasticSlider } from "../../src/ui/compendium_utils.js";

// Minimal DOM Element Mock for Unit Testing
function createMockElement(tagName = "div", attrs = {}) {
  const listeners = new Map();
  const classes = new Set();
  const children = [];
  const attributes = { ...attrs };
  let value = "";
  let innerHTML = "";
  let textContent = "";

  const element = {
    tagName: tagName.toUpperCase(),
    dataset: {},
    style: {},
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        let result;
        if (force !== undefined) {
          if (force) { classes.add(c); result = true; }
          else { classes.delete(c); result = false; }
        } else {
          if (classes.has(c)) { classes.delete(c); result = false; }
          else { classes.add(c); result = true; }
        }
        return result;
      },
      contains: (c) => classes.has(c),
      has: (c) => classes.has(c)
    },
    getAttribute: (name) => attributes[name] || null,
    setAttribute: (name, val) => { attributes[name] = String(val); },
    removeAttribute: (name) => { delete attributes[name]; },
    addEventListener: (type, cb) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(cb);
    },
    removeEventListener: (type, cb) => {
      listeners.set(type, (listeners.get(type) || []).filter((listener) => listener !== cb));
    },
    dispatchEvent: (type, event = {}) => {
      const cbs = listeners.get(type) || [];
      const ev = { target: element, currentTarget: element, clientX: 0, clientY: 0, ...event };
      cbs.forEach((cb) => cb(ev));
    },
    listenerCount: (type) => (listeners.get(type) || []).length,
    appendChild: (child) => {
      children.push(child);
      child.parentNode = element;
    },
    removeChild: (child) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentNode = null;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 340 }),
    querySelector: (selector) => {
      const parts = selector.split(",").map((s) => s.trim());
      return children.find((c) => {
        return parts.some((sel) => {
          if (sel.startsWith(".") && c.classList.has(sel.slice(1))) return true;
          if (sel.startsWith("#") && c.id === sel.slice(1)) return true;
          if (sel === c.tagName.toLowerCase()) return true;
          return false;
        });
      }) || null;
    },
    querySelectorAll: (selector) => {
      const parts = selector.split(",").map((s) => s.trim());
      return children.filter((c) => {
        return parts.some((sel) => {
          if (sel.startsWith(".") && c.classList.has(sel.slice(1))) return true;
          if (sel.startsWith("#") && c.id === sel.slice(1)) return true;
          if (sel.startsWith("[data-") && c.dataset) {
            const attr = sel.slice(6, -1);
            const camel = attr.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            return c.dataset[camel] !== undefined || c.dataset[attr] !== undefined;
          }
          return false;
        });
      });
    },
    closest: (selector) => {
      if (selector.includes("tree-node") && element.classList.has("tree-node")) return element;
      if (selector.includes("filter-toggle-btn") && element.classList.has("filter-toggle-btn")) return element;
      return null;
    },
    matches: (selector) => selector.includes(element.tagName.toLowerCase())
  };

  Object.defineProperty(element, "value", {
    get: () => value,
    set: (v) => { value = v; }
  });
  Object.defineProperty(element, "innerHTML", {
    get: () => innerHTML,
    set: (v) => { innerHTML = v; }
  });
  Object.defineProperty(element, "textContent", {
    get: () => textContent,
    set: (v) => { textContent = v; }
  });

  return element;
}

test("TreeView: delegates Canvas rendering and semantic button selection", () => {
  const store = new AppStore();
  const selectNodeUseCase = new SelectNodeUseCase({ store });
  const navigateViewportUseCase = new NavigateViewportUseCase({ store, viewportController: { pan(){}, zoom(){}, centerOn(){} } });
  const interactionOrder = [];
  const originalCenterOnNodeForTooltip = navigateViewportUseCase.centerOnNodeForTooltip.bind(navigateViewportUseCase);
  navigateViewportUseCase.centerOnNodeForTooltip = (...args) => {
    interactionOrder.push("center");
    return originalCenterOnNodeForTooltip(...args);
  };

  const container = createMockElement("div");
  const scene = createMockElement("div");
  scene.classList.add("map-scene");
  container.appendChild(scene);

  const node1 = createMockElement("button", { id: "node-101" });
  node1.classList.add("tree-node-semantic", "tree-node");
  node1.dataset.nodeId = "101";
  const node2 = createMockElement("button", { id: "node-102" });
  node2.classList.add("tree-node-semantic", "tree-node");
  node2.dataset.nodeId = "102";
  container.appendChild(node1);
  container.appendChild(node2);

  store.dispatch({
    type: "SET_GAME_DATA",
    payload: {
      nodes: [
        { id: "101", name: "風骰子", node_type: "DICE", next_nodes: ["102"] },
        { id: "102", name: "狂風骰子", node_type: "PLAYER_PASSIVE", is_big: true, incoming: ["101"] }
      ],
      edges: [{ source: "101", target: "102" }]
    }
  });

  const renderActions = [];
  const renderer = {
    render: (_state, action) => {
      renderActions.push(action?.type || null);
      if (action?.type === "SELECT_NODE") interactionOrder.push("render");
    },
    pauseBackgroundRenders: () => interactionOrder.push("pause"),
    refreshLocalizedLabels: () => {},
    destroy: () => {}
  };
  const treeView = new TreeView({
    store,
    selectNodeUseCase,
    navigateViewportUseCase,
    container,
    mapScene: scene,
    renderer
  });
  treeView.init();
  treeView.init();
  assert.equal(container.listenerCount("click"), 1);
  assert.deepEqual(renderActions, [null]);

  store.dispatch({ type: "UPDATE_VIEWPORT", payload: { x: 20, y: 10, scale: 0.8 } });
  assert.equal(renderActions.at(-1), "UPDATE_VIEWPORT");

  container.dispatchEvent("click", { target: node1 });
  assert.equal(store.getState().selectedNodeId, "101");
  assert.deepEqual(interactionOrder, ["pause", "render", "center"],
    "A semantic click must commit the Canvas state before starting tooltip camera navigation");

  // Select node 102
  selectNodeUseCase.execute("102");
  treeView.render(store.getState());
  assert.equal(renderActions.at(-1), null);
  assert.equal(treeView.nodesMap.get("101").name, "風骰子");

  treeView.destroy();
  assert.equal(container.listenerCount("click"), 0);
  treeView.destroy();
});

test("MinimapView: init is idempotent and destroy removes click listener", () => {
  const minimapEl = createMockElement("div");
  const windowEl = createMockElement("div");
  const unsubscribe = () => { unsubscribe.called = true; };
  const view = new MinimapView({
    store: { subscribe: () => unsubscribe },
    navigateViewportUseCase: {},
    minimapElement: minimapEl,
    windowElement: windowEl
  });

  view.init();
  view.init();
  assert.equal(minimapEl.listenerCount("click"), 1);
  view.destroy();
  assert.equal(minimapEl.listenerCount("click"), 0);
  assert.equal(unsubscribe.called, true);
  view.destroy();
  assert.equal(minimapEl.listenerCount("click"), 0);
});

test("MinimapView: renders only the initial and viewport states", () => {
  let subscriber = null;
  const view = new MinimapView({
    store: {
      subscribe(callback) {
        subscriber = callback;
        return () => {};
      },
      getState() {
        return { viewport: { x: 0, y: 0, scale: 1 } };
      }
    },
    navigateViewportUseCase: {},
    minimapElement: null,
    windowElement: createMockElement("div")
  });
  let renderCount = 0;
  view.render = () => {
    renderCount += 1;
  };

  view.init();
  assert.equal(renderCount, 1);
  subscriber({ viewport: { x: 0, y: 0, scale: 1 } }, { type: "SET_FILTER" });
  assert.equal(renderCount, 1);
  subscriber({ viewport: { x: 10, y: 20, scale: 0.8 } }, { type: "UPDATE_VIEWPORT" });
  assert.equal(renderCount, 2);
});

test("MinimapView: moves the viewport marker with a transform", () => {
  const windowEl = createMockElement("div");
  const view = new MinimapView({
    store: {},
    navigateViewportUseCase: {},
    minimapElement: null,
    windowElement: windowEl,
    mapWidth: 100,
    mapHeight: 100
  });
  view._cachedVpWidth = 100;
  view._cachedVpHeight = 100;

  view.render({ viewport: { x: 10, y: 20, scale: 1 } });

  assert.equal(windowEl.style.left, undefined);
  assert.equal(windowEl.style.top, undefined);
  assert.equal(windowEl.style.width, undefined);
  assert.equal(windowEl.style.height, undefined);
  assert.equal(windowEl.style.transform, "translate3d(-10%, -20%, 0) scale(1, 1)");
});

test("TooltipView: Renders tooltip and smart avoidance class", () => {
  const store = new AppStore();
  const selectNodeUseCase = new SelectNodeUseCase({ store });

  const tooltipEl = createMockElement("div");
  const titleEl = createMockElement("span");
  titleEl.classList.add("tooltip-title");
  tooltipEl.appendChild(titleEl);

  const descEl = createMockElement("div");
  descEl.classList.add("tooltip-desc");
  tooltipEl.appendChild(descEl);

  const nodePositions = new Map([
    ["101", { x: 500, y: 200 }],
    ["102", { x: 500, y: 500 }]
  ]);

  store.dispatch({
    type: "SET_GAME_DATA",
    payload: {
      nodes: [
        { id: "101", name: "Parent", next_nodes: ["102"] },
        { id: "102", name: "Child", desc: "強化技能", incoming: ["101"] }
      ],
      edges: [{ source: "101", target: "102" }]
    }
  });

  const tooltipView = new TooltipView({
    store,
    selectNodeUseCase,
    tooltipElement: tooltipEl,
    nodePositions
  });
  tooltipView.init();

  store.dispatch({ type: "TOGGLE_PREREQ_MODE", payload: true });
  selectNodeUseCase.execute("102", { point: { x: 500, y: 500 }, nodePositions });
  tooltipView.render(store.getState());

  assert.equal(tooltipEl.classList.has("is-visible"), true);
  assert.equal(tooltipEl.classList.has("is-placed-below"), true);
  assert.equal(titleEl.textContent, "Child");

  tooltipView.destroy();
});

test("TooltipView: anchors the pointer to a horizontally clamped node", () => {
  const previousWindow = globalThis.window;
  const styleValues = {};
  const tooltipEl = {
    offsetWidth: 300,
    offsetHeight: 220,
    style: {
      setProperty(name, value) {
        styleValues[name] = value;
      }
    }
  };
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    getComputedStyle: () => ({ borderLeftWidth: "2px", borderRightWidth: "2px" })
  };

  try {
    const tooltipView = new TooltipView({
      store: {},
      selectNodeUseCase: {},
      tooltipElement: tooltipEl
    });
    tooltipView._applyTooltipScreenPosition(
      { x: 100, y: 400 },
      { node_type: "DICE" },
      { viewport: { x: 260, y: 0, scale: 1 } },
      false
    );

    assert.equal(tooltipEl.style.left, "78px");
    assert.equal(styleValues["--tooltip-arrow-x"], "280px");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("TooltipView: reuses measured dimensions during viewport motion", () => {
  let widthReads = 0;
  let heightReads = 0;
  let styleReads = 0;
  const styleValues = {};
  const tooltipEl = {
    get offsetWidth() {
      widthReads += 1;
      return 300;
    },
    get offsetHeight() {
      heightReads += 1;
      return 220;
    },
    style: {
      setProperty(name, value) {
        styleValues[name] = value;
      }
    }
  };
  const previousWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    getComputedStyle: () => {
      styleReads += 1;
      return { borderLeftWidth: "2px", borderRightWidth: "2px" };
    }
  };

  try {
    const tooltipView = new TooltipView({
      store: {},
      selectNodeUseCase: {},
      tooltipElement: tooltipEl
    });
    const args = [
      { x: 100, y: 400 },
      { node_type: "DICE" },
      { viewport: { x: 260, y: 0, scale: 1 } },
      false
    ];
    tooltipView._applyTooltipScreenPosition(...args);
    tooltipView._applyTooltipScreenPosition(...args);

    assert.equal(widthReads, 1);
    assert.equal(heightReads, 1);
    assert.equal(styleReads, 1);
    assert.equal(styleValues["--tooltip-arrow-x"], "280px");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("TreeView: locale refresh forwards to the Canvas renderer", () => {
  const container = createMockElement("div");
  const renderActions = [];
  const refreshedLocalizations = [];
  const state = { nodesMap: new Map(), treeData: { nodes: [], edges: [] } };
  const renderer = {
    refreshLocalizedLabels: (localization) => refreshedLocalizations.push(localization),
    render: (_state, action) => renderActions.push(action?.type || null)
  };
  const treeView = new TreeView({
    store: { getState: () => state },
    selectNodeUseCase: {},
    navigateViewportUseCase: {},
    container,
    renderer
  });

  const localization = { getLocale: () => "en" };
  treeView.refreshLocalizedLabels(localization);
  assert.deepEqual(refreshedLocalizations, [localization]);
  assert.deepEqual(renderActions, ["LOCALE_CHANGED"]);
});

test("TooltipView: locale changes force an active tooltip content refresh", () => {
  const tooltipEl = createMockElement("div");
  tooltipEl.hidden = false;
  tooltipEl.classList.add("is-active");
  const simulation = { active: false };
  const selectedNode = { id: "1003", node_type: "DICE" };
  const state = {
    selectedNodeId: "1003",
    selectedNode,
    nodesMap: new Map([["1003", selectedNode]]),
    simulation,
    viewport: { x: 0, y: 0, scale: 1 },
    showPrereqMode: false,
    activePrereqIds: new Set()
  };
  let renderCount = 0;
  const tooltipView = new TooltipView({
    store: { getState: () => state },
    selectNodeUseCase: {},
    tooltipElement: tooltipEl
  });
  tooltipView._currentNodeId = "1003";
  tooltipView._lastRenderedSimState = simulation;
  tooltipView._renderFullContent = () => { renderCount += 1; };
  tooltipView._positionTooltip = () => {};

  tooltipView.setLocalization({ t: () => "localized" }, {});

  assert.equal(renderCount, 1);
});

test("TooltipView: viewport updates reposition without rerendering content", () => {
  const tooltipEl = createMockElement("div");
  tooltipEl.hidden = false;
  tooltipEl.classList.add("is-active");
  const state = {
    selectedNodeId: "1003",
    selectedNode: { id: "1003", node_type: "DICE" },
    viewport: { x: 0, y: 0, scale: 1 }
  };
  let subscriber;
  let renderCount = 0;
  let positionCount = 0;
  const tooltipView = new TooltipView({
    store: {
      getState: () => state,
      subscribe: (listener) => {
        subscriber = listener;
        return () => {};
      }
    },
    selectNodeUseCase: {},
    tooltipElement: tooltipEl
  });
  tooltipView._currentNodeId = "1003";
  tooltipView.render = () => { renderCount += 1; };
  tooltipView._positionTooltip = () => { positionCount += 1; };

  tooltipView.init();
  subscriber(state, { type: "UPDATE_VIEWPORT" });

  assert.equal(renderCount, 0);
  assert.equal(positionCount, 1);
  tooltipView.destroy();
});

test("TooltipView: keeps a closing tooltip anchored to its previous node", () => {
  const tooltipEl = createMockElement("div");
  tooltipEl.hidden = false;
  tooltipEl.classList.add("is-active", "is-closing");
  const state = {
    selectedNodeId: "new",
    selectedNode: { id: "new", node_type: "DICE" },
    viewport: { x: 0, y: 0, scale: 1 }
  };
  const positionCalls = [];
  const previousWindow = globalThis.window;
  const tooltipView = new TooltipView({
    store: { getState: () => state },
    selectNodeUseCase: {},
    tooltipElement: tooltipEl
  });

  try {
    globalThis.window = { innerWidth: 390, innerHeight: 844 };
    tooltipView._positionTooltip = (nodeId) => {
      positionCalls.push(String(nodeId));
      tooltipEl.style.left = "42px";
      tooltipEl.style.top = "84px";
    };
    tooltipView._currentNodeId = "new";
    tooltipView._switchTooltipSelection("old", "new", state.selectedNode, state);
    assert.deepEqual(tooltipView._closingPosition, {
      left: "42px",
      top: "84px",
      arrowX: "",
      isPlacedBelow: false
    });
    tooltipView._handleViewportUpdate(state);
    tooltipView._boundWindowResize();
  } finally {
    if (tooltipView._switchTimer) clearTimeout(tooltipView._switchTimer);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.deepEqual(positionCalls, ["old"]);
  assert.equal(tooltipEl.style.left, "42px");
  assert.equal(tooltipEl.style.top, "84px");
});

test("TooltipView: simulation changes refresh visible content during an entrance transition", () => {
  const tooltipEl = createMockElement("div");
  tooltipEl.hidden = false;
  tooltipEl.classList.add("is-active");
  const previousSimulation = { active: true, ranks: { "1001": 1 } };
  const nextSimulation = { active: true, ranks: { "1001": 1, "1201": 6 } };
  const selectedNode = { id: "1106", node_type: "PLAYER_PASSIVE" };
  const state = {
    selectedNodeId: "1106",
    selectedNode,
    simulation: nextSimulation,
    nodesMap: new Map([["1106", selectedNode]]),
    viewport: { x: 0, y: 0, scale: 1 },
    showPrereqMode: true,
    activePrereqIds: new Set()
  };
  let renderCount = 0;
  const tooltipView = new TooltipView({
    store: { getState: () => state },
    selectNodeUseCase: {},
    tooltipElement: tooltipEl
  });
  tooltipView._currentNodeId = "1106";
  tooltipView._lastRenderedSimState = previousSimulation;
  tooltipView._switchTimer = {};
  tooltipView._renderFullContent = () => { renderCount += 1; };
  tooltipView._positionTooltip = () => {};

  tooltipView._updateActiveSelection(state, "1106", selectedNode);

  assert.equal(renderCount, 1);
  assert.equal(tooltipView._lastRenderedSimState, nextSimulation);
});

test("TooltipView: init is idempotent and destroy removes DOM/global listeners", () => {
  const previousWindow = globalThis.window;
  const windowListeners = new Map();
  globalThis.window = {
    addEventListener(type, listener) {
      const entries = windowListeners.get(type) || [];
      entries.push(listener);
      windowListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter((entry) => entry !== listener));
    }
  };

  try {
    const tooltipEl = createMockElement("div");
    const tooltipView = new TooltipView({
      store: { subscribe: () => () => {} },
      selectNodeUseCase: {},
      tooltipElement: tooltipEl
    });

    tooltipView.init();
    tooltipView.init();
    assert.equal(windowListeners.get("click").length, 1);
    assert.equal(windowListeners.get("resize").length, 1);

    tooltipView.destroy();
    assert.equal(windowListeners.get("click").length, 0);
    assert.equal(windowListeners.get("resize").length, 0);

    tooltipView.destroy();
    assert.equal(windowListeners.get("click").length, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("ControlsView: init is idempotent and destroy removes the global keyboard listener", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const windowListeners = new Map();
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null
  };
  globalThis.window = {
    addEventListener(type, listener) {
      const entries = windowListeners.get(type) || [];
      entries.push(listener);
      windowListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter((entry) => entry !== listener));
    }
  };

  try {
    const controlsView = new ControlsView({
      store: { subscribe: () => () => {} },
      filterTreeUseCase: {},
      container: null
    });

    controlsView.init();
    controlsView.init();
    assert.equal(windowListeners.get("keydown").length, 1);
    assert.equal(windowListeners.get("click")?.length || 0, 0);

    controlsView.destroy();
    assert.equal(windowListeners.get("keydown").length, 0);
    assert.equal(windowListeners.get("click")?.length || 0, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("ControlsView: viewport actions update only the zoom readout", () => {
  const controlsView = new ControlsView({
    store: { subscribe: () => () => {} },
    filterTreeUseCase: {},
    container: null
  });
  let zoomRenders = 0;
  let searchRenders = 0;
  controlsView._renderZoomReadout = () => {
    zoomRenders += 1;
  };
  controlsView._renderSearchResults = () => {
    searchRenders += 1;
  };

  controlsView.render({
    filters: { search: "", factions: new Set(), nodeTypes: new Set() },
    viewport: { scale: 0.5 },
    showPrereqMode: true
  }, { type: "UPDATE_VIEWPORT" });

  assert.equal(zoomRenders, 1);
  assert.equal(searchRenders, 0);
});

test("ControlsView: skips duplicate zoom readout mutations", () => {
  const previousDocument = globalThis.document;
  const zoomReadout = createMockElement("span");
  globalThis.document = { getElementById: () => zoomReadout };

  try {
    const controlsView = new ControlsView({
      store: {},
      filterTreeUseCase: {},
      container: null
    });
    controlsView._renderZoomReadout({ scale: 0.5 });
    controlsView._renderZoomReadout({ scale: 0.5 });
    controlsView._renderZoomReadout({ scale: 0.51 });

    assert.equal(zoomReadout.textContent, "51%");
    assert.equal(controlsView._lastZoomReadoutValue, "51%");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("ControlsView: defers zoom readout mutations while navigating", () => {
  const previousDocument = globalThis.document;
  const zoomReadout = createMockElement("span");
  const body = createMockElement("body");
  globalThis.document = {
    body,
    getElementById: () => zoomReadout
  };

  try {
    const controlsView = new ControlsView({
      store: {},
      filterTreeUseCase: {},
      container: null
    });
    body.classList.add("is-zooming");
    controlsView._renderZoomReadout({ scale: 0.5 });

    assert.equal(zoomReadout.textContent, "");
    assert.equal(controlsView._deferredZoomReadoutValue, "50%");

    body.classList.remove("is-zooming");
    controlsView._renderZoomReadout({ scale: 1.15 });
    assert.equal(zoomReadout.textContent, "115%");
    assert.equal(controlsView._deferredZoomReadoutValue, null);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("TreeView: filter-only render delegates to Canvas without node DOM queries", () => {
  const scene = createMockElement("div");
  scene.classList.add("map-scene");
  const container = createMockElement("div");
  const renderActions = [];
  const renderer = { render: (_state, action) => renderActions.push(action?.type || null) };

  const view = new TreeView({
    store: { subscribe: () => () => {}, getState: () => ({}) },
    selectNodeUseCase: {},
    navigateViewportUseCase: {},
    container,
    mapScene: scene,
    renderer
  });

  view.render({
    selectedNodeId: null,
    activePrereqIds: new Set(),
    activeEdgeIds: new Set(),
    matchingNodeIds: new Set(["101"]),
    filters: {
      search: "",
      factions: new Set([1]),
      nodeTypes: new Set()
    },
    showPrereqMode: true,
    nodesMap: new Map([["101", { id: "101", branch: 1 }]]),
    simulation: { active: false, ranks: {} }
  }, { type: "SET_FILTER" });

  assert.deepEqual(renderActions, ["SET_FILTER"]);
  assert.equal(scene.classList.contains("has-tree-filter"), true);
});

test("TreeView: blank dismissal separates tooltip close from prerequisite exit", () => {
  const previousWindow = globalThis.window;
  const scene = createMockElement("div");
  scene.classList.add("map-scene");
  const container = createMockElement("div");
  const calls = [];
  const view = new TreeView({
    store: {
      getState: () => ({
        selectedNodeId: calls.length === 0 ? "2" : null,
        showPrereqMode: true,
        activePrereqIds: new Set(["1", "2"])
      })
    },
    selectNodeUseCase: {
      deselect: (options) => calls.push(options)
    },
    navigateViewportUseCase: {},
    container,
    mapScene: scene,
    renderer: null
  });

  globalThis.window = { innerWidth: 1280 };
  try {
    view._dismissSelection();
    assert.deepEqual(calls[0], { preservePrereqDisplay: true });
    view._dismissSelection();
    assert.deepEqual(calls[1], undefined);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("ControlsView: Toggles Show Names and Show Currency mutually exclusively", () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;

  const mockBody = createMockElement("body");
  mockBody.classList.add("show-node-names");

  const mockNameBtn = createMockElement("button");
  mockNameBtn.id = "toggle-node-names-btn";
  mockNameBtn.classList.add("is-active");
  mockNameBtn.setAttribute("aria-pressed", "true");

  const mockCurrBtn = createMockElement("button");
  mockCurrBtn.id = "toggle-currency-btn";
  mockCurrBtn.setAttribute("aria-pressed", "false");

  globalThis.document = {
    body: mockBody,
    getElementById: (id) => {
      if (id === "toggle-node-names-btn") return mockNameBtn;
      if (id === "toggle-currency-btn") return mockCurrBtn;
      return null;
    },
    querySelector: () => null
  };
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  try {
    const controlsView = new ControlsView({
      store: { subscribe: () => () => {}, getState: () => ({}) },
      filterTreeUseCase: {},
      container: null
    });
    controlsView.init();

    // 1. Initial State: Name active, Currency inactive
    assert.equal(mockBody.classList.contains("show-node-names"), true);
    assert.equal(mockBody.classList.contains("show-currency-badges"), false);

    // 2. Click Currency: Currency becomes active, Name becomes inactive
    mockCurrBtn.dispatchEvent("click", { stopPropagation: () => {} });
    assert.equal(mockBody.classList.contains("show-currency-badges"), true);
    assert.equal(mockCurrBtn.classList.contains("is-active"), true);
    assert.equal(mockCurrBtn.getAttribute("aria-pressed"), "true");
    assert.equal(mockBody.classList.contains("show-node-names"), false);
    assert.equal(mockNameBtn.classList.contains("is-active"), false);
    assert.equal(mockNameBtn.getAttribute("aria-pressed"), "false");

    // 3. Click Name: Name becomes active, Currency becomes inactive
    mockNameBtn.dispatchEvent("click", { stopPropagation: () => {} });
    assert.equal(mockBody.classList.contains("show-node-names"), true);
    assert.equal(mockNameBtn.classList.contains("is-active"), true);
    assert.equal(mockNameBtn.getAttribute("aria-pressed"), "true");
    assert.equal(mockBody.classList.contains("show-currency-badges"), false);
    assert.equal(mockCurrBtn.classList.contains("is-active"), false);
    assert.equal(mockCurrBtn.getAttribute("aria-pressed"), "false");

    controlsView.destroy();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("CompendiumView: monster render uses the static poster lifecycle", () => {
  const sectionsWrap = {
    children: [],
    innerHTML: "",
    classList: {
      add() {},
      remove() {}
    }
  };
  const view = new CompendiumView({
    store: { getState: () => ({}) }
  });
  view.sectionsWrap = sectionsWrap;
  view.category = "monster";

  let renderCount = 0;
  view._renderMonsters = () => {
    renderCount += 1;
  };
  view.render({ animated: false });

  assert.equal(renderCount, 1);
});

test("Compendium slider helper returns a reversible listener lifecycle", () => {
  const slider = createMockElement("input");
  slider.style.setProperty = () => {};
  slider.setPointerCapture = () => {};
  slider.releasePointerCapture = () => {};

  const dispose = attachElasticSlider(slider, { maxRank: 30 });

  assert.equal(slider.listenerCount("pointerdown"), 1);
  assert.equal(slider.listenerCount("pointermove"), 1);
  assert.equal(slider.listenerCount("pointerup"), 1);
  assert.equal(slider.listenerCount("pointercancel"), 1);
  assert.equal(slider.listenerCount("input"), 1);

  dispose();
  assert.equal(slider.listenerCount("pointerdown"), 0);
  assert.equal(slider.listenerCount("pointermove"), 0);
  assert.equal(slider.listenerCount("pointerup"), 0);
  assert.equal(slider.listenerCount("pointercancel"), 0);
  assert.equal(slider.listenerCount("input"), 0);
});

test("MorphingWidgets: Toggles filter and disclaimer expanded states", () => {
  const filterEl = createMockElement("div");
  const filterToggle = createMockElement("button");
  filterToggle.classList.add("filter-toggle-btn");
  const filterCard = createMockElement("div");
  filterCard.classList.add("filter-card");
  filterEl.appendChild(filterToggle);
  filterEl.appendChild(filterCard);

  const widgets = new MorphingWidgets({ filterWidgetElement: filterEl });
  widgets.init();

  assert.equal(widgets.isFilterOpen, false);
  widgets.toggleFilter();
  assert.equal(widgets.isFilterOpen, true);
  assert.equal(filterEl.classList.has("is-open"), true);
  assert.equal(filterToggle.getAttribute("aria-expanded"), "true");

  widgets.closeFilter();
  assert.equal(widgets.isFilterOpen, false);
  assert.equal(filterEl.classList.has("is-open"), false);
});

test("MorphingWidgets: locale widget follows the disclaimer surface lifecycle", () => {
  const localeEl = createMockElement("aside");
  const localeToggle = createMockElement("button");
  localeToggle.id = "locale-toggle-btn";
  const localeCard = createMockElement("div");
  localeCard.id = "locale-card";
  const localeClose = createMockElement("button");
  localeClose.id = "locale-close-btn";
  localeEl.appendChild(localeToggle);
  localeEl.appendChild(localeCard);
  localeEl.appendChild(localeClose);

  const widgets = new MorphingWidgets({ localeWidgetElement: localeEl });
  widgets.init();
  widgets.openLocale();

  assert.equal(widgets.isLocaleOpen, true);
  assert.equal(localeEl.classList.has("is-expanded"), true);
  assert.equal(localeToggle.getAttribute("aria-expanded"), "true");
  assert.equal(localeCard.getAttribute("aria-hidden"), "false");

  widgets.closeLocale();
  assert.equal(widgets.isLocaleOpen, false);
  assert.equal(localeEl.classList.has("is-expanded"), false);
  assert.equal(localeToggle.getAttribute("aria-expanded"), "false");
  assert.equal(localeCard.getAttribute("aria-hidden"), "true");
});

test("MorphingWidgets: init/destroy is reversible for toggle, widget, and document listeners", () => {
  const previousDocument = globalThis.document;
  const documentListeners = new Map();
  globalThis.document = {
    getElementById: () => null,
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || [];
      entries.push(listener);
      documentListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((entry) => entry !== listener));
    }
  };

  try {
    const filterEl = createMockElement("div");
    const filterToggle = createMockElement("button");
    filterToggle.classList.add("filter-toggle-btn");
    filterEl.appendChild(filterToggle);

    const widgets = new MorphingWidgets({ filterWidgetElement: filterEl });
    widgets.isFilterOpen = false;
    widgets.init();
    widgets.init();

    assert.equal(filterToggle.listenerCount("click"), 1);
    assert.equal(filterEl.listenerCount("click"), 1);
    assert.equal(documentListeners.get("click").length, 1);
    assert.equal(documentListeners.get("rd2:viewport-drag").length, 1);

    filterToggle.dispatchEvent("click", { stopPropagation() {} });
    assert.equal(widgets.isFilterOpen, true);

    widgets.destroy();
    assert.equal(filterToggle.listenerCount("click"), 0);
    assert.equal(filterEl.listenerCount("click"), 0);
    assert.equal(documentListeners.get("click").length, 0);
    assert.equal(documentListeners.get("rd2:viewport-drag").length, 0);

    widgets.isFilterOpen = false;
    widgets.init();
    assert.equal(filterToggle.listenerCount("click"), 1);
    assert.equal(filterEl.listenerCount("click"), 1);
    filterEl.dispatchEvent("click", {
      stopPropagation() {},
      target: filterEl,
    });
    assert.equal(widgets.isFilterOpen, true);
    widgets.destroy();
    assert.equal(filterEl.listenerCount("click"), 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
