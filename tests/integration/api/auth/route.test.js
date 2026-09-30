import { describe, it, expect } from "vitest";

async function importRoute() {
  return import("@/app/api/auth/route.js");
}

describe("/api/auth — integration", () => {
  describe("GET (deprecated)", () => {
    it("retorna array vazio", async () => {
      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.users).toEqual([]);
    });
  });

  describe("ausência de caminho de credenciais paralelo", () => {
    it("não exporta POST", async () => {
      const mod = await importRoute();

      // O antigo POST /api/auth verificava usuario+senha sem rate limiting e
      // sem emitir cookie de sessao — um segundo caminho de login. A
      // autenticacao real acontece no NextAuth (/api/auth/[...nextauth]).
      expect(mod.POST).toBeUndefined();
    });
  });
});
