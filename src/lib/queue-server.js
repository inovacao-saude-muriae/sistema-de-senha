import { queue } from "./repositories";

// Re-export utilities for backward compatibility
import { normalizeCallType, formatNumberString, isInvalidApiKeyError } from "./repositories/utils";
import { CALL_TYPES } from "./constants.js";

// The actual queue logic is now in the repository layer
// This file maintains backward compatibility by delegating to the repository

export {
  isInvalidApiKeyError,
  normalizeCallType,
  formatNumberString,
  // For backward compatibility with existing imports
  queue
};

// These functions are kept for direct import compatibility
// but they now delegate to the repository implementations
export function getQueueDb() {
  // This is kept for backward compatibility but now just returns a marker
  // The actual client selection happens in the repository
  return { __backend_marker: true };
}

export function getQueueDbClients() {
  // Return empty array - the multi-client fallback logic has been removed
  // as it was only needed for Supabase API key tolerance
  return [];
}

export async function insertQueueCall(db, callData) {
  // Delegates to repository - db parameter is ignored for backward compatibility
  return queue.saveCall(callData);
}

export async function resetSectorSequence(db, sector) {
  // Delegates to repository - db parameter is ignored for backward compatibility
  return queue.resetSector(sector);
}

export async function nextQueueNumberForSector(db, sector, sequenceType) {
  // Delegates to repository - db parameter is ignored for backward compatibility
  // Note: repository expects type ('normal'|'preferencial') but sequenceType
  // is the same as type in our implementation
  const type = sequenceType === CALL_TYPES.PREFERENCIAL || sequenceType === CALL_TYPES.PREFERENTIAL
    ? CALL_TYPES.PREFERENCIAL
    : CALL_TYPES.NORMAL;
  return queue.nextNumber(sector, type);
}