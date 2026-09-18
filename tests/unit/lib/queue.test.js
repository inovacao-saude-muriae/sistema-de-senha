import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SECTORS,
  GUICHES,
  QUEUE_KEY,
  SESSION_KEY,
  formatQueueNumber,
  nextQueueNumber,
  getInitialState,
  readQueueState,
  saveQueueState,
  clearMonitorHistory,
  readSession,
  normalizeQueue,
  clearHistoryFromNewDay,
  subscribeQueue,
  withQueueLock,
  getQueueSnapshot,
  getSessionSnapshot,
  subscribeSession,
  NO_PASSWORD,
} from "@/lib/queue";

describe("SECTORS / GUICHES / keys", () => {
  it("define os dois setores esperados", () => {
    expect(Object.keys(SECTORS)).toEqual(["farmacia", "recepcao"]);
    expect(SECTORS.farmacia.name).toBe("Farmácia");
    expect(SECTORS.recepcao.name).toBe("Recepção Saúde");
  });

  it("define os guichês", () => {
    expect(GUICHES.map((g) => g.id)).toEqual([
      "none",
      "guiche-1",
      "guiche-2",
      "guiche-3",
      "guiche-4",
    ]);
  });

  it("expõe as chaves de storage", () => {
    expect(QUEUE_KEY).toBe("saude-queue-state");
    expect(SESSION_KEY).toBe("saude-attendant-session");
  });
});

describe("nextQueueNumber", () => {
  it("incrementa de forma simples", () => {
    expect(nextQueueNumber(0)).toBe(1);
    expect(nextQueueNumber(5)).toBe(6);
  });

  it("volta para 0 após 999", () => {
    expect(nextQueueNumber(998)).toBe(999);
    expect(nextQueueNumber(999)).toBe(0);
    expect(nextQueueNumber(1000)).toBe(0);
  });

  it("trata valor ausente como 0 (primeira senha = 000)", () => {
    expect(nextQueueNumber()).toBe(0);
    expect(nextQueueNumber(null)).toBe(0);
    expect(nextQueueNumber(undefined)).toBe(0);
  });
});

describe("formatQueueNumber", () => {
  it("prefixa normal com N", () => {
    expect(formatQueueNumber(1, "normal")).toBe("N001");
    expect(formatQueueNumber(42)).toBe("N042");
  });

  it("prefixa preferencial com P (aceita os dois nomes)", () => {
    expect(formatQueueNumber(7, "preferencial")).toBe("P007");
    expect(formatQueueNumber(7, "preferential")).toBe("P007");
  });

  it("trata 1000 como string '1000'", () => {
    expect(formatQueueNumber(1000, "normal")).toBe("N1000");
    expect(formatQueueNumber(1000, "preferencial")).toBe("P1000");
  });

  it("retorna '---' para null/undefined (sem senha)", () => {
    expect(formatQueueNumber(null, "normal")).toBe("N---");
    expect(formatQueueNumber(null, "preferencial")).toBe("P---");
    expect(formatQueueNumber(undefined, "normal")).toBe("N---");
    expect(formatQueueNumber(undefined, "preferencial")).toBe("P---");
  });
});

describe("getInitialState", () => {
  it("retorna estado com null (sem senha) e historyDate de hoje", () => {
    const state = getInitialState();
    expect(state.farmacia.normalCurrent).toBeNull();
    expect(state.farmacia.priorityCurrent).toBeNull();
    expect(state.farmacia.history).toEqual([]);
    expect(state.farmacia.historyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.recepcao.normalCurrent).toBeNull();
  });
});

describe("normalizeQueue", () => {
  it("preenche defaults (null = sem senha) quando faltam campos", () => {
    expect(normalizeQueue(undefined)).toEqual({
      normalCurrent: null,
      priorityCurrent: null,
      history: [],
      historyDate: expect.any(String),
    });
  });

  it("suporta o campo legado 'current'", () => {
    const q = normalizeQueue({ current: 12, history: [{ n: 1 }] });
    expect(q.normalCurrent).toBe(12);
    expect(q.priorityCurrent).toBeNull();
  });
});

describe("readQueueState / saveQueueState / clearMonitorHistory", () => {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  it("retorna estado inicial quando storage vazio", () => {
    const state = readQueueState();
    expect(state.farmacia.normalCurrent).toBeNull();
    expect(state.farmacia.historyDate).toBe(todayKey);
  });

  it("salva e relê o estado", () => {
    const state = getInitialState();
    state.farmacia.normalCurrent = 44;
    saveQueueState(state);

    const read = readQueueState();
    expect(read.farmacia.normalCurrent).toBe(44);
  });

  it("dispatch de 'queue-updated' ao salvar", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    saveQueueState(getInitialState());
    expect(spy).toHaveBeenCalled();
    const evt = spy.mock.calls[0][0];
    expect(evt.type).toBe("queue-updated");
    spy.mockRestore();
  });

  it("limpa apenas o histórico do setor mantendo contadores", () => {
    const state = getInitialState();
    state.farmacia.normalCurrent = 10;
    state.farmacia.history = [{ number: 10, type: "normal" }];
    saveQueueState(state);

    clearMonitorHistory("farmacia");
    const read = readQueueState();
    expect(read.farmacia.normalCurrent).toBe(10);
    expect(read.farmacia.history).toEqual([]);
  });
});

describe("clearHistoryFromNewDay", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("limpa histórico quando a data mudou", () => {
    const oldDate = "2020-01-01";
    const state = {
      farmacia: {
        normalCurrent: 5,
        priorityCurrent: 2,
        history: [{ number: 1 }],
        historyDate: oldDate,
      },
    };
    const next = clearHistoryFromNewDay(state);
    expect(next.farmacia.history).toEqual([]);
    expect(next.farmacia.normalCurrent).toBe(5);
    expect(next.farmacia.historyDate).not.toBe(oldDate);
  });

  it("não altera estado quando a data é hoje", () => {
    const state = getInitialState();
    state.farmacia.history = [{ number: 1 }];
    const next = clearHistoryFromNewDay(state);
    expect(next.farmacia.history).toEqual([{ number: 1 }]);
  });
});

describe("readSession", () => {
  it("retorna null sem sessão", () => {
    expect(readSession()).toBeNull();
  });

  it("ler sessão salva", () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ id: "u1", name: "João" }),
    );
    expect(readSession()).toEqual({ id: "u1", name: "João" });
  });

  it("retorna null em JSON inválido", () => {
    window.localStorage.setItem(SESSION_KEY, "not-json");
    expect(readSession()).toBeNull();
  });
});

describe("subscribeQueue", () => {
  it("retorna função de unsubscribe", () => {
    const unsub = subscribeQueue(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

describe("withQueueLock", () => {
  it("usa navigator.locks quando disponível", async () => {
    const request = vi.fn().mockImplementation(async (_n, _o, cb) => cb());
    navigator.locks.request = request;
    const result = await withQueueLock(async () => "ok");
    expect(result).toBe("ok");
    expect(request).toHaveBeenCalledWith(
      "saude-queue-call",
      { mode: "exclusive" },
      expect.any(Function),
    );
  });

  it("fallback: adquire lock e remove ao final", async () => {
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
    const cb = vi.fn().mockResolvedValue("done");
    const result = await withQueueLock(cb);
    expect(result).toBe("done");
    expect(window.localStorage.getItem("saude-queue-state-lock")).toBeNull();
  });

  it("fallback: espera lock expirado e não libera o de outros", async () => {
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
    vi.useFakeTimers();
    try {
      const lockKey = "saude-queue-state-lock";
      window.localStorage.setItem(lockKey, `${Date.now() - 4000}:other-token`);
      let resolved = false;
      const p = withQueueLock(async () => {
        resolved = true;
        return "won";
      });
      await p;
      expect(resolved).toBe(true);
      // lock de outro dono não foi removido indevidamente
      expect(window.localStorage.getItem(lockKey)).not.toBe("other-token");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getQueueSnapshot / getSessionSnapshot (cache)", () => {
  it("retorna mesma referência quando raw não muda", () => {
    const state = getInitialState();
    saveQueueState(state);
    const first = getQueueSnapshot();
    const second = getQueueSnapshot();
    expect(first).toBe(second);
  });

  it("invalida cache quando raw muda", () => {
    const state = getInitialState();
    state.farmacia.normalCurrent = 1;
    saveQueueState(state);
    const first = getQueueSnapshot();

    state.farmacia.normalCurrent = 2;
    saveQueueState(state);
    const second = getQueueSnapshot();

    expect(first.farmacia.normalCurrent).toBe(1);
    expect(second.farmacia.normalCurrent).toBe(2);
    expect(first).not.toBe(second);
  });

  it("getSessionSnapshot retorna null sem storage", () => {
    expect(getSessionSnapshot()).toBeNull();
  });

  it("subscribeSession retorna unsubscribe", () => {
    const unsub = subscribeSession(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });
});