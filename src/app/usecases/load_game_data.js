import { ActionTypes } from "../store/app_store.js";

/**
 * LoadGameDataUseCase
 * 
 * Orchestrates loading dice tree and boss event datasets from DataRepositoryPort
 * into the AppStore.
 */
export class LoadGameDataUseCase {
  /**
   * @param {object} dependencies
   * @param {import("../store/app_store.js").AppStore} dependencies.store
   * @param {import("../ports/data_repository_port.js").DataRepositoryPort} dependencies.dataRepository
   */
  constructor({ store, dataRepository }) {
    this.store = store;
    this.dataRepository = dataRepository;
  }

  /**
   * Execute data loading workflow.
   * @param {object} [options]
   * @param {string} [options.diceTreeUrl]
   * @param {string} [options.diceTreeSvgUrl]
   * @param {string} [options.bossEventsUrl]
   * @param {string} [options.monsterVisualsUrl]
   * @returns {Promise<{ treeData: object, svgText: string, bossEvents: object, monsterVisuals?: object, metadata?: object, changelog?: object, locales?: object }>}
   */
  async execute(options = {}) {
    const [treeData, svgText, bossEvents, monsterVisuals, metadata, changelog, locales] = await Promise.all([
      this.dataRepository.loadDiceTree(options.diceTreeUrl),
      this.dataRepository.loadDiceTreeSvg(options.diceTreeSvgUrl),
      this.dataRepository.loadBossEvents(options.bossEventsUrl),
      typeof this.dataRepository.loadMonsterVisuals === "function"
        ? this.dataRepository.loadMonsterVisuals(options.monsterVisualsUrl).catch(() => null)
        : Promise.resolve(null),
      typeof this.dataRepository.loadGameMetadata === "function"
        ? this.dataRepository.loadGameMetadata(options.gameMetadataUrl).catch(() => null)
        : Promise.resolve(null),
      typeof this.dataRepository.loadChangelog === "function"
        ? this.dataRepository.loadChangelog(options.changelogUrl).catch(() => null)
        : Promise.resolve(null),
      typeof this.dataRepository.loadLocales === "function"
        ? this.dataRepository.loadLocales(options.localesUrl)
        : Promise.resolve(null)
    ]);

    let enrichedBossEvents = bossEvents;
    // Attach visual definitions (poster, spine) to each monster in bossEvents.monsters by matching id.
    // Keep repository-owned payloads immutable so a later visual snapshot cannot
    // inherit presentation fields from an earlier execution.
    if (bossEvents && Array.isArray(bossEvents.monsters) && monsterVisuals) {
      const visualMap = monsterVisuals.monsters || monsterVisuals;
      enrichedBossEvents = {
        ...bossEvents,
        monsters: bossEvents.monsters.map((monster) => {
          const visual = visualMap[monster.id] || visualMap[monster.bossType] || visualMap[monster.name_en];
          if (!visual) return monster;
          const enrichedMonster = { ...monster };
          if (visual.poster && !enrichedMonster.poster) {
            enrichedMonster.poster = visual.poster;
          }
          if (visual.spine && !enrichedMonster.spine) {
            enrichedMonster.spine = visual.spine;
          }
          return enrichedMonster;
        })
      };
    }

    this.store.dispatch({
      type: ActionTypes.SET_GAME_DATA,
      payload: treeData
    });

    this.store.dispatch({
      type: ActionTypes.SET_BOSS_EVENTS,
      payload: enrichedBossEvents
    });

    if (metadata) {
      this.store.dispatch({
        type: ActionTypes.SET_DATA_METADATA,
        payload: metadata
      });
    }
    if (changelog) {
      this.store.dispatch({
        type: ActionTypes.SET_CHANGELOG,
        payload: changelog
      });
    }

    return { treeData, svgText, bossEvents: enrichedBossEvents, monsterVisuals, metadata, changelog, locales };
  }
}
