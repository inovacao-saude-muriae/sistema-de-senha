import 'server-only';

import type {
  CreateNewsInput,
  ListNewsOptions,
} from '@/server/repositories/types';
import type { NewsItem, NewsPage } from '@/shared/types/domain';

import { news } from '@/server/repositories';

/**
 * Use cases de notícias.
 *
 * O upload/rollback e as validações de arquivo continuam no repositório; o
 * serviço é o ponto de entrada do backend caso outras superfícies (ex.: um
 * job administrativo) precisem listar/criar/remover notícias sem passar por
 * HTTP.
 */

export function createNews(
  data: CreateNewsInput,
): Promise<{ news: NewsItem; success: true }> {
  return news.create(data);
}

export function deleteNews(id: number | string): Promise<{ success: true }> {
  return news.destroy(id);
}

/** Recorte fixo do monitor (10 mais recentes ativas). */
export function listActiveNews(): Promise<NewsItem[]> {
  return news.listActive();
}

/** Listagem paginada do admin (status + contadores). */
export function listNews(options?: ListNewsOptions): Promise<NewsPage> {
  return news.list(options);
}

export function setNewsActive(
  id: number | string,
  active: boolean,
): Promise<NewsItem> {
  return news.setActive(id, active);
}
