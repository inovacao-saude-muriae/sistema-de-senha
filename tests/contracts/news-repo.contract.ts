import type { NewsRepository } from '@/server/repositories/types';

import { beforeEach, describe, expect, it } from 'vitest';

import { NEWS_MAX_ACTIVE, NEWS_TITLE_MAX } from '@/shared/constants';
import { makeTestImage } from '../helpers/images';

/** Fábrica devolvida por quem invoca o contrato (in-memory ou Postgres). */
export interface NewsRepoContext {
  readonly repo: NewsRepository;
  readonly seedNews: (
    data: NewsSeedInput,
  ) => Promise<{ id: number; title: string }> | { id: number; title: string };
}

/** Subconjunto do seed de notícia que os testes de contrato usam. */
export interface NewsSeedInput {
  readonly title?: string;
  readonly active?: boolean;
  readonly created_at?: Date;
  readonly image?: string;
}

/**
 * NewsRepository contract — shared test suite.
 * Pass a factory that returns { repo, seedNews }.
 * seedNews inserts a test news item and returns { id, title }.
 */
export function newsRepoContract(
  createRepo: () => NewsRepoContext | Promise<NewsRepoContext>,
): void {
  describe('NewsRepository contract', () => {
    let repo: NewsRepository;
    let seedNews: NewsRepoContext['seedNews'];

    beforeEach(async () => {
      const ctx = await createRepo();
      repo = ctx.repo;
      seedNews = ctx.seedNews;
    });

    describe('create()', () => {
      it('insere e retorna notícia com success: true', async () => {
        const result = await repo.create({
          title: 'Notícia Teste',
          image: makeTestImage({
            name: 'foto.jpg',
            size: 2048,
            type: 'image/jpeg',
          }),
        });

        expect(result.success).toBe(true);
        expect(result.news).toHaveProperty('id');
        expect(result.news.title).toBe('Notícia Teste');
        expect(result.news).toHaveProperty('image');
        expect(result.news.active).toBe(true);
        expect(result.news.createdAt).toEqual(expect.any(String));
      });

      it('lança erro para título vazio', async () => {
        await expect(
          repo.create({
            title: '',
            image: makeTestImage(),
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('lança erro para título acima do limite', async () => {
        await expect(
          repo.create({
            title: 'a'.repeat(NEWS_TITLE_MAX + 1),
            image: makeTestImage(),
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('lança erro para imagem inválida (não arquivo)', async () => {
        await expect(
          repo.create({
            title: 'Teste',
            image: 'nao-e-arquivo',
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('lança erro para formato não permitido', async () => {
        await expect(
          repo.create({
            title: 'Teste',
            image: makeTestImage({ type: 'application/pdf' }),
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('lança erro quando os bytes não são de imagem', async () => {
        await expect(
          repo.create({
            title: 'Teste',
            image: new File([new Uint8Array(1024)], 'falsa.jpg', {
              type: 'image/jpeg',
            }),
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('bloqueia a criação quando já há o máximo de ativas', async () => {
        for (let i = 0; i < NEWS_MAX_ACTIVE; i++) {
          await seedNews({ title: `Ativa ${i}` });
        }

        await expect(
          repo.create({
            title: 'Excedente',
            image: makeTestImage(),
          }),
        ).rejects.toMatchObject({ status: 409 });
      });
    });

    describe('list()', () => {
      it('filtra por status e devolve contadores', async () => {
        await seedNews({ title: 'Ativa 1' });
        await seedNews({ title: 'Ativa 2' });
        const { id: inactiveId } = await seedNews({ title: 'Inativa' });
        await repo.setActive(inactiveId, false);

        const activePage = await repo.list({ status: 'active' });
        const inactivePage = await repo.list({ status: 'inactive' });

        expect(activePage.items.map((item) => item.title)).toEqual([
          'Ativa 2',
          'Ativa 1',
        ]);
        expect(inactivePage.items.map((item) => item.title)).toEqual([
          'Inativa',
        ]);
        expect(activePage.counts).toEqual({ active: 2, inactive: 1 });
        expect(inactivePage.counts).toEqual({ active: 2, inactive: 1 });
      });

      it('pagina e clampa a página pedida', async () => {
        for (let i = 0; i < 5; i++) {
          await seedNews({
            title: `Notícia ${i}`,
            created_at: new Date(2026, 0, i + 1),
          });
        }

        const first = await repo.list({ page: 1, pageSize: 2 });
        const third = await repo.list({ page: 3, pageSize: 2 });
        const beyond = await repo.list({ page: 99, pageSize: 2 });

        expect(first.items).toHaveLength(2);
        expect(first.items[0].title).toBe('Notícia 4');
        expect(first.pagination).toEqual({
          page: 1,
          pageSize: 2,
          total: 5,
          totalPages: 3,
        });
        expect(third.items.map((item) => item.title)).toEqual(['Notícia 0']);
        expect(beyond.pagination.page).toBe(3);
      });
    });

    describe('listActive()', () => {
      it('retorna array de notícias ativas', async () => {
        await seedNews({ title: 'Ativa 1' });
        await seedNews({ title: 'Ativa 2' });
        const list = await repo.listActive();
        expect(Array.isArray(list)).toBe(true);
      });

      it('cada item tem campos obrigatórios', async () => {
        await seedNews({ title: 'Campo Obrigatório' });
        const list = await repo.listActive();
        if (list.length > 0) {
          const item = list[0];
          expect(item).toHaveProperty('id');
          expect(item).toHaveProperty('title');
          expect(item).toHaveProperty('image');
          expect(item).toHaveProperty('active');
          expect(item).toHaveProperty('createdAt');
        }
      });

      it('não inclui notícias arquivadas', async () => {
        const { id } = await seedNews({ title: 'Será Removida' });
        await repo.setActive(id, false);
        const list = await repo.listActive();
        const found = list.find((n) => n.id === String(id));
        expect(found).toBeUndefined();
      });

      it('respeita o teto de ativas do monitor', async () => {
        for (let i = 0; i < NEWS_MAX_ACTIVE + 5; i++) {
          await seedNews({ title: `Ativa ${i}` });
        }
        const list = await repo.listActive();
        expect(list).toHaveLength(NEWS_MAX_ACTIVE);
      });
    });

    describe('setActive()', () => {
      it('arquiva sem apagar a notícia (soft delete reativável)', async () => {
        const { id } = await seedNews({ title: 'Para arquivar' });

        const archived = await repo.setActive(id, false);
        expect(archived.active).toBe(false);

        const inactive = await repo.list({ status: 'inactive' });
        expect(inactive.items.map((item) => item.id)).toContain(String(id));
      });

      it('reativa uma notícia arquivada', async () => {
        const { id } = await seedNews({ title: 'Para reativar' });
        await repo.setActive(id, false);

        const restored = await repo.setActive(id, true);
        expect(restored.active).toBe(true);

        const active = await repo.list({ status: 'active' });
        expect(active.items.map((item) => item.id)).toContain(String(id));
      });

      it('lança 404 para notícia inexistente', async () => {
        await expect(repo.setActive(999999, false)).rejects.toMatchObject({
          status: 404,
        });
      });

      it('lança 400 para ID inválido', async () => {
        await expect(repo.setActive(-1, true)).rejects.toMatchObject({
          status: 400,
        });
        await expect(repo.setActive(0, true)).rejects.toMatchObject({
          status: 400,
        });
      });

      it('bloqueia a reativação quando o limite está cheio', async () => {
        const { id } = await seedNews({ title: 'Arquivada' });
        await repo.setActive(id, false);
        for (let i = 0; i < NEWS_MAX_ACTIVE; i++) {
          await seedNews({ title: `Ativa ${i}` });
        }

        await expect(repo.setActive(id, true)).rejects.toMatchObject({
          status: 409,
        });
      });
    });

    describe('destroy()', () => {
      it('lança 409 ao tentar excluir uma notícia ativa', async () => {
        const { id } = await seedNews({ title: 'Ainda ativa' });
        await expect(repo.destroy(id)).rejects.toMatchObject({ status: 409 });
      });

      it('exclui definitivamente uma notícia arquivada', async () => {
        const { id } = await seedNews({ title: 'Para excluir' });
        await repo.setActive(id, false);

        await expect(repo.destroy(id)).resolves.toEqual({ success: true });

        const inactive = await repo.list({ status: 'inactive' });
        expect(inactive.items.map((item) => item.id)).not.toContain(String(id));
      });

      it('lança 404 para notícia inexistente', async () => {
        await expect(repo.destroy(999999)).rejects.toMatchObject({
          status: 404,
        });
      });

      it('lança 400 para ID inválido', async () => {
        await expect(repo.destroy(-1)).rejects.toMatchObject({ status: 400 });
        await expect(repo.destroy(0)).rejects.toMatchObject({ status: 400 });
      });
    });
  });
}
