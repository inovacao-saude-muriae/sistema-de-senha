import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seedTestNews, cleanupTestNews, cleanupAllNews } from "../../postgres-setup.js";
import { objectExistsInS3, extractKeyFromUrl, deleteFromS3 } from "@/lib/s3-client.js";

const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL;

let createdIds = [];
let createdKeys = [];

async function importRoute() {
  return import("@/app/api/news/route.js");
}

async function importNewsRepo() {
  const mod = await import("@/lib/repositories");
  return mod.news;
}

function makeImage({ name = "test.jpg", type = "image/jpeg", size = 1024 } = {}) {
  const data = new Uint8Array(size);
  return new File([data], name, { type });
}

async function cleanupS3() {
  const validKeys = createdKeys.filter(Boolean);

  for (const key of validKeys) {
    await deleteFromS3(key);
  }

  createdKeys = [];
}

function isUrl(str) {
  return URL.canParse(str);
}

describe("/api/news — integration", () => {
  beforeEach(() => {
    createdIds = [];
    createdKeys = [];
  });

  afterEach(async () => {
    await cleanupS3();
    await cleanupTestNews(createdIds);
    createdIds = [];
  });

  describe("GET", () => {
    it("retorna lista de notícias ativas", async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: "Notícia GET Teste",
        image: makeImage({ name: "get-test.jpg" }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(body.news)).toBe(true);

      const found = body.news.find((n) => n.id === result.news.id);

      expect(found).toBeDefined();
      expect(found.title).toBe("Notícia GET Teste");
      expect(isUrl(found.image)).toBe(true);
      expect(found.image).toMatch(`${S3_PUBLIC_URL}/`);
    });

    it("não retorna notícias inativas", async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: "Inativa Teste",
        image: makeImage({ name: "inativa-test.jpg" }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      await repo.remove(result.news.id);

      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      const found = body.news.find((n) => n.id === result.news.id);
      expect(found).toBeUndefined();
    });

    it("retorna no máximo 10 notícias", async () => {
      await cleanupAllNews();
      for (let i = 0; i < 12; i++) {
        const { id } = await seedTestNews({ title: `Max News ${i}` });
        createdIds.push(id);
      }

      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.news).toHaveLength(10);
    });

    it("retorna notícias ordenadas por created_at desc", async () => {
      await cleanupAllNews();
      const older = await seedTestNews({
        title: "Mais antiga",
        created_at: new Date("2020-01-01"),
      });
      const newer = await seedTestNews({
        title: "Mais recente",
        created_at: new Date("2030-01-01"),
      });
      createdIds.push(older.id, newer.id);

      const { GET } = await importRoute();
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.news[0].title).toBe("Mais recente");
      expect(body.news[1].title).toBe("Mais antiga");
    });
  });

  describe("POST", () => {
    it("retorna 400 sem título", async () => {
      const form = new FormData();
      form.append("image", makeImage());

      const { POST } = await importRoute();
      const res = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Título e imagem são obrigatórios");
    });

    it("retorna 400 sem imagem", async () => {
      const form = new FormData();
      form.append("title", "Teste");

      const { POST } = await importRoute();
      const res = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Título e imagem são obrigatórios");
    });

    it("retorna 400 para formato de arquivo inválido", async () => {
      const form = new FormData();
      form.append("title", "Teste");
      form.append("image", new File(["x"], "doc.pdf", { type: "application/pdf" }));

      const { POST } = await importRoute();
      const res = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Formato inválido/i);
    });

    it("cria notícia, salva no banco e retorna dados", async () => {
      const form = new FormData();
      form.append("title", "Minha Notícias");
      form.append("image", makeImage({ name: "foto.jpg", type: "image/jpeg" }));

      const { POST } = await importRoute();
      const res = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.news.title).toBe("Minha Notícias");
      expect(body.news.id).toBeDefined();
      expect(body.news.image).toMatch(new RegExp(`^${S3_PUBLIC_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`));

      createdIds.push(Number(body.news.id));
      createdKeys.push(extractKeyFromUrl(body.news.image));

      const repo = await importNewsRepo();
      const list = await repo.listActive();
      const found = list.find((n) => n.id === body.news.id);
      expect(found).toBeDefined();
      expect(found.title).toBe("Minha Notícias");
    });

    it("salva a imagem no S3", async () => {
      const form = new FormData();
      form.append("title", "Com Imagem");
      form.append("image", makeImage({ name: "foto.png", type: "image/png" }));

      const { POST } = await importRoute();
      const res = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      const key = extractKeyFromUrl(body.news.image);

      createdIds.push(Number(body.news.id));
      if (key) createdKeys.push(key);

      expect(isUrl(body.news.image)).toBe(true);
      expect(await objectExistsInS3(key)).toBe(true);
    });

    it("faz trim no título", async () => {
      const form = new FormData();
      form.append("title", "  Com Espaços  ");
      form.append("image", makeImage());

      const { POST } = await importRoute();
      const res = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.news.title).toBe("Com Espaços");

      createdIds.push(Number(body.news.id));
      createdKeys.push(extractKeyFromUrl(body.news.image));
    });
  });

  describe("DELETE", () => {
    it("retorna 400 sem id", async () => {
      const { DELETE } = await importRoute();
      const res = await DELETE(new Request("http://localhost/api/news"));

      expect(res.status).toBe(400);
    });

    it("retorna 400 com id inválido", async () => {
      const { DELETE } = await importRoute();
      const res = await DELETE(new Request("http://localhost/api/news?id=abc"));

      expect(res.status).toBe(400);
    });

    it("faz soft delete e retorna success", async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: "Para Deletar",
        image: makeImage({ name: "to-delete.jpg" }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      const { DELETE } = await importRoute();
      const res = await DELETE(
        new Request(`http://localhost/api/news?id=${result.news.id}`)
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });

      const list = await repo.listActive();
      const found = list.find((n) => n.id === result.news.id);
      expect(found).toBeUndefined();
    });

    it("remove a imagem do S3 ao deletar", async () => {
      const repo = await importNewsRepo();

      const result = await repo.create({
        title: "Com Imagem",
        image: makeImage({ name: "to-delete-img.jpg" }),
      });

      createdIds.push(Number(result.news.id));
      const key = extractKeyFromUrl(result.news.image);
      createdKeys.push(key);

      const { DELETE } = await importRoute();
      const res = await DELETE(
        new Request(`http://localhost/api/news?id=${result.news.id}`)
      );

      expect(res.status).toBe(200);
      expect(await objectExistsInS3(key)).toBe(false);
    });

    it("retorna 404 quando notícia não existe", async () => {
      const { DELETE } = await importRoute();
      const res = await DELETE(new Request("http://localhost/api/news?id=999999"));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/não encontrada/i);
    });
  });

  describe("fluxo completo", () => {
    it("cria, lista e deleta notícia", async () => {
      const form = new FormData();
      form.append("title", "Fluxo Completo");
      form.append("image", makeImage({ name: "fluxo.jpg", type: "image/jpeg" }));

      const { POST } = await importRoute();
      const postRes = await POST(
        new Request("http://localhost/api/news", { method: "POST", body: form })
      );
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      const newsId = postData.news.id;
      createdIds.push(Number(newsId));
      createdKeys.push(extractKeyFromUrl(postData.news.image));

      const { GET } = await importRoute();
      const getRes = await GET();
      const getData = await getRes.json();
      const found = getData.news.find((n) => n.id === newsId);
      expect(found).toBeDefined();
      expect(found.title).toBe("Fluxo Completo");

      const { DELETE } = await importRoute();
      const delRes = await DELETE(
        new Request(`http://localhost/api/news?id=${newsId}`)
      );
      expect(delRes.status).toBe(200);

      const getRes2 = await GET();
      const getData2 = await getRes2.json();
      const notFound = getData2.news.find((n) => n.id === newsId);
      expect(notFound).toBeUndefined();

      const repo = await importNewsRepo();
      const list = await repo.listActive();
      const stillActive = list.find((n) => n.id === newsId);
      expect(stillActive).toBeUndefined();
    });
  });
});
