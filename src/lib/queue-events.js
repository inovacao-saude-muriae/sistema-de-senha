import {
  POLLING_INTERVAL,
  SSE_BACKOFF_BASE,
  SSE_BACKOFF_MAX,
  SSE_EVENT_TYPES,
  API_ROUTES,
  HISTORY_LIMITS,
  RESET_MARKER_KEY,
} from "./constants.js";
import { invalidateQueueState } from "./queue.js";

/**
 * Module-level owner of the realtime queue connections.
 *
 * Follows the same idiom as `queue.js` — imperative store plus subscribe
 * callbacks — so components read it through `useSyncExternalStore` instead of
 * each hook instance opening its own EventSource.
 *
 * One EventSource per sector, reference counted: it opens with the first
 * subscriber for that sector and closes with the last. A monitor subscribes to
 * a single sector, so it holds exactly one connection; a panel switching
 * sectors reuses the connection it already has.
 *
 * Reset detection: the server stamps every payload with the sector's `reset_at`
 * marker. A client compares it against the last one it saw and, on a change,
 * drops its local replica — `localStorage` cannot observe a reset performed on
 * another device, and that is what this closes.
 *
 * Two snapshot channels, because consumers cannot tell them apart otherwise:
 *
 *   - `calls`    — the server's *portrait* of the sector, fed by `initialSync`
 *                  and merged into by polling. Consumers reconcile local state
 *                  from it. It is idempotent to re-apply, so a mount cannot
 *                  corrupt anything.
 *   - `lastCall` — an *event*: a call happened just now. Fed only by SSE (and by
 *                  polling once it can prove novelty), cleared on reset and
 *                  when the last subscriber leaves.
 *
 * Conflating the two is what made a consumer re-apply a pre-reset call as the
 * current password on every remount: `initialSync` got an empty list after a
 * reset, so it left the stale `lastCall` in place, and the consumer's fresh
 * `useRef` dedupe passed on its first run.
 */

const EMPTY_SNAPSHOT = Object.freeze({
  connected: false,
  calls: {},
  lastCall: {},
});

let snapshot = EMPTY_SNAPSHOT;
const listeners = new Set();

/** sector -> connection state */
const connections = new Map();
/** sector -> number of active subscribers */
const subscriberCount = new Map();
/** sector -> last reset marker seen */
const lastResetAt = new Map();
/** sectors for which a marker was already seen (the marker itself may be null) */
const seenResetMarker = new Set();
let markersLoaded = false;

function isClient() {
  return typeof window !== "undefined";
}

/* ── reset marker ─────────────────────────────────────────────── */

/**
 * Restore markers from localStorage.
 *
 * Without this, a reload would adopt whatever the server reports and never
 * notice a reset that happened while the tab was closed.
 */
function ensureMarkersLoaded() {
  if (markersLoaded || !isClient()) return;
  markersLoaded = true;

  try {
    const raw = window.localStorage.getItem(RESET_MARKER_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const [sector, value] of Object.entries(parsed)) {
      lastResetAt.set(sector, value ?? null);
      seenResetMarker.add(sector);
    }
  } catch {
    // Corrupted markers: every sector is treated as never seen.
  }
}

function persistMarker(sector, resetAt) {
  if (!isClient()) return;
  try {
    const raw = window.localStorage.getItem(RESET_MARKER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[sector] = resetAt;
    window.localStorage.setItem(RESET_MARKER_KEY, JSON.stringify(parsed));
  } catch {
    // Non-fatal — detection still works for the rest of the session.
  }
}

/**
 * Adopt the first marker seen for a sector, then invalidate on any change.
 *
 * Adoption matters: on a first run the panel has just repopulated localStorage
 * from `/api/queue/recent`, so treating the first marker as a change would wipe
 * it. A marker restored from localStorage is *not* a first run — that is how a
 * reload after a reset the tab never witnessed gets caught.
 *
 * @returns {boolean} true when the local replica was invalidated
 */
function applyResetMarker(sector, resetAt) {
  ensureMarkersLoaded();

  const next = resetAt ?? null;
  const known = seenResetMarker.has(sector);
  const previous = known ? (lastResetAt.get(sector) ?? null) : null;

  lastResetAt.set(sector, next);
  seenResetMarker.add(sector);

  if (!known) {
    persistMarker(sector, next);
    return false;
  }

  if (previous === next) return false;

  persistMarker(sector, next);
  invalidateQueueState(sector);
  // Consumers read the snapshot, not `localStorage` — a portrait taken before
  // the reset would otherwise be replayed on the next mount.
  clearSector(sector);
  return true;
}

/* ── snapshot reads ───────────────────────────────────────────── */

export function getQueueEventsSnapshot() {
  return snapshot;
}

/** Subscribe to snapshot changes (used by `useSyncExternalStore`). */
export function subscribeQueueEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSnapshot(patch) {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  for (const cb of listeners) cb();
}

function setLastCall(sector, call) {
  if (!isClient()) return;
  setSnapshot({ lastCall: { ...snapshot.lastCall, [sector]: call } });
}

function callKey(call) {
  return call?.id ?? `${call?.number}-${call?.type}`;
}

function sameCalls(a, b) {
  if (a.length !== b.length) return false;
  return a.every((call, i) => callKey(call) === callKey(b[i]));
}

/**
 * Store the sector's portrait.
 *
 * Identity is kept when the contents are unchanged: polling runs every few
 * seconds while the SSE is down, and a fresh array each tick would re-run every
 * consumer's reconcile effect — and therefore rewrite `localStorage` — for
 * nothing.
 */
function setCalls(sector, calls) {
  if (!isClient()) return;
  const previous = snapshot.calls[sector];
  if (previous && sameCalls(previous, calls)) return;
  setSnapshot({ calls: { ...snapshot.calls, [sector]: calls } });
}

/** Drop both channels of a sector. */
function clearSector(sector) {
  if (!isClient()) return;
  if (!(sector in snapshot.calls) && !(sector in snapshot.lastCall)) return;
  setSnapshot({
    calls: { ...snapshot.calls, [sector]: null },
    lastCall: { ...snapshot.lastCall, [sector]: null },
  });
}

/**
 * Merge a freshly fetched list into the cached portrait, server order first.
 *
 * Polling only asks for a handful of rows, so replacing the cache would cut the
 * panel's history from 100 entries down to 5.
 */
function mergeCalls(serverCalls, cached) {
  const out = [...serverCalls];
  const seen = new Set(out.map(callKey));
  for (const call of cached ?? []) {
    const key = callKey(call);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

function refreshConnected() {
  const anyOpen = Array.from(connections.values()).some((conn) => conn.open);
  if (anyOpen !== snapshot.connected) {
    setSnapshot({ connected: anyOpen });
  }
}

/* ── server reads ─────────────────────────────────────────────── */

async function fetchRecent(sector, limit) {
  try {
    const res = await fetch(
      `${API_ROUTES.QUEUE_RECENT}?sector=${sector}&limit=${limit}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ── connection lifecycle ─────────────────────────────────────── */

function startPolling(sector, conn) {
  if (conn.pollTimer) return;

  conn.pollTimer = setInterval(async () => {
    if (conn.closed) return;

    const data = await fetchRecent(sector, 5);
    if (!data || conn.closed) return;

    applyResetMarker(sector, data.resetAt);

    const cached = snapshot.calls[sector];
    const latest = data.calls?.[0];
    // A poll payload is a *portrait*, not an event: it only becomes one when
    // the portrait we already hold does not contain that call. Without this,
    // the very first tick after a failed `initialSync` would resurrect the
    // newest pre-reset call as `lastCall`.
    const isNew = Boolean(latest) && cached != null && cached[0]?.id !== latest.id;

    setCalls(sector, mergeCalls(data.calls ?? [], cached));

    if (isNew) {
      conn.lastCallId = latest.id;
      setLastCall(sector, latest);
    }
  }, POLLING_INTERVAL);
}

function stopPolling(conn) {
  if (!conn.pollTimer) return;
  clearInterval(conn.pollTimer);
  conn.pollTimer = null;
}

function teardown(conn) {
  stopPolling(conn);
  if (conn.retryTimer) {
    clearTimeout(conn.retryTimer);
    conn.retryTimer = null;
  }
  if (conn.es) {
    conn.es.close();
    conn.es = null;
  }
  conn.open = false;
  refreshConnected();
}

function connect(sector, conn) {
  if (!isClient() || !sector || conn.closed) return;

  if (conn.es) {
    conn.es.close();
    conn.es = null;
  }

  let es;
  try {
    es = new EventSource(`${API_ROUTES.QUEUE_EVENTS}?sector=${sector}`);
  } catch {
    // EventSource unsupported — polling carries the load.
    conn.open = false;
    startPolling(sector, conn);
    return;
  }

  conn.es = es;

  es.onopen = () => {
    if (conn.closed) return;
    conn.retryCount = 0;
    conn.open = true;
    stopPolling(conn);
    refreshConnected();
  };

  es.onmessage = (event) => {
    if (conn.closed) return;

    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === SSE_EVENT_TYPES.RESET) {
      applyResetMarker(sector, data.resetAt);
      return;
    }

    // Invalidate before applying the call: a reset that immediately precedes a
    // call must clear the stale replica first, then layer the new call on top.
    applyResetMarker(sector, data.resetAt);

    const call = data.call;
    if (!call) return;

    if (data.type === SSE_EVENT_TYPES.CALL) {
      // SSE is an event by definition — the server emitted it just now.
      conn.lastCallId = call.id;
      setLastCall(sector, call);
      setCalls(sector, mergeCalls([call], snapshot.calls[sector]));
    } else if (data.type === SSE_EVENT_TYPES.RECALL) {
      // A recall repeats a call the portrait already carries; `calls` is
      // untouched so a later reconcile cannot rewind it.
      conn.lastCallId = call.id;
      setLastCall(sector, { ...call, isRecall: true });
    }
  };

  es.onerror = () => {
    if (conn.closed) return;

    es.close();
    conn.es = null;
    conn.open = false;
    refreshConnected();

    startPolling(sector, conn);

    const delay = Math.min(
      SSE_BACKOFF_BASE * Math.pow(2, conn.retryCount),
      SSE_BACKOFF_MAX,
    );
    conn.retryCount += 1;

    conn.retryTimer = setTimeout(() => {
      conn.retryTimer = null;
      if (!conn.closed && !conn.es) connect(sector, conn);
    }, delay);
  };
}

/* ── public subscription API ──────────────────────────────────── */

async function initialSync(sector, conn) {
  // The panel is the largest consumer (100 entries); monitors slice to their
  // own limit. One request satisfies both — cheaper than a per-subscriber GET.
  const data = await fetchRecent(sector, HISTORY_LIMITS.painel);
  if (!data || conn.closed) return;

  applyResetMarker(sector, data.resetAt);

  // A portrait, never an event: writing `lastCall` here is what made consumers
  // apply a pre-reset call as the current password on every mount.
  setCalls(sector, Array.isArray(data.calls) ? data.calls : []);

  // Keep the polling dedupe armed even though nothing was announced.
  if (data.calls?.[0]) conn.lastCallId = data.calls[0].id;
}

function ensureConnection(sector) {
  let conn = connections.get(sector);
  if (conn) return conn;

  conn = {
    es: null,
    open: false,
    pollTimer: null,
    retryTimer: null,
    retryCount: 0,
    lastCallId: null,
    closed: false,
  };
  connections.set(sector, conn);

  void initialSync(sector, conn);
  connect(sector, conn);

  return conn;
}

/**
 * Subscribe to realtime events for a sector.
 * @param {string} sector
 * @returns {() => void} unsubscribe
 */
export function subscribeQueueSector(sector) {
  if (!isClient() || !sector) return () => {};

  subscriberCount.set(sector, (subscriberCount.get(sector) ?? 0) + 1);
  const conn = ensureConnection(sector);

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const remaining = (subscriberCount.get(sector) ?? 1) - 1;
    if (remaining > 0) {
      subscriberCount.set(sector, remaining);
      return;
    }

    subscriberCount.delete(sector);
    conn.closed = true;
    connections.delete(sector);
    teardown(conn);
    // The next mount starts from zero: without this, `lastCall` outlived the
    // consumer and the fresh `useRef` dedupe let it replay as the current
    // password.
    clearSector(sector);
  };
}

/** Test seam: forget all connections and markers. */
export function __resetQueueEvents() {
  for (const conn of connections.values()) teardown(conn);
  connections.clear();
  subscriberCount.clear();
  listeners.clear();
  lastResetAt.clear();
  seenResetMarker.clear();
  markersLoaded = false;
  snapshot = EMPTY_SNAPSHOT;
}
