import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cleanupQueueTestData,
  seedTestQueueSequence,
  prisma,
} from "../../../postgres-setup.js";

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
  });
});
