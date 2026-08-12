import { ActionTypes } from "../store/app_store.js";
import {
  evaluateNode,
  planBatchUnlock,
  planMaxRank,
  planRevokeNode
} from "../../domain/simulation_plan.js";
import {
  decodeSimulationShare,
  buildSimulationShareCodeUrl,
  hydrateSimulationShare,
  serializeSimulationState,
  getDataVersion
} from "../../domain/simulation_share.js";

/**
 * Application orchestration for simulation mode. The use case never touches
 * DOM or infrastructure; views subscribe to the same AppStore as the normal
 * tree browser and only dispatch these intent methods.
 */
export class SimulationPlanUseCase {
  constructor({ store, shareImageExporter = null, shareRepository = null } = {}) {
    this.store = store;
    this.shareImageExporter = shareImageExporter;
    this.shareRepository = shareRepository;
  }

  get state() {
    return this.store.getState();
  }

  enter() {
    this.store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: true });
    return this.state.simulation;
  }

  exit() {
    this.store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: false });
    return this.state.simulation;
  }

  toggle() {
    return this.state.simulation?.active ? this.exit() : this.enter();
  }

  inspect(nodeId) {
    const state = this.state;
    return evaluateNode(nodeId, state.simulation, state.nodesMap);
  }

  previewBatch(nodeId) {
    const state = this.state;
    return planBatchUnlock(nodeId, state.simulation, state.nodesMap);
  }

  previewMax(nodeId) {
    const state = this.state;
    return planMaxRank(nodeId, state.simulation, state.nodesMap);
  }

  unlock(nodeId) {
    this.store.dispatch({ type: ActionTypes.SIMULATION_UNLOCK_NODE, payload: { nodeId } });
    return this.state.simulation;
  }

  upgrade(nodeId) {
    return this.unlock(nodeId);
  }

  maxRank(nodeId) {
    this.store.dispatch({ type: ActionTypes.SIMULATION_MAX_NODE, payload: { nodeId } });
    return this.state.simulation;
  }

  batchUnlock(nodeId) {
    this.store.dispatch({ type: ActionTypes.SIMULATION_BATCH_UNLOCK, payload: { nodeId } });
    return this.state.simulation;
  }

  previewRevoke(nodeId) {
    const state = this.state;
    return planRevokeNode(nodeId, state.simulation, state.nodesMap);
  }

  revoke(nodeId) {
    this.store.dispatch({ type: ActionTypes.SIMULATION_REVOKE_NODE, payload: { nodeId } });
    return this.state.simulation;
  }

  reset() {
    this.store.dispatch({ type: ActionTypes.SIMULATION_RESET });
    return this.state.simulation;
  }

  setTeam(team) {
    this.store.dispatch({ type: ActionTypes.SIMULATION_SET_TEAM, payload: team });
    return this.state.simulation.team;
  }

  serialize({ origin } = {}) {
    const state = this.state;
    return serializeSimulationState({
      simulation: state.simulation,
      treeData: state.treeData,
      dataVersion: state.dataMetadata?.canonical?.game_version || state.simulation?.dataVersion,
      origin
    });
  }

  async createShareLink({ origin, serialized = null } = {}) {
    const local = serialized || this.serialize({ origin });
    if (!this.shareRepository || typeof this.shareRepository.createShare !== "function") return local;
    const remote = await this.shareRepository.createShare(local.encoded);
    if (!remote?.ok) return { ...local, remote: false, remoteError: remote?.error || "share-api-unavailable" };
    return {
      ...local,
      remote: true,
      code: remote.code,
      url: buildSimulationShareCodeUrl({ code: remote.code, origin })
    };
  }

  async loadShareCode(code) {
    if (!this.shareRepository || typeof this.shareRepository.loadShare !== "function") {
      return { ok: false, error: "share-api-unavailable" };
    }
    return this.shareRepository.loadShare(code);
  }

  importShare(input, options = {}) {
    const decoded = decodeSimulationShare(input, options);
    if (!decoded.ok) return decoded;
    const state = this.state;
    const hydrated = hydrateSimulationShare(decoded, state.nodesMap, {
      active: options.active !== false,
      dataVersion: state.simulation?.dataVersion
    });
    const currentVersion = state.dataMetadata?.canonical?.game_version || state.simulation?.dataVersion || getDataVersion(state.treeData);
    if (decoded.dataVersion && decoded.dataVersion !== "unknown" && decoded.dataVersion !== currentVersion) {
      hydrated.warnings = [...new Set([...(hydrated.warnings || []), "data-version-mismatch"])];
    }
    this.store.dispatch({ type: ActionTypes.SET_SIMULATION_STATE, payload: hydrated });
    return { ...decoded, simulation: this.state.simulation };
  }

  async generateShareImage(options = {}) {
    if (!this.shareImageExporter || typeof this.shareImageExporter.generate !== "function") {
      return { ok: false, error: "image-exporter-unavailable" };
    }
    const state = this.state;
    return this.shareImageExporter.generate({
      ...options,
      simulation: state.simulation,
      treeData: state.treeData
    });
  }
}
