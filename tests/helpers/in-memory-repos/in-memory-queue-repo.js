/**
 * In-memory implementation of QueueRepository for fast contract testing.
 * No external dependencies — uses Map and Array.
 */
export class InMemoryQueueRepository {
  #sequences = new Map(); // "sector:type" → current_number
  #calls = [];
  #resetAt = new Map(); // sector → Date
  #clock = 0;

  /**
   * Monotonic timestamp source. Guarantees strict ordering between calls and
   * resets even within the same millisecond, so `created_at >= resetAt`
   * filtering is deterministic.
   */
  #now() {
    this.#clock = Math.max(Date.now(), this.#clock + 1);
    return new Date(this.#clock);
  }

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
      created_at: this.#now(),
    });
    return { id };
  }

  async resetSector(sector) {
    for (const key of this.#sequences.keys()) {
      if (key.startsWith(`${sector}:`)) {
        this.#sequences.set(key, -1);
      }
    }
    this.#resetAt.set(sector, this.#now());
  }

  async getSectorResetAt(sector) {
    return this.#resetAt.get(sector) ?? null;
  }

  async getRecentCalls(sector, limit = 30, resetAt = null) {
    return this.#calls
      .filter((c) => c.sector === sector)
      .filter((c) => !resetAt || c.created_at >= resetAt)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        number: c.number,
        type: c.sequenceType === "preferencial" ? "preferencial" : "normal",
        time: new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(c.created_at),
        createdAt: new Date(c.created_at).toISOString(),
      }));
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
