/**
 * ShareRepositoryPort
 *
 * Application-facing contract for storing and retrieving opaque simulation
 * share payloads. The application layer does not know whether the adapter is
 * backed by Pages Functions, a local test server, or another HTTP service.
 */
export class ShareRepositoryPort {
  async createShare(_encoded) {
    throw new Error("ShareRepositoryPort.createShare must be implemented by an adapter.");
  }

  async loadShare(_code) {
    throw new Error("ShareRepositoryPort.loadShare must be implemented by an adapter.");
  }
}
