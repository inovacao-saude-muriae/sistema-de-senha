import { EventEmitter } from "node:events";
import { MAX_SSE_CONNECTIONS_PER_SECTOR } from "./constants.js";

/**
 * In-memory pub/sub manager for realtime queue events.
 * Uses Node.js EventEmitter — zero external dependencies.
 *
 * Pattern: "queue:{sector}" events carry formatted call objects, with the
 * sector's reset marker passed alongside as the second argument.
 */
class EventManager extends EventEmitter {
  constructor() {
    super();
    // Keep in sync with MAX_SSE_CONNECTIONS_PER_SECTOR: exceeding the cap is
    // rejected at the route, so listeners should never pile up past this.
    this.setMaxListeners(MAX_SSE_CONNECTIONS_PER_SECTOR);
  }

  /**
   * Emit a queue call event for a sector.
   * @param {'farmacia'|'recepcao'} sector
   * @param {{ id:string, number:number, type:string, time:string }} call
   * @param {string|null} [resetAt] ISO marker of the sector's last reset
   */
  emitQueueCall(sector, call, resetAt = null) {
    this.emit(`queue:${sector}`, call, resetAt);
  }

  /**
   * Emit a queue recall event for a sector.
   * @param {'farmacia'|'recepcao'} sector
   * @param {{ id:string, number:number, type:string, time:string }} call
   * @param {string|null} [resetAt] ISO marker of the sector's last reset
   */
  emitQueueRecall(sector, call, resetAt = null) {
    this.emit(`queue:recall:${sector}`, call, resetAt);
  }

  /**
   * Emit a queue reset event for a sector.
   * @param {'farmacia'|'recepcao'} sector
   * @param {string|null} [resetAt] ISO marker of the reset just performed
   */
  emitQueueReset(sector, resetAt = null) {
    this.emit(`queue:reset:${sector}`, resetAt);
  }

  /**
   * Subscribe to queue calls for a sector.
   * @param {'farmacia'|'recepcao'} sector
   * @param {(call: { id:string, number:number, type:string, time:string }, resetAt: string|null) => void} callback
   * @returns {() => void} unsubscribe function
   */
  subscribeToQueue(sector, callback) {
    const handler = (call, resetAt) => callback(call, resetAt);
    this.on(`queue:${sector}`, handler);
    return () => {
      this.off(`queue:${sector}`, handler);
    };
  }

  /**
   * Subscribe to queue recall events for a sector.
   * @param {'farmacia'|'recepcao'} sector
   * @param {(call: { id:string, number:number, type:string, time:string }, resetAt: string|null) => void} callback
   * @returns {() => void} unsubscribe function
   */
  subscribeToRecall(sector, callback) {
    const handler = (call, resetAt) => callback(call, resetAt);
    this.on(`queue:recall:${sector}`, handler);
    return () => {
      this.off(`queue:recall:${sector}`, handler);
    };
  }

  /**
   * Subscribe to queue reset events for a sector.
   * @param {'farmacia'|'recepcao'} sector
   * @param {(resetAt: string|null) => void} callback
   * @returns {() => void} unsubscribe function
   */
  subscribeToReset(sector, callback) {
    const handler = (resetAt) => callback(resetAt);
    this.on(`queue:reset:${sector}`, handler);
    return () => {
      this.off(`queue:reset:${sector}`, handler);
    };
  }

  /**
   * Get the number of active listeners for a sector (for testing/debugging).
   * @param {'farmacia'|'recepcao'} sector
   * @returns {number}
   */
  getSubscriberCount(sector) {
    return this.listenerCount(`queue:${sector}`);
  }

  /**
   * Get the number of active recall listeners for a sector (for testing/debugging).
   * @param {'farmacia'|'recepcao'} sector
   * @returns {number}
   */
  getRecallSubscriberCount(sector) {
    return this.listenerCount(`queue:recall:${sector}`);
  }

  /**
   * Get the number of active reset listeners for a sector (for testing/debugging).
   * @param {'farmacia'|'recepcao'} sector
   * @returns {number}
   */
  getResetSubscriberCount(sector) {
    return this.listenerCount(`queue:reset:${sector}`);
  }
}

export { EventManager };
export const eventManager = new EventManager();
