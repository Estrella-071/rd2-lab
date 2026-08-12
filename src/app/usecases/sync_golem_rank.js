import { ActionTypes } from "../store/app_store.js";

/**
 * SyncGolemRankUseCase
 * 
 * Synchronizes SP Golem stats (Rank 1-30, Life %, Coop SP, Battle SP)
 * according to game design formulas.
 */
export class SyncGolemRankUseCase {
  /**
   * @param {object} dependencies
   * @param {import("../store/app_store.js").AppStore} dependencies.store
   */
  constructor({ store }) {
    this.store = store;
  }

  /**
   * Update SP Golem stat by modifying any of the 4 linked fields.
   * @param {"rank"|"lifePercent"|"coopSp"|"battleSp"} field
   * @param {number} value
   * @returns {object} Updated golem state
   */
  execute(field, value) {
    this.store.dispatch({
      type: ActionTypes.SET_GOLEM_STAT,
      payload: { field, value }
    });
    return this.store.getState().golem;
  }
}
