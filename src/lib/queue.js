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

// Limpa apenas as chamadas visíveis no monitor mantendo os contadores intactos
export function clearMonitorHistory(sector) {
  const state = readQueueState();
  if (state[sector]) {
    const updated = {
      ...state,
      [sector]: {
        ...state[sector],
        history: [],
      },
    };
    saveQueueState(updated);
  }
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
