import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cleanupQueueTestData,
  seedTestQueueSequence,
  prisma,
} from "../../../postgres-setup.js";
import { eventManager } from "@/lib/event-manager";

async function importRoute() {
  return import("@/app/api/queue/reset/route.js");
}

describe("/api/queue/reset — integration", () => {
  beforeEach(async () => {
    await cleanupQueueTestData();
  });

  afterEach(async () => {
    await cleanupQueueTestData();
  });

  describe("POST", () => {
    it("retorna 400 sem setor", async () => {
      const { POST } = await importRoute();
      const req = { json: () => Promise.resolve({}) };
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("retorna 400 com setor inválido", async () => {
      const { POST } = await importRoute();
      const req = { json: () => Promise.resolve({ sector: "invalido" }) };
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("reseta setor único", async () => {
      await seedTestQueueSequence("farmacia", "normal", 5);

      const { POST } = await importRoute();
      const req = { json: () => Promise.resolve({ sector: "farmacia" }) };
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.sectors).toEqual(["farmacia"]);

      const seq = await prisma.queue_sequences.findUnique({
        where: {
          sector_id_call_type: { sector_id: "farmacia", call_type: "normal" },
        },
      });
      expect(seq.current_number).toBe(-1);
    });

    it("reseta todos os setores com 'all'", async () => {
      await seedTestQueueSequence("farmacia", "normal", 5);
      await seedTestQueueSequence("recepcao", "normal", 3);

      const { POST } = await importRoute();
      const req = { json: () => Promise.resolve({ sector: "all" }) };
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.sectors).toEqual(["farmacia", "recepcao"]);

      const farmaciaSeq = await prisma.queue_sequences.findUnique({
        where: {
          sector_id_call_type: { sector_id: "farmacia", call_type: "normal" },
        },
      });
      const recepcaoSeq = await prisma.queue_sequences.findUnique({
        where: {
          sector_id_call_type: { sector_id: "recepcao", call_type: "normal" },
        },
      });
      expect(farmaciaSeq.current_number).toBe(-1);
      expect(recepcaoSeq.current_number).toBe(-1);
    });

    it("retorna success: true e lista de setores resetados", async () => {
      const { POST } = await importRoute();
      const req = { json: () => Promise.resolve({ sector: "farmacia" }) };
      const res = await POST(req);
      const body = await res.json();

      expect(body).toEqual({ success: true, sectors: ["farmacia"] });
    });

    it("grava o marcador de reset no setor", async () => {
      const { POST } = await importRoute();
      await POST({ json: () => Promise.resolve({ sector: "farmacia" }) });

      const sector = await prisma.sectors.findUnique({
        where: { id: "farmacia" },
        select: { reset_at: true },
      });
      expect(sector.reset_at).toBeInstanceOf(Date);
    });

    it("emite evento de reset para os assinantes do setor", async () => {
      const { POST } = await importRoute();

      let received = null;
      const unsubscribe = eventManager.subscribeToReset("farmacia", (resetAt) => {
        received = resetAt;
      });

      try {
        await POST({ json: () => Promise.resolve({ sector: "farmacia" }) });

        expect(received).not.toBeNull();
        expect(typeof received).toBe("string");
        expect(new Date(received).toString()).not.toBe("Invalid Date");
      } finally {
        unsubscribe();
      }
    });

    it("'all' emite reset em cada setor", async () => {
      const { POST } = await importRoute();

      const seen = [];
      const unsubF = eventManager.subscribeToReset("farmacia", (at) => seen.push(["farmacia", at]));
      const unsubR = eventManager.subscribeToReset("recepcao", (at) => seen.push(["recepcao", at]));

      try {
        await POST({ json: () => Promise.resolve({ sector: "all" }) });

        expect(seen.map(([s]) => s).sort()).toEqual(["farmacia", "recepcao"]);
      } finally {
        unsubF();
        unsubR();
      }
    });

    it("não emite quando a requisição é rejeitada", async () => {
      const { POST } = await importRoute();

      let called = false;
      const unsubscribe = eventManager.subscribeToReset("farmacia", () => {
        called = true;
      });

      try {
        await POST({ json: () => Promise.resolve({ sector: "invalido" }) });
        expect(called).toBe(false);
      } finally {
        unsubscribe();
      }
    });
  });
});
