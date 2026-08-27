// Interface for the data sources used by the page.

export class DataRepositoryPort {
  /**
   * Load the dice tree JSON data.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<object>} Parsed dice tree object with nodes, edges, factions
   */
  async loadDiceTree(url) {
    throw new Error("DataRepositoryPort.loadDiceTree must be implemented by an adapter.");
  }

  /**
   * Load the dice tree SVG text.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<string>} Raw SVG text
   */
  async loadDiceTreeSvg(url) {
    throw new Error("DataRepositoryPort.loadDiceTreeSvg must be implemented by an adapter.");
  }

  /**
   * Load the boss & wave event JSON data.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<object>} Parsed boss & wave event object
   */
  async loadBossEvents(url) {
    throw new Error("DataRepositoryPort.loadBossEvents must be implemented by an adapter.");
  }

  /**
   * Load monster visuals JSON data.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<object>} Parsed monster visuals object
   */
  async loadMonsterVisuals(url) {
    throw new Error("DataRepositoryPort.loadMonsterVisuals must be implemented by an adapter.");
  }

  /**
   * Load the single canonical game-data metadata document used for version
   * labels and source/provenance display. Fixture data may omit it.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<object>} Parsed canonical metadata object
   */
  async loadGameMetadata(url) {
    throw new Error("DataRepositoryPort.loadGameMetadata must be implemented by an adapter.");
  }

  /**
   * Load structured, data-generated version history entries.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<object>} Parsed changelog object
   */
  async loadChangelog(url) {
    throw new Error("DataRepositoryPort.loadChangelog must be implemented by an adapter.");
  }

  /**
   * Load the runtime locale catalog.
   * @param {string} [url] - Optional override URL
   * @returns {Promise<object>} Four-locale translation catalog
   */
  async loadLocales(url) {
    throw new Error("DataRepositoryPort.loadLocales must be implemented by an adapter.");
  }

  /**
   * Load all datasets.
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async loadAll(options) {
    throw new Error("DataRepositoryPort.loadAll must be implemented by an adapter.");
  }

  /**
   * Clear cached dataset if any.
   */
  clearCache() {
    throw new Error("DataRepositoryPort.clearCache must be implemented by an adapter.");
  }
}
