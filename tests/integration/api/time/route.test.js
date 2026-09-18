import { describe, it, expect } from "vitest";

async function importRoute() {
  return import("@/app/api/time/route.js");
}

describe("/api/time — integration", () => {
  describe("GET", () => {
    it("retorna 200 com serverTime em formato ISO 8601", async () => {
      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.serverTime).toBeDefined();
      expect(typeof body.serverTime).toBe("string");
    });

    it("serverTime é uma data ISO válida", async () => {
      const { GET } = await importRoute();
      const before = Date.now();
      const res = await GET();
      const after = Date.now();
      const body = await res.json();

      const serverTime = new Date(body.serverTime);
      expect(serverTime.getTime()).not.toBeNaN();
      expect(serverTime.getTime()).toBeGreaterThanOrEqual(before);
      expect(serverTime.getTime()).toBeLessThanOrEqual(after);
    });

    it("serverTime está dentro de alguns segundos do horário local", async () => {
      const { GET } = await importRoute();
      const localBefore = Date.now();
      const res = await GET();
      const localAfter = Date.now();
      const body = await res.json();

      const serverMs = new Date(body.serverTime).getTime();
      const avgLocal = (localBefore + localAfter) / 2;

      // Diferença deve ser menor que 5 segundos (考虑网络延迟)
      expect(Math.abs(serverMs - avgLocal)).toBeLessThan(5000);
    });

    it("formato é ISO 8601 (contém 'T' e 'Z' ou offset)", async () => {
      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ ou com offset
      expect(body.serverTime).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("não requer autenticação", async () => {
      const { GET } = await importRoute();
      const res = await GET();

      // Deve retornar 200 mesmo sem sessão (endpoint público)
      expect(res.status).toBe(200);
    });
  });
});
