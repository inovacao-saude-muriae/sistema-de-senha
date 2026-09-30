import {
  SECTORS,
  GUICHES,
  QUEUE_KEY,
  SESSION_KEY,
  DEFAULT_SECTOR,
  ALL_SECTORS,
  MAX_QUEUE_NUMBER,
  MIN_QUEUE_NUMBER,
  CALL_TYPES,
  TYPE_FIELDS,
  TYPE_LABELS,
  TYPE_PREFIXES,
  DEFAULT_QUEUE_NUMBER,
  HISTORY_LIMITS,
  NO_PASSWORD,
} from "./constants.js";

export {
  SECTORS,
  GUICHES,
  QUEUE_KEY,
  SESSION_KEY,
  DEFAULT_SECTOR,
  ALL_SECTORS,
  MAX_QUEUE_NUMBER,
  MIN_QUEUE_NUMBER,
  CALL_TYPES,
  TYPE_FIELDS,
  TYPE_LABELS,
  TYPE_PREFIXES,
  NO_PASSWORD,
};

const serverQueueSnapshot = {
  farmacia: {
    normalCurrent: NO_PASSWORD,
    priorityCurrent: NO_PASSWORD,
    history: [],
    historyDate: "",
  },
  recepcao: {
    normalCurrent: NO_PASSWORD,
    priorityCurrent: NO_PASSWORD,
    history: [],
    historyDate: "",
  },
};

let clientQueueSnapshot = null;
let clientQueueRaw = null;
let hasClientQueueSnapshot = false;
let clientSessionSnapshot = null;
let clientSessionRaw = null;

// Usuários movidos para o banco de dados (tabela profiles + auth.users)

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * @param {number | undefined | null} current
 * @returns {number}
 */
export function nextQueueNumber(current = undefined) {
  if (current === undefined || current === null) {
    return MIN_QUEUE_NUMBER;
  }

  const next = Number(current) + 1;
  return next > MAX_QUEUE_NUMBER ? MIN_QUEUE_NUMBER : next;
}

export function formatQueueNumber(number, type = "normal") {
  const prefix =
    type === "preferencial" || type === "preferential"
      ? TYPE_PREFIXES.preferencial
      : TYPE_PREFIXES.normal;
  if (number === null || number === undefined) return `${prefix}---`;
  return `${prefix}${String(Number(number)).padStart(3, "0")}`;
}

export function getInitialState() {
  return {
    farmacia: {
      normalCurrent: NO_PASSWORD,
      priorityCurrent: NO_PASSWORD,
      history: [],
      historyDate: localDateKey(),
    },
    recepcao: {
      normalCurrent: NO_PASSWORD,
      priorityCurrent: NO_PASSWORD,
      history: [],
      historyDate: localDateKey(),
    },
  };
}

export function clearHistoryFromNewDay(state) {
  const today = localDateKey();
  let changed = false;
  const nextState = Object.fromEntries(
    Object.entries(state).map(([sector, queue]) => {
      if (queue.historyDate === today) return [sector, queue];
      changed = true;
      return [
        sector,
        {
          ...queue,
          // PRESERVA os contadores — nunca zera ao mudar de dia
          normalCurrent:
            queue.normalCurrent ?? queue.current ?? NO_PASSWORD,
          priorityCurrent: queue.priorityCurrent ?? NO_PASSWORD,
          // Limpa apenas o histórico visual
          history: [],
          historyDate: today,
        },
      ];
    }),
  );
  if (changed && typeof window !== "undefined")
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(nextState));
  return nextState;
}

export function readQueueState() {
  if (typeof window === "undefined") return getInitialState();
  try {
    const saved = window.localStorage.getItem(QUEUE_KEY);
    return clearHistoryFromNewDay(
      saved ? JSON.parse(saved) : getInitialState(),
    );
  } catch {
    return getInitialState();
  }
}

export function saveQueueState(state) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("queue-updated", { detail: state }));
}

/**
 * Drop a sector's queue back to "no current password" — used when the server
 * queue is reset from another device, which localStorage cannot observe.
 *
 * Deliberately writes through `saveQueueState` instead of calling
 * `localStorage.removeItem`:
 *   1. the `storage` event only fires in *other* tabs, so this tab needs
 *      `queue-updated` to converge;
 *   2. `getQueueSnapshot` memoizes on `clientQueueRaw` and would otherwise hand
 *      back stale data even with the key gone;
 *   3. `subscribeQueue` listens to `queue-updated` and `storage` only.
 *
 * @param {string|null} [sector] single sector, or null for every sector
 */
export function invalidateQueueState(sector = null) {
  clientQueueRaw = null;
  clientQueueSnapshot = null;
  hasClientQueueSnapshot = false;

  const current = readQueueState();
  const targets =
    sector && Object.hasOwn(SECTORS, sector) ? [sector] : Object.keys(SECTORS);

  const next = { ...current };
  for (const s of targets) {
    next[s] = {
      ...normalizeQueue(current[s]),
      normalCurrent: NO_PASSWORD,
      priorityCurrent: NO_PASSWORD,
      history: [],
      historyDate: localDateKey(),
    };
  }

  saveQueueState(next);
}

/**
 * Drop malformed entries and deduplicate by number+type.
 *
 * Locally created items have no `id`, so the id cannot take part in the key.
 * Keeps the *first* occurrence — passing newest-first keeps newest-first.
 *
 * @param {Array<{number:number|string, type:string}>} history
 * @returns {Array}
 */
export function cleanHistory(history = []) {
  if (!Array.isArray(history)) return [];
  const seen = new Set();
  return history.filter((item) => {
    if (item?.number == null) return false;
    const key = `${item.number}-${item.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function historyKey(call) {
  return `${call?.number}-${call?.type}`;
}

/**
 * Local day of an ISO timestamp, in the same format as `localDateKey`.
 *
 * Comparing `createdAt.slice(0, 10)` would use UTC: a call placed at 22:00 in
 * UTC-3 belongs to tomorrow on the wire, and would be dropped as "tomorrow's".
 */
function localDayKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Canonical call shape — the API has emitted both spellings of "preferential". */
function normalizeCalls(calls) {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((call) => call?.number != null)
    .map((call) => ({
      ...call,
      type:
        call.type === CALL_TYPES.PREFERENCIAL || call.type === CALL_TYPES.PREFERENTIAL
          ? CALL_TYPES.PREFERENCIAL
          : CALL_TYPES.NORMAL,
    }));
}

/**
 * Make a sector's local replica agree with the server's post-reset call list.
 *
 * This is the *portrait* path: idempotent, safe to run on every mount and on
 * every snapshot change, and it never announces anything — unlike the live
 * `lastCall` path, which is what makes a monitor speak.
 *
 * Three rules:
 *
 *   1. empty list → the sector has no calls since its reset, so anything local
 *      is pre-reset residue and gets dropped. This is the branch that keeps
 *      `---` on screen after a reset performed on another device.
 *   2. non-empty but every call predates today → nothing to do. The daily
 *      rollover (`clearHistoryFromNewDay`) deliberately clears the visual
 *      history while keeping the counters, and `getRecentCalls` filters by
 *      `reset_at`, not by day — writing the server's list here would resurrect
 *      yesterday's history.
 *   3. otherwise → adopt `todays[0]` as the current password **only** when it
 *      is absent from the local history. See the race guard below.
 *
 * The race guard: `callNextNumber` writes the number to `localStorage` before
 * the server confirms it (see `saveQueueState` just above), so a portrait that
 * predates the commit would otherwise revert the call the user just made. If
 * the portrait already contains `calls[0]`, this client knows that call —
 * whatever is newest is the password it just wrote, not the portrait.
 *
 * History is *merged*, never replaced, and monotonically so: an entry already
 * applied locally can only disappear if the server says it is pre-reset, which
 * case 1 handles.
 *
 * @param {string} sector
 * @param {Array} calls newest-first, already filtered by `reset_at`
 * @param {{ historyLimit?: number }} [options]
 */
export function reconcileQueueFromCalls(
  sector,
  calls,
  { historyLimit = HISTORY_LIMITS.painel } = {},
) {
  if (!sector || !Object.hasOwn(SECTORS, sector)) return;

  const server = normalizeCalls(calls);
  const current = readQueueState();
  const local = normalizeQueue(current[sector]);

  if (server.length === 0) {
    const clean =
      local.normalCurrent === NO_PASSWORD &&
      local.priorityCurrent === NO_PASSWORD &&
      local.history.length === 0;
    if (clean) return; // already `---`: no point waking every subscriber up
    invalidateQueueState(sector);
    return;
  }

  // Entries without a date are kept: payloads predating this field (and the
  // tests that build calls by hand) must not silently fall into case 2.
  const todays = server.filter(
    (call) => !call.createdAt || localDayKey(call.createdAt) === localDateKey(),
  );
  if (todays.length === 0) return; // case 2

  const newest = todays[0];
  const known = new Set(local.history.map(historyKey));
  const adopt = !known.has(historyKey(newest));
  const field = TYPE_FIELDS[newest.type] ?? TYPE_FIELDS.normal;

  saveQueueState({
    ...current,
    [sector]: {
      ...local,
      [field]: adopt ? newest.number : local[field],
      history: cleanHistory([...todays, ...local.history]).slice(0, historyLimit),
    },
  });
}

export function readSession() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function normalizeQueue(queue) {
  return {
    normalCurrent: queue?.normalCurrent ?? queue?.current ?? NO_PASSWORD,
    priorityCurrent: queue?.priorityCurrent ?? NO_PASSWORD,
    history: queue?.history ?? [],
    historyDate: queue?.historyDate ?? localDateKey(),
  };
}

export async function withQueueLock(callback) {
  if (navigator?.locks?.request)
    return navigator.locks.request(
      "saude-queue-call",
      { mode: "exclusive" },
      callback,
    );
  const lockKey = `${QUEUE_KEY}-lock`;
  const token = `${Date.now()}-${Math.random()}`;
  while (true) {
    const raw = window.localStorage.getItem(lockKey) || "";
    const lockTime = Number(String(raw).split(":")[0] || 0);
    if (!lockTime || Date.now() - lockTime > 3000) {
      window.localStorage.setItem(lockKey, `${Date.now()}:${token}`);
      if (window.localStorage.getItem(lockKey)?.endsWith(token)) break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  try {
    return await callback();
  } finally {
    if (window.localStorage.getItem(lockKey)?.endsWith(token))
      window.localStorage.removeItem(lockKey);
  }
}

// Bip desativado permanentemente
export function playCallAlert() {
  return;
}

export function subscribeQueue(callback) {
  window.addEventListener("queue-updated", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("queue-updated", callback);
    window.removeEventListener("storage", callback);
  };
}

export function getQueueSnapshot() {
  const raw = window.localStorage.getItem(QUEUE_KEY);
  if (raw === clientQueueRaw && hasClientQueueSnapshot)
    return clientQueueSnapshot;
  clientQueueSnapshot = readQueueState();
  // readQueueState pode normalizar o estado do dia e atualizar o localStorage.
  clientQueueRaw = window.localStorage.getItem(QUEUE_KEY);
  hasClientQueueSnapshot = true;
  return clientQueueSnapshot;
}

export function getServerQueueSnapshot() {
  return serverQueueSnapshot;
}

export function subscribeSession(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function getSessionSnapshot() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (raw === clientSessionRaw) return clientSessionSnapshot;
  clientSessionRaw = raw;
  clientSessionSnapshot = readSession();
  return clientSessionSnapshot;
}

export function getServerSessionSnapshot() {
  return null;
}

export async function callNextNumber({ sector, type }) {
  return withQueueLock(async () => {
    let next = null;
    try {
      const res = await fetch("/api/queue/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector, type }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.useLocal) {
          const ls = normalizeQueue(readQueueState()[sector]);
          next = type === "preferencial"
            ? nextQueueNumber(ls.priorityCurrent)
            : nextQueueNumber(ls.normalCurrent);
        } else {
          return { ok: false, error: data.error || "Erro ao conectar à sequência central." };
        }
      } else {
        next = Number(data.number);
      }
    } catch {
      const ls = normalizeQueue(readQueueState()[sector]);
      next = type === "preferencial"
        ? nextQueueNumber(ls.priorityCurrent)
        : nextQueueNumber(ls.normalCurrent);
    }

    next = Number(next);
    if (!Number.isInteger(next) || next < MIN_QUEUE_NUMBER || next > MAX_QUEUE_NUMBER) {
      return { ok: false, error: "Número de senha inválido." };
    }

    const latest = readQueueState();
    const q = normalizeQueue(latest[sector]);
    const field = type === "preferencial" ? "priorityCurrent" : "normalCurrent";

    saveQueueState({
      ...latest,
      [sector]: { ...q, [field]: next },
    });

    return { ok: true, next, type };
  });
}
