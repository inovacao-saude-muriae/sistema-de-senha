import { afterEach, beforeEach, describe } from 'vitest';

import { newsRepoContract } from '../../contracts/news-repo.contract';
import {
  cleanupAllNews,
  cleanupTestNews,
  seedTestNews,
} from '../postgres-setup';

describe('NewsRepository — Postgres integration', () => {
  let seededIds: number[] = [];

  beforeEach(async () => {
    seededIds = [];
    // Isola cada caso: as asserções de contagem/paginação do contrato
    // dependem de a tabela não ter sobrado linhas dos casos anteriores.
    await cleanupAllNews();
  });

  afterEach(async () => {
    await cleanupTestNews(seededIds);
  });

  newsRepoContract(async () => {
    const { PostgresNewsRepository } =
      await import('@/server/repositories/news-repo.postgres');
    const repo = new PostgresNewsRepository();

    return {
      repo,
      seedNews: async (data) => {
        const result = await seedTestNews(data);
        seededIds.push(result.id);
        return result;
      },
    };
  });
});
