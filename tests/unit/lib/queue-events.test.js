import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  subscribeQueueSector,
  subscribeQueueEvents,
  getQueueEventsSnapshot,
  __resetQueueEvents,
} from "@/lib/queue-events";
import { RESET_MARKER_KEY, SSE_EVENT_TYPES } from "@/lib/constants";
import {
  getInitialState,
  normalizeQueue,
  readQueueState,
  reconcileQueueFromCalls,
  saveQueueState,
} from "@/lib/queue";

/**
 * Doubles de EventSource. Cada instância é registrada em `instances` para que
 * o teste possa disparar onopen/onmessage/onerror manualmente.
 */
class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    FakeEventSource.instances.push(this);
  }

  static latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function queueCalls(sector = "farmacia", count = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `call-${i + 1}`,
    number: 40 + i,
    type: "normal",
    time: "14:30",
  }));
}

/** Enfileira respostas de /api/queue/recent, uma por chamada. */
function stubFetch({ calls = [], resetAt = null, fail = false } = {}) {
  const queue = [...calls];
  return vi.fn(async () => {
    if (fail) return { ok: false, status: 500 };
    const next = queue.shift() ?? { calls: [], resetAt };
    return { ok: true, json: async () => next };
  });
}

/**
 * Espelha o `?? null` de `useQueueEvents`: o snapshot grava `null` ao limpar,
 * mas uma chave que nunca foi tocada não existe.
 */
const portraitOf = (sector) => getQueueEventsSnapshot().calls[sector] ?? null;
const lastEventOf = (sector) => getQueueEventsSnapshot().lastCall[sector] ?? null;

function seedQueue(sector, number) {
  const state = getInitialState();
  state[sector] = {
    ...state[sector],
    normalCurrent: number,
    history: [{ number, type: "normal", time: "14:30" }],
  };
  saveQueueState(state);
}

describe("queue-events (singleton)", () => {
  beforeEach(() => {
    __resetQueueEvents();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetQueueEvents();
  });

  describe("conexão", () => {
    it("abre uma conexão por setor assinante", () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(FakeEventSource.latest().url).toContain("sector=farmacia");

      unsub();
    });

    it("um segundo assinante do mesmo setor reusa a conexão", () => {
      global.fetch = stubFetch();
      const unsubA = subscribeQueueSector("farmacia");
      const unsubB = subscribeQueueSector("farmacia");

      expect(FakeEventSource.instances).toHaveLength(1);

      unsubA();
      expect(FakeEventSource.instances).toHaveLength(1);

      unsubB();
    });

    it("mantém a conexão enquanto houver ao menos um assinante", () => {
      global.fetch = stubFetch();
      const unsubA = subscribeQueueSector("farmacia");
      const unsubB = subscribeQueueSector("farmacia");

      unsubA();
      const es = FakeEventSource.latest();
      expect(es.closed).toBe(false);

      unsubB();
      expect(es.closed).toBe(true);
    });

    it("setores diferentes abrem conexões separadas", () => {
      global.fetch = stubFetch();
      const unsubA = subscribeQueueSector("farmacia");
      const unsubB = subscribeQueueSector("recepcao");

      expect(FakeEventSource.instances).toHaveLength(2);
      const urls = FakeEventSource.instances.map((es) => es.url).join(" ");
      expect(urls).toContain("sector=farmacia");
      expect(urls).toContain("sector=recepcao");

      unsubA();
      unsubB();
    });

    it("unsubscribe idempotente não fecha a conexão de outro assinante", () => {
      global.fetch = stubFetch();
      const unsubA = subscribeQueueSector("farmacia");
      const unsubB = subscribeQueueSector("farmacia");

      unsubA();
      unsubA(); // segunda chamada não deve derrubar a conexão de B

      expect(FakeEventSource.latest().closed).toBe(false);
      unsubB();
    });

    it("só marca connected após o stream abrir", () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");

      expect(getQueueEventsSnapshot().connected).toBe(false);

      FakeEventSource.latest().open();
      expect(getQueueEventsSnapshot().connected).toBe(true);

      unsub();
      expect(getQueueEventsSnapshot().connected).toBe(false);
    });
  });

  describe("snapshot", () => {
    it("expõe lastCall por setor", () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "x", number: 7, type: "normal", time: "14:30" },
        resetAt: null,
      });

      expect(getQueueEventsSnapshot().lastCall.farmacia.number).toBe(7);
      unsub();
    });

    it("marca recall com isRecall", () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.RECALL,
        call: { id: "x", number: 7, type: "normal", time: "14:30" },
        resetAt: null,
      });

      expect(getQueueEventsSnapshot().lastCall.farmacia.isRecall).toBe(true);
      unsub();
    });

    it("notifica assinantes do snapshot", () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");
      const listener = vi.fn();
      const unsubSnap = subscribeQueueEvents(listener);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "x", number: 7, type: "normal", time: "14:30" },
        resetAt: null,
      });

      expect(listener).toHaveBeenCalled();
      unsubSnap();
      unsub();
    });

    it("mantém a referência do snapshot estável sem mudanças", () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");

      const before = getQueueEventsSnapshot();
      expect(getQueueEventsSnapshot()).toBe(before);

      unsub();
    });

    it("initialSync preenche o retrato e deixa lastCall null", async () => {
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ calls: queueCalls(), resetAt: null }),
      }));
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      expect(portraitOf("farmacia")).toHaveLength(1);
      // Um retrato não é um evento. Escrever `lastCall` aqui faria o consumidor
      // — e o áudio do monitor — tratar a chamada mais antiga conhecida como se
      // tivesse acabado de acontecer, a cada montagem.
      expect(lastEventOf("farmacia")).toBeNull();

      unsub();
    });

    it("recall não mexe no retrato", async () => {
      global.fetch = stubFetch({ calls: [], resetAt: null });
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "c1", number: 40, type: "normal", time: "14:30" },
        resetAt: null,
      });
      expect(getQueueEventsSnapshot().calls.farmacia).toHaveLength(1);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.RECALL,
        call: { id: "c1", number: 40, type: "normal", time: "14:30" },
        resetAt: null,
      });

      expect(getQueueEventsSnapshot().lastCall.farmacia.isRecall).toBe(true);
      // Repetição de uma chamada que o retrato já tem: um prepend duplicaria a
      // entrada e um reconcile posterior a chamaria de nova.
      expect(getQueueEventsSnapshot().calls.farmacia).toHaveLength(1);

      unsub();
    });
  });

  describe("retrato (calls) via polling", () => {
    it("initialSync busca HISTORY_LIMITS.painel (100) para caber no histórico do painel", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ calls: [], resetAt: null }),
      }));
      global.fetch = fetchMock;

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      expect(String(fetchMock.mock.calls[0][0])).toContain("limit=100");
      unsub();
    });

    it("faz merge em vez de substituir — não trunca o histórico de 100", async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({
        id: `c${100 - i}`,
        number: 100 - i,
        type: "normal",
        time: "14:30",
      }));
      let servedPortrait = false;
      global.fetch = vi.fn(async (url) => {
        if (!String(url).includes("/api/queue/recent")) return { ok: false };
        if (!servedPortrait) {
          servedPortrait = true;
          return { ok: true, json: async () => ({ calls: full, resetAt: null }) };
        }
        // O polling pede só 5 linhas.
        return { ok: true, json: async () => ({ calls: full.slice(0, 5), resetAt: null }) };
      });

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);
      expect(getQueueEventsSnapshot().calls.farmacia).toHaveLength(100);

      FakeEventSource.latest().onerror();
      await vi.advanceTimersByTimeAsync(3000);

      expect(getQueueEventsSnapshot().calls.farmacia).toHaveLength(100);
      unsub();
    });

    it("poll idêntico não troca a identidade do snapshot", async () => {
      global.fetch = stubFetch({ calls: queueCalls(), resetAt: null });
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      FakeEventSource.latest().onerror();
      await vi.advanceTimersByTimeAsync(0);
      const before = getQueueEventsSnapshot();

      // Sem mudança de conteúdo não pode haver nova identidade: consumidores
      // releriam o retrato, e o effect de reconciliação reescreveria o
      // localStorage a cada 3s enquanto o SSE estiver fora.
      await vi.advanceTimersByTimeAsync(3000);
      expect(getQueueEventsSnapshot()).toBe(before);
      unsub();
    });

    it("quando o initialSync falha, o polling preenche o retrato sem emitir lastCall", async () => {
      let call = 0;
      global.fetch = vi.fn(async (url) => {
        if (!String(url).includes("/api/queue/recent")) return { ok: false };
        call += 1;
        if (call === 1) return { ok: false }; // o sync inicial falhou
        return { ok: true, json: async () => ({ calls: queueCalls(), resetAt: null }) };
      });

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);
      // O sync inicial falhou, então ninguém escreveu nada ainda.
      expect(portraitOf("farmacia")).toBeNull();

      FakeEventSource.latest().onerror();
      await vi.advanceTimersByTimeAsync(3000);

      // Sem retrato anterior não há como provar novidade — e uma chamada velha
      // não pode virar `lastCall` só porque o sync inicial não chegou.
      expect(portraitOf("farmacia")).toHaveLength(1);
      expect(lastEventOf("farmacia")).toBeNull();
      unsub();
    });

    it("retrato é isolado por setor", async () => {
      global.fetch = vi.fn(async (url) => {
        const sector = String(url).match(/sector=(\w+)/)?.[1];
        return {
          ok: true,
          json: async () => ({
            calls: [{ id: `${sector}-1`, number: 40, type: "normal", time: "14:30" }],
            resetAt: null,
          }),
        };
      });

      const unsubA = subscribeQueueSector("farmacia");
      const unsubB = subscribeQueueSector("recepcao");
      await vi.advanceTimersByTimeAsync(0);

      expect(portraitOf("farmacia")[0].id).toBe("farmacia-1");
      expect(portraitOf("recepcao")[0].id).toBe("recepcao-1");

      unsubA();
      expect(portraitOf("farmacia")).toBeNull();
      expect(portraitOf("recepcao")).toHaveLength(1);

      unsubB();
    });
  });

  describe("detecção de reset", () => {
    it("primeiro marcador é adotado sem invalidar", async () => {
      global.fetch = stubFetch({ calls: queueCalls(), resetAt: "2026-01-01T00:00:00.000Z" });
      seedQueue("farmacia", 42);

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      // A fila population pelo painel não pode ser apagada na primeira leitura.
      expect(readQueueState().farmacia.normalCurrent).toBe(42);
      unsub();
    });

    it("marcador diferente invalida a réplica local", async () => {
      global.fetch = stubFetch({ calls: queueCalls(), resetAt: null });
      seedQueue("farmacia", 42);

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);
      expect(readQueueState().farmacia.normalCurrent).toBe(42);

      // O servidor foi resetado em outro dispositivo.
      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "novo", number: 1, type: "normal", time: "15:00" },
        resetAt: "2026-09-30T10:00:00.000Z",
      });

      const state = readQueueState().farmacia;
      // `---` é o estado esperado logo após um reset.
      expect(state.normalCurrent).toBeNull();
      expect(state.priorityCurrent).toBeNull();
      expect(state.history).toEqual([]);

      unsub();
    });

    it("invalida ANTES de aplicar a chamada subsequente", async () => {
      global.fetch = stubFetch({ calls: [], resetAt: "2026-09-30T09:00:00.000Z" });
      seedQueue("farmacia", 42);

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      // Reset + chamada no mesmo instante: a fila antiga não pode sobreviver.
      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "novo", number: 3, type: "normal", time: "15:00" },
        resetAt: "2026-09-30T10:00:00.000Z",
      });

      expect(readQueueState().farmacia.normalCurrent).toBeNull();
      // A chamada em si segue disponível para o consumidor aplicar.
      expect(getQueueEventsSnapshot().lastCall.farmacia.number).toBe(3);
      unsub();
    });

    it("evento de reset dedicado também invalida", async () => {
      global.fetch = stubFetch({ calls: [], resetAt: null });
      seedQueue("farmacia", 42);

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.RESET,
        resetAt: "2026-09-30T11:00:00.000Z",
      });

      expect(readQueueState().farmacia.normalCurrent).toBeNull();
      unsub();
    });

    it("marcador igual não invalida de novo", async () => {
      global.fetch = stubFetch({ calls: [], resetAt: "2026-09-30T10:00:00.000Z" });
      seedQueue("farmacia", 42);

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      // Adota o marcador.
      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "a", number: 1, type: "normal", time: "15:00" },
        resetAt: "2026-09-30T10:00:00.000Z",
      });
      seedQueue("farmacia", 99);

      // Mesma chamada, mesmo marcador: nada a invalidar.
      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "b", number: 2, type: "normal", time: "15:01" },
        resetAt: "2026-09-30T10:00:00.000Z",
      });

      expect(readQueueState().farmacia.normalCurrent).toBe(99);
      unsub();
    });

    it("polling detecta reset quando o SSE está fora", async () => {
      const fetchMock = vi.fn(async (url) => {
        if (String(url).includes("/api/queue/recent")) {
          const state = fetchMock.mock.calls.length;
          // 1ª chamada: sync inicial, sem reset. 2ª em diante: já resetado.
          const resetAt = state <= 1 ? null : "2026-09-30T12:00:00.000Z";
          return {
            ok: true,
            json: async () => ({ calls: [], resetAt }),
          };
        }
        return { ok: false };
      });
      global.fetch = fetchMock;

      seedQueue("farmacia", 42);
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      // Simula a queda do SSE: o polling assume.
      FakeEventSource.latest().onerror();

      await vi.advanceTimersByTimeAsync(3000);

      expect(readQueueState().farmacia.normalCurrent).toBeNull();
      unsub();
    });

    it("marcador persistido detecta reset ocorrido com a aba fechada", async () => {
      // Simula uma sessão anterior que viu o marcador antigo.
      window.localStorage.setItem(
        RESET_MARKER_KEY,
        JSON.stringify({ farmacia: "2026-09-30T08:00:00.000Z" }),
      );
      seedQueue("farmacia", 42);

      // Nova sessão: o servidor já reporta o reset.
      global.fetch = stubFetch({ calls: [], resetAt: "2026-09-30T13:00:00.000Z" });
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      expect(readQueueState().farmacia.normalCurrent).toBeNull();
      unsub();
    });

    it("não invalida setores que o cliente não assinou", async () => {
      global.fetch = stubFetch({ calls: [], resetAt: null });
      seedQueue("farmacia", 42);
      seedQueue("recepcao", 77);

      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "n", number: 1, type: "normal", time: "15:00" },
        resetAt: "2026-09-30T10:00:00.000Z",
      });

      const state = readQueueState();
      expect(state.farmacia.normalCurrent).toBeNull();
      expect(state.recepcao.normalCurrent).toBe(77);

      unsub();
    });
  });

  describe("regressão: senha atual reaplicada na remontagem", () => {
    /**
     * Espelha o effect ao vivo de `painel/page.js:107-135` — o consumidor só
     * lê `lastCall`, então a lógica mora dentro do componente e é extraída
     * aqui (mesmo procedimento de `admin-reset-order.test.js`).
     *
     * @returns {boolean} false quando não havia nada a aplicar
     */
    function applyLiveCall(sector, lastCall) {
      if (!lastCall) return false;

      const latestState = readQueueState();
      const latest = normalizeQueue(latestState[sector]);
      const callType = lastCall.type === "preferencial" ? "preferencial" : "normal";
      const field = callType === "preferencial" ? "priorityCurrent" : "normalCurrent";

      saveQueueState({
        ...latestState,
        [sector]: {
          ...latest,
          [field]: lastCall.number,
          history: [
            { number: lastCall.number, type: callType, time: lastCall.time },
            ...latest.history,
          ],
        },
      });
      return true;
    }

    it("não reaplica a última senha pré-reset ao remontar o consumidor", async () => {
      // Fase 1: servidor com chamadas. Fase 2: servidor já resetado.
      const RESET_AT = "2026-09-30T10:00:00.000Z";
      let phase = 1;
      global.fetch = vi.fn(async (url) => {
        if (!String(url).includes("/api/queue/recent")) return { ok: false };
        return {
          ok: true,
          json: async () =>
            phase === 1
              ? { calls: queueCalls("farmacia", 1), resetAt: null }
              : { calls: [], resetAt: RESET_AT },
        };
      });

      // 1. montagem + chamada ao vivo: o SSE é quem preenche `lastCall`.
      const unsubFirst = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);
      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "c40", number: 40, type: "normal", time: "14:30" },
        resetAt: null,
      });
      applyLiveCall("farmacia", lastEventOf("farmacia"));
      expect(readQueueState().farmacia.normalCurrent).toBe(40);

      // 2. o usuário vai para o admin: o consumidor desmonta e a conexão fecha.
      unsubFirst();

      // 3. o admin resetou e o consumidor volta.
      phase = 2;
      const unsubSecond = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      // O retrato pós-reset está vazio...
      expect(portraitOf("farmacia")).toEqual([]);
      // ...e não sobrou nenhum evento para reaplicar.
      expect(lastEventOf("farmacia")).toBeNull();

      // Ambos os effects do componente rodam numa montagem de verdade: o ao
      // vivo encontra `lastCall` nulo, o de reconciliação encontra retrato vazio.
      applyLiveCall("farmacia", lastEventOf("farmacia"));
      reconcileQueueFromCalls("farmacia", portraitOf("farmacia"));

      expect(readQueueState().farmacia.normalCurrent).toBeNull();
      expect(readQueueState().farmacia.priorityCurrent).toBeNull();
      expect(readQueueState().farmacia.history).toEqual([]);

      unsubSecond();
    });

    it("reset durante a assinatura zera os dois canais", async () => {
      global.fetch = stubFetch({ calls: [], resetAt: null });
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "c1", number: 40, type: "normal", time: "14:30" },
        resetAt: null,
      });
      expect(lastEventOf("farmacia")).toBeTruthy();
      expect(portraitOf("farmacia")).toHaveLength(1);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.RESET,
        resetAt: "2026-09-30T10:00:00.000Z",
      });

      // Sensível a `applyResetMarker` não limpar o snapshot: o consumidor lê
      // o snapshot, não o `localStorage`.
      expect(lastEventOf("farmacia")).toBeNull();
      expect(portraitOf("farmacia")).toBeNull();

      unsub();
    });

    it("o último unsubscribe limpa os dois canais", async () => {
      global.fetch = stubFetch({ calls: queueCalls(), resetAt: null });
      const unsub = subscribeQueueSector("farmacia");
      await vi.advanceTimersByTimeAsync(0);

      FakeEventSource.latest().emit({
        type: SSE_EVENT_TYPES.CALL,
        call: { id: "c1", number: 40, type: "normal", time: "14:30" },
        resetAt: null,
      });
      expect(lastEventOf("farmacia")).toBeTruthy();
      expect(portraitOf("farmacia")).toHaveLength(1);

      // Um `useRef` novo nasce `null` a cada montagem, então a dedupe do
      // componente não protege: o que impede o replay é não sobrar nada aqui.
      unsub();
      expect(lastEventOf("farmacia")).toBeNull();
      expect(portraitOf("farmacia")).toBeNull();
    });
  });

  describe("fallback e reconexão", () => {
    it("sobe polling quando o SSE falha", async () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");
      const es = FakeEventSource.latest();

      es.open();
      const baseline = fetchMockCallCount();

      es.onerror();
      await vi.advanceTimersByTimeAsync(9000);

      expect(fetchMockCallCount()).toBeGreaterThan(baseline);
      unsub();
    });

    it("para o polling quando o SSE volta", async () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");
      const es = FakeEventSource.latest();

      es.onerror();
      await vi.advanceTimersByTimeAsync(9000);
      const whileDown = fetchMockCallCount();

      es.open();
      await vi.advanceTimersByTimeAsync(9000);

      // Sem SSE o polling não deve acrescentar requisições.
      expect(fetchMockCallCount()).toBe(whileDown);
      unsub();
    });

    it("reconecta com backoff após erro", async () => {
      global.fetch = stubFetch();
      const unsub = subscribeQueueSector("farmacia");
      const first = FakeEventSource.latest();

      first.onerror();
      await vi.advanceTimersByTimeAsync(1000);

      expect(FakeEventSource.instances.length).toBeGreaterThan(1);
      unsub();
    });
  });
});

function fetchMockCallCount() {
  return global.fetch?.mock?.calls?.length ?? 0;
}
