import type {
  NewsCreateBody,
  NewsListBody,
  NewsUpdateBody,
  SuccessBody,
} from '@/shared/types/api';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteFromS3,
  extractKeyFromUrl,
  objectExistsInS3,
} from '@/server/storage/s3-client';
import { readJson } from '@/shared/json';
import { makeTestImage } from '../../../helpers/images';
import {
  cleanupAllNews,
  cleanupTestNews,
  seedTestNews,
} from '../../postgres-setup';

const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL;

let createdIds: number[] = [];
let createdKeys: Array<null | string> = [];

async function cleanupS3() {
  const validKeys = createdKeys.filter((k): k is string => k !== null);

  for (const key of validKeys) {
    await deleteFromS3(key);
  }

  createdKeys = [];
}

async function importNewsRepo() {
  const mod = await import('@/server/repositories');
  return mod.news;
}

async function importRoute() {
  return import('@/app/api/news/route');
}

// Aceita `undefined` porque `found?.image` é `string | undefined`; `undefined`
// cai fora da URL, igual a `URL.canParse("undefined")` faria em runtime.
function isUrl(str?: string) {
  return str !== undefined && URL.canParse(str);
}

function newsUrl(query = '') {
  return new Request(`http://localhost/api/news${query}`);
}

describe('/api/news — integration', () => {
  beforeEach(() => {
    createdIds = [];
    createdKeys = [];
  });

  afterEach(async () => {
    await cleanupS3();
    await cleanupTestNews(createdIds);
    createdIds = [];
  });

  describe('GET', () => {
    it('retorna lista de notícias ativas', async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: 'Notícia GET Teste',
        image: makeTestImage({ name: 'get-test.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      const { GET } = await importRoute();
      const res = await GET(newsUrl());
      const body = await readJson<NewsListBody>(res);

      expect(res.status).toBe(200);
      expect(Array.isArray(body.news)).toBe(true);

      const found = body.news.find(
        (n: { id: string }) => n.id === result.news.id,
      );

      expect(found).toBeDefined();
      expect(found?.title).toBe('Notícia GET Teste');
      expect(found?.active).toBe(true);
      expect(isUrl(found?.image)).toBe(true);
      expect(found?.image).toMatch(`${String(S3_PUBLIC_URL)}/`);
    });

    it('não retorna notícias arquivadas na lista de ativas', async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: 'Inativa Teste',
        image: makeTestImage({ name: 'inativa-test.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      await repo.setActive(result.news.id, false);

      const { GET } = await importRoute();
      const res = await GET(newsUrl());
      const body = await readJson<NewsListBody>(res);

      expect(res.status).toBe(200);
      const found = body.news.find(
        (n: { id: string }) => n.id === result.news.id,
      );
      expect(found).toBeUndefined();
    });

    it('lista arquivadas com status=inactive', async () => {
      const repo = await importNewsRepo();
      // O banco de teste pode já ter notícias (seed), então o contador é
      // conferido em relação à linha de base, não contra zero.
      const baseline = await repo.list({ status: 'active' });
      const result = await repo.create({
        title: 'Arquivada Teste',
        image: makeTestImage({ name: 'arquivada.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      await repo.setActive(result.news.id, false);

      const { GET } = await importRoute();
      const res = await GET(newsUrl('?status=inactive'));
      const body = await readJson<NewsListBody>(res);

      expect(res.status).toBe(200);
      expect(body.news.map((n) => n.id)).toContain(result.news.id);
      expect(body.counts.active).toBe(baseline.counts.active);
      expect(body.counts.inactive).toBeGreaterThanOrEqual(1);
    });

    it('pagina e devolve total/totalPages', async () => {
      await cleanupAllNews();
      for (let i = 0; i < 5; i++) {
        const { id } = await seedTestNews({ title: `Página ${i}` });
        createdIds.push(id);
      }

      const { GET } = await importRoute();
      const res = await GET(newsUrl('?page=2&pageSize=2'));
      const body = await readJson<NewsListBody>(res);

      expect(res.status).toBe(200);
      expect(body.news).toHaveLength(2);
      expect(body.pagination).toEqual({
        page: 2,
        pageSize: 2,
        total: 5,
        totalPages: 3,
      });
      expect(body.counts.active).toBe(5);
    });

    it('retorna no máximo 10 notícias por padrão', async () => {
      await cleanupAllNews();
      for (let i = 0; i < 12; i++) {
        const { id } = await seedTestNews({ title: `Max News ${i}` });
        createdIds.push(id);
      }

      const { GET } = await importRoute();
      const res = await GET(newsUrl());
      const body = await readJson<NewsListBody>(res);

      expect(res.status).toBe(200);
      expect(body.news).toHaveLength(10);
      expect(body.pagination.pageSize).toBe(10);
    });

    it('retorna notícias ordenadas por created_at desc', async () => {
      await cleanupAllNews();
      const older = await seedTestNews({
        title: 'Mais antiga',
        created_at: new Date('2020-01-01'),
      });
      const newer = await seedTestNews({
        title: 'Mais recente',
        created_at: new Date('2030-01-01'),
      });
      createdIds.push(older.id, newer.id);

      const { GET } = await importRoute();
      const res = await GET(newsUrl());
      const body = await readJson<NewsListBody>(res);

      expect(res.status).toBe(200);
      expect(body.news[0].title).toBe('Mais recente');
      expect(body.news[1].title).toBe('Mais antiga');
    });
  });

  describe('POST', () => {
    it('retorna 400 sem título', async () => {
      const form = new FormData();
      form.append('image', makeTestImage());

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(400);
      const body = await readJson<NewsCreateBody>(res);
      expect(body.error).toBe('Título e imagem são obrigatórios');
    });

    it('retorna 400 sem imagem', async () => {
      const form = new FormData();
      form.append('title', 'Teste');

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(400);
      const body = await readJson<NewsCreateBody>(res);
      expect(body.error).toBe('Título e imagem são obrigatórios');
    });

    it('retorna 400 para formato de arquivo inválido', async () => {
      const form = new FormData();
      form.append('title', 'Teste');
      form.append(
        'image',
        new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
      );

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(400);
      const body = await readJson<NewsCreateBody>(res);
      expect(body.error).toMatch(/Formato inválido/i);
    });

    it('cria notícia, salva no banco e retorna dados', async () => {
      const form = new FormData();
      form.append('title', 'Minha Notícias');
      form.append(
        'image',
        makeTestImage({ name: 'foto.jpg', type: 'image/jpeg' }),
      );

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(200);
      const body = await readJson<NewsCreateBody>(res);
      expect(body.success).toBe(true);
      expect(body.news.title).toBe('Minha Notícias');
      expect(body.news.id).toBeDefined();
      expect(body.news.active).toBe(true);
      expect(body.news.image).toMatch(
        new RegExp(
          `^${String(S3_PUBLIC_URL).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`,
        ),
      );

      createdIds.push(Number(body.news.id));
      createdKeys.push(extractKeyFromUrl(body.news.image));

      const repo = await importNewsRepo();
      const list = await repo.listActive();
      const found = list.find((n) => n.id === body.news.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe('Minha Notícias');
    });

    it('salva a imagem no S3', async () => {
      const form = new FormData();
      form.append('title', 'Com Imagem');
      form.append(
        'image',
        makeTestImage({ name: 'foto.png', type: 'image/png' }),
      );

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(200);
      const body = await readJson<NewsCreateBody>(res);

      const key = extractKeyFromUrl(body.news.image);

      createdIds.push(Number(body.news.id));
      if (key) createdKeys.push(key);

      expect(isUrl(body.news.image)).toBe(true);
      expect(await objectExistsInS3(String(key))).toBe(true);
    });

    it('faz trim no título', async () => {
      const form = new FormData();
      form.append('title', '  Com Espaços  ');
      form.append('image', makeTestImage());

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(200);
      const body = await readJson<NewsCreateBody>(res);
      expect(body.news.title).toBe('Com Espaços');

      createdIds.push(Number(body.news.id));
      createdKeys.push(extractKeyFromUrl(body.news.image));
    });

    it('retorna 409 com o limite de ativas cheio', async () => {
      await cleanupAllNews();
      for (let i = 0; i < 10; i++) {
        const { id } = await seedTestNews({ title: `Cheia ${i}` });
        createdIds.push(id);
      }

      const form = new FormData();
      form.append('title', 'Excedente');
      form.append('image', makeTestImage());

      const { POST } = await importRoute();
      const res = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );

      expect(res.status).toBe(409);
      const body = await readJson<NewsCreateBody>(res);
      expect(body.error).toMatch(/limite/i);
    });
  });

  describe('PATCH', () => {
    it('arquiva a notícia sem apagar a imagem do S3', async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: 'Para Arquivar',
        image: makeTestImage({ name: 'to-archive.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      const key = extractKeyFromUrl(result.news.image);
      createdKeys.push(key);

      const { PATCH } = await importRoute();
      const res = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ id: result.news.id, active: false }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );

      expect(res.status).toBe(200);
      const body = await readJson<NewsUpdateBody>(res);
      expect(body.news.active).toBe(false);
      expect(await objectExistsInS3(String(key))).toBe(true);

      const inactive = await repo.list({ status: 'inactive' });
      expect(inactive.items.map((item) => item.id)).toContain(result.news.id);
    });

    it('reativa uma notícia arquivada', async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: 'Para Reativar',
        image: makeTestImage({ name: 'to-restore.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));
      await repo.setActive(result.news.id, false);

      const { PATCH } = await importRoute();
      const res = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ id: result.news.id, active: true }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );

      expect(res.status).toBe(200);
      const body = await readJson<NewsUpdateBody>(res);
      expect(body.news.active).toBe(true);
    });

    it('retorna 400 sem id', async () => {
      const { PATCH } = await importRoute();
      const res = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ active: false }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );

      expect(res.status).toBe(400);
    });

    it('retorna 400 sem active booleano', async () => {
      const { PATCH } = await importRoute();
      const res = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ id: 1, active: 'sim' }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );

      expect(res.status).toBe(400);
    });

    it('retorna 404 para notícia inexistente', async () => {
      const { PATCH } = await importRoute();
      const res = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ id: 999999, active: false }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );

      expect(res.status).toBe(404);
    });

    it('retorna 409 ao reativar com o limite cheio', async () => {
      await cleanupAllNews();
      const archived = await seedTestNews({
        title: 'Arquivada',
        active: false,
      });
      createdIds.push(archived.id);
      for (let i = 0; i < 10; i++) {
        const { id } = await seedTestNews({ title: `Cheia ${i}` });
        createdIds.push(id);
      }

      const { PATCH } = await importRoute();
      const res = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ id: archived.id, active: true }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE', () => {
    it('retorna 400 sem id', async () => {
      const { DELETE } = await importRoute();
      const res = await DELETE(newsUrl());

      expect(res.status).toBe(400);
    });

    it('retorna 400 com id inválido', async () => {
      const { DELETE } = await importRoute();
      const res = await DELETE(newsUrl('?id=abc'));

      expect(res.status).toBe(400);
    });

    it('retorna 409 ao tentar excluir uma notícia ativa', async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: 'Ativa',
        image: makeTestImage({ name: 'still-active.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      createdKeys.push(extractKeyFromUrl(result.news.image));

      const { DELETE } = await importRoute();
      const res = await DELETE(newsUrl(`?id=${result.news.id}`));

      expect(res.status).toBe(409);
      const body = await readJson<SuccessBody>(res);
      expect(body.error).toMatch(/inative/i);
    });

    it('exclui definitivamente uma notícia arquivada e remove do S3', async () => {
      const repo = await importNewsRepo();
      const result = await repo.create({
        title: 'Para Excluir',
        image: makeTestImage({ name: 'to-destroy.jpg' }),
      });
      createdIds.push(Number(result.news.id));
      const key = extractKeyFromUrl(result.news.image);
      createdKeys.push(key);

      await repo.setActive(result.news.id, false);

      const { DELETE } = await importRoute();
      const res = await DELETE(newsUrl(`?id=${result.news.id}`));

      expect(res.status).toBe(200);
      const body = await readJson<SuccessBody>(res);
      expect(body).toEqual({ success: true });

      expect(await objectExistsInS3(String(key))).toBe(false);

      const inactive = await repo.list({ status: 'inactive' });
      expect(inactive.items.map((item) => item.id)).not.toContain(
        result.news.id,
      );
    });

    it('retorna 404 quando notícia não existe', async () => {
      const { DELETE } = await importRoute();
      const res = await DELETE(newsUrl('?id=999999'));

      expect(res.status).toBe(404);
      const body = await readJson<SuccessBody>(res);
      expect(body.error).toMatch(/não encontrada/i);
    });
  });

  describe('fluxo completo', () => {
    it('cria, arquiva, lista inativas e exclui definitivamente', async () => {
      const form = new FormData();
      form.append('title', 'Fluxo Completo');
      form.append(
        'image',
        makeTestImage({ name: 'fluxo.jpg', type: 'image/jpeg' }),
      );

      const { POST } = await importRoute();
      const postRes = await POST(
        new Request('http://localhost/api/news', {
          body: form,
          method: 'POST',
        }),
      );
      expect(postRes.status).toBe(200);
      const postData = await readJson<NewsCreateBody>(postRes);
      const newsId = postData.news.id;
      createdIds.push(Number(newsId));
      createdKeys.push(extractKeyFromUrl(postData.news.image));

      const { DELETE, GET, PATCH } = await importRoute();

      const getRes = await GET(newsUrl());
      const getData = await readJson<NewsListBody>(getRes);
      const found = getData.news.find((n: { id: string }) => n.id === newsId);
      expect(found).toBeDefined();
      expect(found?.title).toBe('Fluxo Completo');

      const archiveRes = await PATCH(
        new Request('http://localhost/api/news', {
          body: JSON.stringify({ id: newsId, active: false }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        }),
      );
      expect(archiveRes.status).toBe(200);

      const getActive = await GET(newsUrl());
      const activeData = await readJson<NewsListBody>(getActive);
      expect(activeData.news.find((n) => n.id === newsId)).toBeUndefined();

      const getInactive = await GET(newsUrl('?status=inactive'));
      const inactiveData = await readJson<NewsListBody>(getInactive);
      expect(inactiveData.news.find((n) => n.id === newsId)).toBeDefined();

      const delRes = await DELETE(newsUrl(`?id=${newsId}`));
      expect(delRes.status).toBe(200);

      const getInactiveAgain = await GET(newsUrl('?status=inactive'));
      const inactiveAgain = await readJson<NewsListBody>(getInactiveAgain);
      expect(inactiveAgain.news.find((n) => n.id === newsId)).toBeUndefined();
    });
  });
});
