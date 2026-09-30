import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventManager } from "../../../src/lib/event-manager.js";

describe("EventManager", () => {
  let manager;

  beforeEach(() => {
    manager = new EventManager();
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  describe("emitQueueCall()", () => {
    it("emite evento para o setor correto", () => {
      const callback = vi.fn();
      manager.subscribeToQueue("farmacia", callback);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueCall("farmacia", call);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(call, null);
    });

    it("encaminha o marcador de reset como segundo argumento", () => {
      const callback = vi.fn();
      manager.subscribeToQueue("farmacia", callback);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueCall("farmacia", call, "2026-09-30T10:00:00.000Z");

      expect(callback).toHaveBeenCalledWith(call, "2026-09-30T10:00:00.000Z");
    });

    it("não emite para outros setores", () => {
      const callback = vi.fn();
      manager.subscribeToQueue("farmacia", callback);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueCall("recepcao", call);

      expect(callback).not.toHaveBeenCalled();
    });

    it("emite para múltiplos subscribers do mesmo setor", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      manager.subscribeToQueue("farmacia", callback1);
      manager.subscribeToQueue("farmacia", callback2);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueCall("farmacia", call);

      expect(callback1).toHaveBeenCalledOnce();
      expect(callback2).toHaveBeenCalledOnce();
    });
  });

  describe("subscribeToQueue()", () => {
    it("retorna uma função de unsubscribe", () => {
      const unsub = manager.subscribeToQueue("farmacia", () => {});
      expect(typeof unsub).toBe("function");
    });

    it("após unsubscribe, não chama mais callback", () => {
      const callback = vi.fn();
      const unsub = manager.subscribeToQueue("farmacia", callback);

      unsub();

      manager.emitQueueCall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });
      expect(callback).not.toHaveBeenCalled();
    });

    it("unsubscribe não afeta outros subscribers", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsub1 = manager.subscribeToQueue("farmacia", callback1);
      manager.subscribeToQueue("farmacia", callback2);

      unsub1();

      manager.emitQueueCall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledOnce();
    });

    it("subscribers de setores diferentes são independentes", () => {
      const farmaciaCb = vi.fn();
      const recepcaoCb = vi.fn();
      manager.subscribeToQueue("farmacia", farmaciaCb);
      manager.subscribeToQueue("recepcao", recepcaoCb);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueCall("farmacia", call);

      expect(farmaciaCb).toHaveBeenCalledOnce();
      expect(recepcaoCb).not.toHaveBeenCalled();
    });
  });

  describe("getSubscriberCount()", () => {
    it("retorna 0 quando não há subscribers", () => {
      expect(manager.getSubscriberCount("farmacia")).toBe(0);
    });

    it("retorna contagem correta de subscribers", () => {
      manager.subscribeToQueue("farmacia", () => {});
      manager.subscribeToQueue("farmacia", () => {});
      manager.subscribeToQueue("farmacia", () => {});

      expect(manager.getSubscriberCount("farmacia")).toBe(3);
    });

    it("retorna 0 após todos fazerem unsubscribe", () => {
      const unsub1 = manager.subscribeToQueue("farmacia", () => {});
      const unsub2 = manager.subscribeToQueue("farmacia", () => {});

      unsub1();
      unsub2();

      expect(manager.getSubscriberCount("farmacia")).toBe(0);
    });
  });

  describe("emitQueueRecall()", () => {
    it("emite evento de recall para o setor correto", () => {
      const callback = vi.fn();
      manager.subscribeToRecall("farmacia", callback);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueRecall("farmacia", call);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(call, null);
    });

    it("encaminha o marcador de reset como segundo argumento", () => {
      const callback = vi.fn();
      manager.subscribeToRecall("farmacia", callback);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueRecall("farmacia", call, "2026-09-30T10:00:00.000Z");

      expect(callback).toHaveBeenCalledWith(call, "2026-09-30T10:00:00.000Z");
    });

    it("não emite recall para outros setores", () => {
      const callback = vi.fn();
      manager.subscribeToRecall("farmacia", callback);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueRecall("recepcao", call);

      expect(callback).not.toHaveBeenCalled();
    });

    it("recall e call são eventos independentes", () => {
      const callCb = vi.fn();
      const recallCb = vi.fn();
      manager.subscribeToQueue("farmacia", callCb);
      manager.subscribeToRecall("farmacia", recallCb);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueCall("farmacia", call);
      manager.emitQueueRecall("farmacia", call);

      expect(callCb).toHaveBeenCalledTimes(1);
      expect(recallCb).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribeToRecall()", () => {
    it("retorna uma função de unsubscribe", () => {
      const unsub = manager.subscribeToRecall("farmacia", () => {});
      expect(typeof unsub).toBe("function");
    });

    it("após unsubscribe, não chama mais callback", () => {
      const callback = vi.fn();
      const unsub = manager.subscribeToRecall("farmacia", callback);

      unsub();

      manager.emitQueueRecall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });
      expect(callback).not.toHaveBeenCalled();
    });

    it("unsubscribe não afeta outros subscribers de recall", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsub1 = manager.subscribeToRecall("farmacia", callback1);
      manager.subscribeToRecall("farmacia", callback2);

      unsub1();

      manager.emitQueueRecall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledOnce();
    });

    it("subscribers de setores diferentes são independentes", () => {
      const farmaciaCb = vi.fn();
      const recepcaoCb = vi.fn();
      manager.subscribeToRecall("farmacia", farmaciaCb);
      manager.subscribeToRecall("recepcao", recepcaoCb);

      const call = { id: "1", number: 42, type: "normal", time: "14:30" };
      manager.emitQueueRecall("farmacia", call);

      expect(farmaciaCb).toHaveBeenCalledOnce();
      expect(recepcaoCb).not.toHaveBeenCalled();
    });
  });

  describe("getRecallSubscriberCount()", () => {
    it("retorna 0 quando não há subscribers", () => {
      expect(manager.getRecallSubscriberCount("farmacia")).toBe(0);
    });

    it("retorna contagem correta de subscribers", () => {
      manager.subscribeToRecall("farmacia", () => {});
      manager.subscribeToRecall("farmacia", () => {});

      expect(manager.getRecallSubscriberCount("farmacia")).toBe(2);
    });
  });

  describe("emitQueueReset()", () => {
    it("emite evento de reset para o setor correto", () => {
      const callback = vi.fn();
      manager.subscribeToReset("farmacia", callback);

      manager.emitQueueReset("farmacia", "2026-09-30T10:00:00.000Z");

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith("2026-09-30T10:00:00.000Z");
    });

    it("não emite reset para outros setores", () => {
      const callback = vi.fn();
      manager.subscribeToReset("farmacia", callback);

      manager.emitQueueReset("recepcao", "2026-09-30T10:00:00.000Z");

      expect(callback).not.toHaveBeenCalled();
    });

    it("reset é independente de call e recall", () => {
      const callCb = vi.fn();
      const recallCb = vi.fn();
      const resetCb = vi.fn();
      manager.subscribeToQueue("farmacia", callCb);
      manager.subscribeToRecall("farmacia", recallCb);
      manager.subscribeToReset("farmacia", resetCb);

      manager.emitQueueReset("farmacia", "2026-09-30T10:00:00.000Z");

      expect(resetCb).toHaveBeenCalledOnce();
      expect(callCb).not.toHaveBeenCalled();
      expect(recallCb).not.toHaveBeenCalled();
    });
  });

  describe("subscribeToReset()", () => {
    it("retorna uma função de unsubscribe", () => {
      const unsub = manager.subscribeToReset("farmacia", () => {});
      expect(typeof unsub).toBe("function");
    });

    it("após unsubscribe, não chama mais callback", () => {
      const callback = vi.fn();
      const unsub = manager.subscribeToReset("farmacia", callback);

      unsub();
      manager.emitQueueReset("farmacia", "2026-09-30T10:00:00.000Z");

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getResetSubscriberCount()", () => {
    it("reflete os subscribers de reset", () => {
      expect(manager.getResetSubscriberCount("farmacia")).toBe(0);

      const unsub = manager.subscribeToReset("farmacia", () => {});
      manager.subscribeToReset("farmacia", () => {});
      expect(manager.getResetSubscriberCount("farmacia")).toBe(2);

      unsub();
      expect(manager.getResetSubscriberCount("farmacia")).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("emite múltiplos eventos sequencialmente", () => {
      const calls = [];
      manager.subscribeToQueue("farmacia", (call) => calls.push(call));

      manager.emitQueueCall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });
      manager.emitQueueCall("farmacia", { id: "2", number: 2, type: "preferencial", time: "14:31" });
      manager.emitQueueCall("farmacia", { id: "3", number: 3, type: "normal", time: "14:32" });

      expect(calls).toHaveLength(3);
      expect(calls[0].number).toBe(1);
      expect(calls[1].number).toBe(2);
      expect(calls[2].number).toBe(3);
    });

    it("emite múltiplos recalls sequencialmente", () => {
      const calls = [];
      manager.subscribeToRecall("farmacia", (call) => calls.push(call));

      manager.emitQueueRecall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });
      manager.emitQueueRecall("farmacia", { id: "1", number: 1, type: "normal", time: "14:31" });
      manager.emitQueueRecall("farmacia", { id: "2", number: 2, type: "normal", time: "14:32" });

      expect(calls).toHaveLength(3);
      expect(calls[0].number).toBe(1);
      expect(calls[1].number).toBe(1);
      expect(calls[2].number).toBe(2);
    });

    it("funciona com subscriber removido no meio da emissão", () => {
      const results = [];
      let unsub2;

      const unsub1 = manager.subscribeToQueue("farmacia", () => {
        results.push("cb1");
        unsub2(); // Remove o segundo callback durante a emissão
      });
      unsub2 = manager.subscribeToQueue("farmacia", () => {
        results.push("cb2");
      });

      manager.emitQueueCall("farmacia", { id: "1", number: 1, type: "normal", time: "14:30" });

      expect(results).toContain("cb1");
      // cb2 pode ou não ser chamado dependendo da ordem interna
    });
  });
});
