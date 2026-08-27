import { ActionTypes } from "../store/app_store.js";
import { shouldPlaceTooltipBelow } from "../../domain/tooltip_position.js";

/**
 * NavigateViewportUseCase
 * 
 * Orchestrates camera panning, zooming, and node location transitions.
 */
export class NavigateViewportUseCase {
  /**
   * @param {object} dependencies
   * @param {import("../store/app_store.js").AppStore} dependencies.store
   * @param {import("../ports/viewport_port.js").ViewportPort} dependencies.viewportController
   */
  constructor({ store, viewportController }) {
    this.store = store;
    this.viewportController = viewportController;
  }

  /**
   * Pan viewport by delta.
   * @param {number} dx
   * @param {number} dy
   */
  pan(dx, dy) {
    this.viewportController.pan(dx, dy);
    this._syncStore();
  }

  /**
   * Zoom viewport by factor.
   * @param {number} factor
   * @param {number} [cx]
   * @param {number} [cy]
   */
  zoom(factor, cx, cy) {
    this.viewportController.zoom(factor, cx, cy);
    this._syncStore();
  }

  /**
   * Locate and center camera on a node for optimal tooltip placement.
   * @param {string|number} nodeId
   * @param {boolean} [immediate]
   */
  centerOnNodeForTooltip(nodeId, immediate = false) {
    const state = this.store.getState();
    const pt = state.nodePositions?.get(String(nodeId)) || state.nodePositions?.get(Number(nodeId));
    const node = state.nodesMap?.get(String(nodeId)) || state.nodesMap?.get(Number(nodeId));
    if (!pt) return;

    const isBelow = shouldPlaceTooltipBelow(nodeId, state.nodePositions, state.showPrereqMode ? state.activePrereqIds : null);
    const tipEl = typeof document !== "undefined" ? document.getElementById("tooltip") : null;
    const tipHeight = tipEl?.offsetHeight || 320;

    if (typeof this.viewportController.centerOnNodeForTooltip === "function") {
      this.viewportController.centerOnNodeForTooltip({ pt, node, isBelow, tipHeight, immediate });
    } else {
      this.viewportController.centerOn(pt.x, pt.y, undefined, !immediate);
    }
    this._syncStore();
  }

  /**
   * Center and fit camera on a prerequisite path.
   * @param {Set<string|number>|Array<string|number>} nodeIds
   * @param {boolean} [immediate]
   */
  centerOnPrereqPath(nodeIds, immediate = false) {
    const state = this.store.getState();
    const list = Array.isArray(nodeIds) ? nodeIds : Array.from(nodeIds || []);
    if (!list.length || list.length <= 1) return;
    const positions = list.map((id) => state.nodePositions?.get(String(id)) || state.nodePositions?.get(Number(id))).filter(Boolean);
    if (typeof this.viewportController.centerOnPrereqPath === "function") {
      this.viewportController.centerOnPrereqPath(positions, immediate);
    }
    this._syncStore();
  }

  /**
   * Adaptive camera focus to matched nodes from search or filter.
   * @param {Set<string|number>|Array<string|number>} nodeIds
   * @param {boolean} [immediate]
   */
  fitCameraToNodes(nodeIds, immediate = false) {
    const state = this.store.getState();
    const list = Array.isArray(nodeIds) ? nodeIds : Array.from(nodeIds || []);
    const totalNodes = state.nodesMap?.size || state.treeData?.nodes?.length || 0;
    if (!list.length || (totalNodes > 0 && list.length >= totalNodes)) {
      this.reset();
      return;
    }
    const positions = list.map((id) => state.nodePositions?.get(String(id)) || state.nodePositions?.get(Number(id))).filter(Boolean);
    if (typeof this.viewportController.fitCameraToNodes === "function") {
      this.viewportController.fitCameraToNodes(positions, immediate);
    }
    this._syncStore();
  }

  /**
   * Locate camera on node with optional explicit point and target scale.
   * @param {string|number} nodeId
   * @param {{ x: number, y: number }} [point]
   * @param {number} [targetScale]
   */
  locateNode(nodeId, point, targetScale) {
    const pt = point || this.store.getState().nodePositions?.get(String(nodeId));
    if (!pt) return;
    this.viewportController.centerOn(pt.x, pt.y, targetScale, true);
    this._syncStore();
  }

  /**
   * Reset camera to center.
   */
  reset() {
    this.viewportController.reset();
    this._syncStore();
  }

  _syncStore() {
    const vpState = this.viewportController.getState();
    this.store.dispatch({
      type: ActionTypes.UPDATE_VIEWPORT,
      payload: vpState
    });
  }
}
