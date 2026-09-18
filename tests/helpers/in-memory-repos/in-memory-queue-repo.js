/**
 * In-memory implementation of QueueRepository for fast contract testing.
 * No external dependencies — uses Map and Array.
 */
export class InMemoryQueueRepository {
  #sequences = new Map(); // "sector:type" → current_number
  #calls = [];

  async nextNumber(sector, type) {
    const key = `${sector}:${type}`;
    const current = this.#sequences.has(key) ? this.#sequences.get(key) : -1;

    const next = current + 1;
    const wraparound = next > 999;

    if (wraparound) {
      this.#sequences.set(key, 0);
      return { number: 0, wraparound: true };
    }

    this.#sequences.set(key, next);
    return { number: next, wraparound: false };
  }

  async saveCall(call) {
    const id = crypto.randomUUID();
    this.#calls.push({
      ...call,
      id,
      created_at: new Date(),
    });
    return { id };
  }

  async resetSector(sector) {
    for (const key of this.#sequences.keys()) {
      if (key.startsWith(`${sector}:`)) {
        this.#sequences.set(key, -1);
      }
    }
  }

  async setNextNumber(sector, type, nextNumber) {
    const num = Number(nextNumber);
    if (!Number.isInteger(num) || num < 0 || num > 999) {
      throw new Error("Número inválido. Use um valor entre 0 e 999.");
    }
    // Store nextNumber - 1 because nextNumber() increments before returning
    const key = `${sector}:${type}`;
    this.#sequences.set(key, num - 1);
  }

  // --- Test helpers (not part of the interface) ---

  /** Get all saved calls. */
  getCalls() {
    return [...this.#calls];
  }

  /** Get current sequence value for a sector+type. */
  getSequence(sector, type) {
    return this.#sequences.get(`${sector}:${type}`) ?? -1;
  }
}
