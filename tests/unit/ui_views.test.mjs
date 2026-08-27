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

test("TreeView: Renders node classes and handles click selection", () => {
  const store = new AppStore();
  const selectNodeUseCase = new SelectNodeUseCase({ store });
  const navigateViewportUseCase = new NavigateViewportUseCase({ store, viewportController: { pan(){}, zoom(){}, centerOn(){} } });

  const container = createMockElement("div");
  const svg = createMockElement("svg");

  const node1 = createMockElement("g", { id: "node-101" });
  node1.classList.add("tree-node");
  node1.dataset.nodeId = "101";

  const node2 = createMockElement("g", { id: "node-102" });
  node2.classList.add("tree-node");
  node2.dataset.nodeId = "102";

  svg.appendChild(node1);
  svg.appendChild(node2);

  store.dispatch({
    type: "SET_GAME_DATA",
    payload: {
      nodes: [
        { id: "101", name: "風骰子", next_nodes: ["102"] },
        { id: "102", name: "狂風骰子", incoming: ["101"] }
      ],
      edges: [{ source: "101", target: "102" }]
    }
  });

  const treeView = new TreeView({
    store,
    selectNodeUseCase,
    navigateViewportUseCase,
    container,
    svgElement: svg
  });
  treeView.init();
  treeView.init();
  assert.equal(container.listenerCount("click"), 1);
  assert.equal(node1.listenerCount("pointerdown"), 1);
  assert.equal(node1.getAttribute("role"), "button");
  assert.equal(node1.getAttribute("tabindex"), "0");
  assert.equal(node1.getAttribute("aria-label"), "風骰子");

  let viewportRenderCount = 0;
  const originalRender = treeView.render.bind(treeView);
  treeView.render = (state) => {
    viewportRenderCount += 1;
    return originalRender(state);
  };
  store.dispatch({ type: "UPDATE_VIEWPORT", payload: { x: 20, y: 10, scale: 0.8 } });
  assert.equal(viewportRenderCount, 0);

  node1.dispatchEvent("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(store.getState().selectedNodeId, "101");

  // Select node 102
  selectNodeUseCase.execute("102");
  treeView.render(store.getState());

  assert.equal(node2.classList.has("is-selected"), true);
  assert.equal(node1.classList.has("is-active-path"), true);

  treeView.destroy();
  assert.equal(container.listenerCount("click"), 0);
  assert.equal(node1.listenerCount("pointerdown"), 0);
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

test("TreeView: locale refresh resizes an existing node name badge", () => {
  const makeRect = () => {
    const attributes = {};
    return {
      attributes,
      setAttribute: (name, value) => { attributes[name] = String(value); }
    };
  };
  const rects = [makeRect(), makeRect()];
  const badgeText = {
    textContent: "",
    setAttribute: () => {}
  };
  const badge = {
    querySelectorAll: () => rects,
    querySelector: () => badgeText
  };
  const element = { querySelector: () => badge };
  const treeView = new TreeView({
    store: {},
    selectNodeUseCase: {},
    navigateViewportUseCase: {}
  });

  treeView._updateNodeNameBadge(element, { node_type: "DICE", name_zh: "Flower Dice" });
  const firstWidth = Number(rects[0].attributes.width);
  treeView._updateNodeNameBadge(element, { node_type: "DICE", name_zh: "花骰子" });

  assert(firstWidth > Number(rects[0].attributes.width));
  assert.equal(rects[0].attributes.width, "76");
  assert.equal(rects[0].attributes.x, "-38");
  assert.equal(rects[1].attributes.width, "73");
  assert.equal(badgeText.textContent, "花骰子");
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

    tooltipView.destroy();
    assert.equal(windowListeners.get("click").length, 0);

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

test("TreeView: filter-only render skips simulation badge queries", () => {
  const svg = createMockElement("svg");
  const node = createMockElement("g");
  node.dataset.nodeId = "101";
  let queryCount = 0;
  const originalQuerySelector = node.querySelector;
  node.querySelector = (selector) => {
    queryCount += 1;
    return originalQuerySelector(selector);
  };

  const view = new TreeView({
    store: { subscribe: () => () => {}, getState: () => ({}) },
    selectNodeUseCase: {},
    navigateViewportUseCase: {},
    svgElement: svg
  });
  view.nodesMap = new Map([["101", node]]);
  view.parsedEdges = [];
  view.cachedCenterLinks = [];
  view.cachedBranchMarks = [];

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

  assert.equal(queryCount, 0);
  assert.equal(node.classList.contains("is-highlight-match"), true);
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

test("CompendiumView: monster render observes cards with the current Spine observer", () => {
  const previousIntersectionObserver = globalThis.IntersectionObserver;
  const createdObservers = [];

  class MockIntersectionObserver {
    constructor() {
      this.observed = [];
      this.disconnectCount = 0;
      createdObservers.push(this);
    }

    observe(element) {
      this.observed.push(element);
    }

    disconnect() {
      this.disconnectCount += 1;
    }
  }

  globalThis.IntersectionObserver = MockIntersectionObserver;

  try {
    const sectionsWrap = {
      children: [],
      innerHTML: "",
      classList: {
        add() {},
        remove() {}
      }
    };
    const view = new CompendiumView({
      store: { getState: () => ({}) },
      spineEngine: { disposeAll() {} }
    });
    view.sectionsWrap = sectionsWrap;
    view.category = "monster";

    const priorObserver = new MockIntersectionObserver();
    view._spineObserver = priorObserver;
    let observerUsedDuringRender = null;
    const renderedVisual = {};
    view._renderMonsters = () => {
      observerUsedDuringRender = view._spineObserver;
      observerUsedDuringRender.observe(renderedVisual);
    };

    view.render({ animated: false });

    assert.notEqual(observerUsedDuringRender, priorObserver);
    assert.equal(observerUsedDuringRender, createdObservers.at(-1));
    assert.deepEqual(observerUsedDuringRender.observed, [renderedVisual]);
  } finally {
    if (previousIntersectionObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = previousIntersectionObserver;
  }
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
