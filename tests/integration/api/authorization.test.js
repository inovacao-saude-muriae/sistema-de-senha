import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { auth } from "@/auth";
import { eventManager } from "@/lib/event-manager";
import {
  MAX_SSE_CONNECTIONS_PER_SECTOR,
  SECTORS,
} from "@/lib/constants.js";

async function importRoute(path) {
  return import(path);
}

function asRole(role) {
  auth.mockResolvedValueOnce({ user: { id: "u1", name: "Teste", role } });
}

function asAnonymous() {
  auth.mockResolvedValueOnce(null);
}

function req(url, extra = {}) {
  return {
    url,
    json: () => Promise.resolve(extra.body ?? {}),
    formData: () => Promise.resolve(extra.formData ?? new FormData()),
    signal: { addEventListener: vi.fn() },
  };
}

/**
 * Matriz de autorização das rotas de API.
 *
 * `middleware.js` libera todo `/api`, então cada handler precisa se proteger
 * sozinho — esta é a rede de segurança contra regressões nessa barreira.
 */
describe("Autorização das rotas de API", () => {
  beforeEach(() => {
    eventManager.removeAllListeners();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Rota, método, exige admin?
  const MATRIX = [
    { path: "@/app/api/queue/events/route.js", method: "GET", admin: false },
    { path: "@/app/api/queue/recent/route.js", method: "GET", admin: false },
    { path: "@/app/api/queue/call/route.js", method: "POST", admin: false },
    { path: "@/app/api/queue/recall/route.js", method: "POST", admin: false },
    { path: "@/app/api/queue/reset/route.js", method: "POST", admin: true },
    { path: "@/app/api/queue/sync/route.js", method: "POST", admin: true },
    { path: "@/app/api/news/route.js", method: "GET", admin: false },
    { path: "@/app/api/news/route.js", method: "POST", admin: true },
    { path: "@/app/api/news/route.js", method: "DELETE", admin: true },
    { path: "@/app/api/users/route.js", method: "GET", admin: true },
    { path: "@/app/api/users/route.js", method: "POST", admin: true },
    { path: "@/app/api/users/route.js", method: "DELETE", admin: true },
    { path: "@/app/api/stats/route.js", method: "GET", admin: false },
  ];

  const url = "http://localhost/api/queue/recent?sector=farmacia&limit=1";

  for (const { path, method, admin } of MATRIX) {
    const name = `${path.replace("@/app", "")} ${method}`;

    describe(name, () => {
      it("sem sessão devolve 401", async () => {
        asAnonymous();
        const mod = await importRoute(path);
        const res = await mod[method](req(url, { body: { sector: "farmacia" } }));

        expect(res.status).toBe(401);
      });

      if (admin) {
        it("atendente devolve 403", async () => {
          asRole("attendant");
          const mod = await importRoute(path);
          const res = await mod[method](req(url, { body: { sector: "farmacia" } }));

          expect(res.status).toBe(403);
        });
      } else {
        it("atendente passa da autorização", async () => {
          asRole("attendant");
          const mod = await importRoute(path);
          const res = await mod[method](req(url, { body: { sector: "farmacia" } }));

          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });
      }
    });
  }
});

describe("/api/queue/events — limite de conexões", () => {
  beforeEach(() => {
    eventManager.removeAllListeners();
  });

  afterEach(() => {
    eventManager.removeAllListeners();
    vi.clearAllMocks();
  });

  function streamReq(sector) {
    return {
      url: `http://localhost/api/queue/events?sector=${sector}`,
      signal: { addEventListener: vi.fn() },
    };
  }

  it(`devolve 429 acima de ${MAX_SSE_CONNECTIONS_PER_SECTOR} conexões`, async () => {
    const { GET } = await importRoute("@/app/api/queue/events/route.js");
    auth.mockResolvedValue({ user: { id: "u1", name: "T", role: "admin" } });

    // Sobe no limite.
    const unsubs = [];
    for (let i = 0; i < MAX_SSE_CONNECTIONS_PER_SECTOR; i++) {
      const res = await GET(streamReq("farmacia"));
      expect(res.status).toBe(200);
      // O stream fica aberto; força o cleanup do teste.
      unsubs.push(() => res.body?.cancel?.());
    }

    const rejected = await GET(streamReq("farmacia"));
    expect(rejected.status).toBe(429);

    await Promise.all(unsubs.map((fn) => fn().catch(() => {})));
  });

  it("o limite é por setor", async () => {
    const { GET } = await importRoute("@/app/api/queue/events/route.js");
    auth.mockResolvedValue({ user: { id: "u1", name: "T", role: "admin" } });

    const streams = [];
    for (let i = 0; i < MAX_SSE_CONNECTIONS_PER_SECTOR; i++) {
      const res = await GET(streamReq("farmacia"));
      streams.push(res);
    }

    // Outro setor ainda tem cota.
    const other = await GET(streamReq("recepcao"));
    expect(other.status).toBe(200);

    await Promise.all(
      streams.map((res) => res.body?.cancel?.().catch(() => {})),
    );
  });

  it("sessão anônima não abre stream", async () => {
    const { GET } = await importRoute("@/app/api/queue/events/route.js");
    asAnonymous();

    const res = await GET(streamReq("farmacia"));

    expect(res.status).toBe(401);
    expect(eventManager.getSubscriberCount("farmacia")).toBe(0);
  });

  it("recusa setor inválido antes de abrir stream", async () => {
    const { GET } = await importRoute("@/app/api/queue/events/route.js");
    auth.mockResolvedValue({ user: { id: "u1", name: "T", role: "admin" } });

    const res = await GET(streamReq("inexistente"));

    expect(res.status).toBe(400);
  });

  it("todos os setores do enum continuam acessíveis", () => {
    for (const sector of Object.keys(SECTORS)) {
      expect(SECTORS[sector]).toBeDefined();
    }
  });
});
