import { ActionTypes } from "../store/app_store.js";
import { shouldPlaceTooltipBelow } from "../../domain/tooltip_position.js";

/**
 * SelectNodeUseCase
 * 
 * Orchestrates node selection, topological path highlighting, and
 * smart tooltip positioning calculation.
 */
export class SelectNodeUseCase {
  /**
   * @param {object} dependencies
   * @param {import("../store/app_store.js").AppStore} dependencies.store
   */
  constructor({ store }) {
    this.store = store;
  }

  /**
   * Select a tree node.
   * @param {string|number|null} nodeId
   * @param {object} [context]
   * @param {{ x: number, y: number }} [context.point] - Current node world point
   * @param {Map<string, { x: number, y: number }>} [context.nodePositions]
   * @returns {{ selectedNode: object|null, isPlacedBelow: boolean }}
   */
  execute(nodeId, context = {}) {
    if (!nodeId) {
      this.store.dispatch({ type: ActionTypes.DESELECT_NODE });
      return { selectedNode: null, isPlacedBelow: false };
    }

    const idStr = String(nodeId);
    this.store.dispatch({
      type: ActionTypes.SELECT_NODE,
      payload: idStr
    });

    const state = this.store.getState();
    let isPlacedBelow = false;

    if (context.point && context.nodePositions) {
      isPlacedBelow = shouldPlaceTooltipBelow({
        nodeId: idStr,
        pt: context.point,
        activePrereqNodeIds: state.activePrereqIds,
        nodePositions: context.nodePositions
      });
    }

    return {
      selectedNode: state.selectedNode,
      activePrereqs: state.activePrereqIds,
      isPlacedBelow
    };
  }

  /**
   * Clear current selection.
   */
  deselect({ resetPrereqMode = false } = {}) {
    this.store.dispatch({
      type: ActionTypes.DESELECT_NODE,
      payload: { resetPrereqMode: Boolean(resetPrereqMode) }
    });
  }
}
