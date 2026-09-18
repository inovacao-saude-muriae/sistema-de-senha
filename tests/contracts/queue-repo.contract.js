import { describe, it, expect } from "vitest";

/**
 * QueueRepository contract — shared test suite.
 * Pass a factory that returns a fresh repository instance (optionally async).
 * The factory should clean any persisted state between calls.
 */
export function queueRepoContract(createRepo) {
  describe("QueueRepository contract", () => {
    let repo;

    beforeEach(async () => {
      repo = await createRepo();
    });

    describe("setNextNumber()", () => {
      it("define o próximo número para farmácia normal", async () => {
        await repo.setNextNumber("farmacia", "normal", 45);
        const next = await repo.nextNumber("farmacia", "normal");
        expect(next.number).toBe(45);
      });

      it("define o próximo número para recepção preferencial", async () => {
        await repo.setNextNumber("recepcao", "preferencial", 100);
        const next = await repo.nextNumber("recepcao", "preferencial");
        expect(next.number).toBe(100);
      });

      it("reseta sequência existente para número específico", async () => {
        await repo.nextNumber("farmacia", "normal");
        await repo.nextNumber("farmacia", "normal");
        await repo.setNextNumber("farmacia", "normal", 10);
        const next = await repo.nextNumber("farmacia", "normal");
        expect(next.number).toBe(10);
      });

      it("mantém sequências independentes por setor/tipo", async () => {
        await repo.setNextNumber("farmacia", "normal", 50);
        await repo.setNextNumber("recepcao", "normal", 25);
        const f = await repo.nextNumber("farmacia", "normal");
        const r = await repo.nextNumber("recepcao", "normal");
        expect(f.number).toBe(50);
        expect(r.number).toBe(25);
      });

      it("lança erro com número < 0", async () => {
        await expect(repo.setNextNumber("farmacia", "normal", -1))
          .rejects.toThrow();
      });

      it("lança erro com número > 999", async () => {
        await expect(repo.setNextNumber("farmacia", "normal", 1000))
          .rejects.toThrow();
      });
    });

    describe("nextNumber()", () => {
      it("retorna um número inteiro ≥ 0 para farmácia normal", async () => {
        const result = await repo.nextNumber("farmacia", "normal");
        expect(Number.isInteger(result.number)).toBe(true);
        expect(result.number).toBeGreaterThanOrEqual(0);
        expect(typeof result.wraparound).toBe("boolean");
      });

      it("retorna um número inteiro ≥ 0 para recepção preferencial", async () => {
        const result = await repo.nextNumber("recepcao", "preferencial");
        expect(Number.isInteger(result.number)).toBe(true);
        expect(result.number).toBeGreaterThanOrEqual(0);
        expect(typeof result.wraparound).toBe("boolean");
      });

      it("incrementa sequencialmente para o mesmo setor+tipo", async () => {
        const n1 = await repo.nextNumber("farmacia", "normal");
        const n2 = await repo.nextNumber("farmacia", "normal");
        const n3 = await repo.nextNumber("farmacia", "normal");
        expect(n2.number).toBe(n1.number + 1);
        expect(n3.number).toBe(n2.number + 1);
      });

      it("mantém sequências independentes por tipo", async () => {
        const n1 = await repo.nextNumber("farmacia", "normal");
        const n2 = await repo.nextNumber("farmacia", "preferencial");
        expect(n1.number).toBe(0);
        expect(n2.number).toBe(0);
        const n3 = await repo.nextNumber("farmacia", "normal");
        expect(n3.number).toBe(n1.number + 1);
      });

      it("mantém sequências independentes por setor", async () => {
        const n1 = await repo.nextNumber("farmacia", "normal");
        const n2 = await repo.nextNumber("recepcao", "normal");
        expect(n1.number).toBe(0);
        expect(n2.number).toBe(0);
        const n3 = await repo.nextNumber("farmacia", "normal");
        expect(n3.number).toBe(n1.number + 1);
      });

      it("volta para 0 após a senha 999", async () => {
        await repo.setNextNumber("farmacia", "normal", 999);
        const r1 = await repo.nextNumber("farmacia", "normal");
        expect(r1.number).toBe(999);
        const r2 = await repo.nextNumber("farmacia", "normal");
        expect(r2.number).toBe(0);
        expect(r2.wraparound).toBe(true);
      })
    });

    describe("saveCall()", () => {
      it("salva uma chamada sem erro", async () => {
        const { number: num } = await repo.nextNumber("farmacia", "normal");
        const result = await repo.saveCall({
            sector: "farmacia",
            number: num,
            numberStr: `N${String(num).padStart(3, "0")}`,
            sequenceType: "normal",
            callType: "normal",
            attendantId: null,
          });
        expect(result).toEqual(expect.objectContaining({ id: expect.any(String) }));
      });

      it("aceita attendantId null", async () => {
        const { number: num } = await repo.nextNumber("farmacia", "preferencial");
        const result = await repo.saveCall({
            sector: "farmacia",
            number: num,
            numberStr: `P${String(num).padStart(3, "0")}`,
            sequenceType: "preferencial",
            callType: "preferencial",
            attendantId: null,
          });
        expect(result).toEqual(expect.objectContaining({ id: expect.any(String) }));
      });

      it("aceita attendantId com valor", async () => {
        const { number: num } = await repo.nextNumber("recepcao", "normal");
        const result = await repo.saveCall({
            sector: "recepcao",
            number: num,
            numberStr: `N${String(num).padStart(3, "0")}`,
            sequenceType: "normal",
            callType: "normal",
            attendantId: "some-uuid",
          });
        expect(result).toEqual(expect.objectContaining({ id: expect.any(String) }));
      });
    });

    describe("resetSector()", () => {
      it("reseta a sequência para 0 (primeira senha = 000)", async () => {
        await repo.nextNumber("farmacia", "normal");
        await repo.nextNumber("farmacia", "normal");
        await repo.resetSector("farmacia");
        const num = await repo.nextNumber("farmacia", "normal");
        expect(num.number).toBe(0);
      });

      it("reseta apenas o setor informado", async () => {
        await repo.nextNumber("farmacia", "normal");
        await repo.nextNumber("farmacia", "normal");
        await repo.nextNumber("recepcao", "normal");
        await repo.nextNumber("recepcao", "normal");

        await repo.resetSector("farmacia");

        const f = await repo.nextNumber("farmacia", "normal");
        const r = await repo.nextNumber("recepcao", "normal");
        expect(f.number).toBe(0);
        expect(r.number).toBeGreaterThan(0);
      });

      it("reseta ambos os tipos do setor", async () => {
        await repo.nextNumber("farmacia", "normal");
        await repo.nextNumber("farmacia", "preferencial");
        await repo.resetSector("farmacia");
        const n = await repo.nextNumber("farmacia", "normal");
        const p = await repo.nextNumber("farmacia", "preferencial");
        expect(n.number).toBe(0);
        expect(p.number).toBe(0);
      });
    });
  });
}
