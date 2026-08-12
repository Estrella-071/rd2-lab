import { ActionTypes } from "../store/app_store.js";

/**
 * FilterTreeUseCase
 * 
 * Manages tree filtering criteria: faction toggles, node type toggles,
 * and text search queries.
 */
export class FilterTreeUseCase {
  /**
   * @param {object} dependencies
   * @param {import("../store/app_store.js").AppStore} dependencies.store
   */
  constructor({ store }) {
    this.store = store;
  }

  /**
   * Update search keyword.
   * @param {string} query
   */
  setSearch(query) {
    if (query?.trim()) {
      this.store.dispatch({
        type: ActionTypes.DESELECT_NODE
      });
    }
    this.store.dispatch({
      type: ActionTypes.SET_FILTER,
      payload: { search: query }
    });
  }

  /**
   * Toggle faction filter.
   * @param {number} factionId - 1..5
   * @param {boolean} [isActive]
   */
  toggleFaction(factionId, isActive) {
    const currentFactions = new Set(this.store.getState().filters.factions);
    const idNum = Number(factionId);
    if (isActive !== undefined) {
      if (isActive) currentFactions.add(idNum);
      else currentFactions.delete(idNum);
    } else {
      const wasActive = currentFactions.has(idNum);
      if (wasActive) currentFactions.delete(idNum);
      if (!wasActive) currentFactions.add(idNum);
    }

    this.store.dispatch({
      type: ActionTypes.SET_FILTER,
      payload: { factions: currentFactions }
    });
  }

  /**
   * Toggle node type filter.
   * @param {string} nodeType - "DICE" | "DICE_RUNE" | "PLAYER_PASSIVE" | "PERK"
   * @param {boolean} [isActive]
   */
  toggleNodeType(nodeType, isActive) {
    const currentTypes = new Set(this.store.getState().filters.nodeTypes);
    if (isActive !== undefined) {
      if (isActive) currentTypes.add(nodeType);
      else currentTypes.delete(nodeType);
    } else {
      const wasActive = currentTypes.has(nodeType);
      if (wasActive) currentTypes.delete(nodeType);
      if (!wasActive) currentTypes.add(nodeType);
    }

    this.store.dispatch({
      type: ActionTypes.SET_FILTER,
      payload: { nodeTypes: currentTypes }
    });
  }

  /**
   * Clear all active filters.
   */
  clear() {
    this.store.dispatch({ type: ActionTypes.CLEAR_FILTERS });
  }
}
