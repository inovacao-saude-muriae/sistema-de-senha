import type {
  CreateNewsInput,
  ListNewsOptions,
  NewsItem,
  NewsRepository,
} from '@/server/repositories/types';
import type { NewsPage } from '@/shared/types/domain';
import type { NewsSeedInput } from '../../contracts/news-repo.contract';

import { RouteError } from '@/server/http/errors';
import {
  NEWS_MAX_ACTIVE,
  NEWS_PAGE_SIZE,
  NEWS_STATUSES,
  NEWS_TITLE_MAX,
} from '@/shared/constants';
import {
  hasValidImageSignature,
  imageExtensionFor,
  isAllowedImageType,
  isValidFileSize,
  isValidNewsTitle,
  normalizePage,
  normalizePageSize,
} from '@/shared/validation';

const ACTIVE_LIMIT_MESSAGE = `Limite de ${NEWS_MAX_ACTIVE} notícias ativas atingido. Inative uma notícia antes de publicar ou reativar.`;

/**
 * In-memory implementation of NewsRepository for fast contract testing.
 */
export class InMemoryNewsRepository implements NewsRepository {
  #news = new Map<number, StoredNews>();

  #activeCount(): number {
    let count = 0;
    for (const item of this.#news.values()) {
      if (item.active) count++;
    }
    return count;
  }

  #nextId(): number {
    let max = 0;
    for (const id of this.#news.keys()) {
      if (id > max) max = id;
    }
    return max + 1;
  }

  async create(
    data: CreateNewsInput,
  ): Promise<{ news: NewsItem; success: true }> {
    const { title, image } = data;
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';

    if (!trimmedTitle) {
      throw new RouteError(400, 'Informe um título.');
    }
    if (!isValidNewsTitle(trimmedTitle)) {
      throw new RouteError(
        400,
        `O título deve ter no máximo ${NEWS_TITLE_MAX} caracteres.`,
      );
    }

    if (!image || typeof image === 'string') {
      throw new RouteError(400, 'Envie um arquivo de imagem.');
    }

    // A partir daqui `image` é `File` (o tipo estreita depois das checagens).
    if (!isAllowedImageType(image.type)) {
      throw new RouteError(
        400,
        'Formato inválido. Use JPG, PNG, WEBP, GIF ou AVIF.',
      );
    }
    if (!isValidFileSize(image.size)) {
      throw new RouteError(400, 'Imagem deve ter no máximo 5 MB.');
    }

    const bytes = new Uint8Array(await image.arrayBuffer());
    if (!hasValidImageSignature(bytes)) {
      throw new RouteError(400, 'O arquivo enviado não é uma imagem válida.');
    }

    if (this.#activeCount() >= NEWS_MAX_ACTIVE) {
      throw new RouteError(409, ACTIVE_LIMIT_MESSAGE);
    }

    const ext = imageExtensionFor(image.type);
    if (!ext) {
      throw new RouteError(
        400,
        'Formato inválido. Use JPG, PNG, WEBP, GIF ou AVIF.',
      );
    }

    const id = this.#nextId();
    const imageUrl = `https://fake.storage/news/${id}.${ext}`;

    const item: StoredNews = {
      id,
      title: trimmedTitle,
      active: true,
      created_at: new Date(),
      image_url: imageUrl,
    };
    this.#news.set(id, item);

    return { news: shapeNews(item), success: true };
  }

  async destroy(id: number | string): Promise<{ success: true }> {
    const newsId = parseNewsId(id);
    const item = this.#news.get(newsId);
    if (!item) {
      throw new RouteError(404, 'Notícia não encontrada.');
    }
    if (item.active) {
      throw new RouteError(
        409,
        'Inative a notícia antes de excluí-la definitivamente.',
      );
    }

    this.#news.delete(newsId);
    return { success: true };
  }

  async list(options: ListNewsOptions = {}): Promise<NewsPage> {
    const status = options.status ?? NEWS_STATUSES.ACTIVE;
    const pageSize = normalizePageSize(options.pageSize, NEWS_PAGE_SIZE);
    const requestedPage = normalizePage(options.page);

    const counts = {
      active: this.#activeCount(),
      inactive: this.#news.size - this.#activeCount(),
    };
    const filtered = [...this.#news.values()]
      .filter((item) =>
        status === NEWS_STATUSES.ACTIVE ? item.active : !item.active,
      )
      .sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() || b.id - a.id,
      );

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;

    return {
      counts,
      items: filtered
        .slice(start, start + pageSize)
        .map((item) => shapeNews(item)),
      pagination: { page, pageSize, total, totalPages },
    };
  }

  async listActive(): Promise<NewsItem[]> {
    return [...this.#news.values()]
      .filter((item) => item.active)
      .sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() || b.id - a.id,
      )
      .slice(0, NEWS_MAX_ACTIVE)
      .map((item) => shapeNews(item));
  }

  // --- Private helpers ---

  /**
   * Seed a news item into the in-memory store.
   * @returns `{ id, title }` para o teste reutilizar a linha criada.
   */
  seedNews(data: NewsSeedInput): { id: number; title: string } {
    const id = this.#nextId();
    const item: StoredNews = {
      id,
      title: data.title || `News ${Date.now()}`,
      active: data.active ?? true,
      created_at: data.created_at ?? new Date(),
      image_url: data.image || `https://fake.storage/news/${id}.jpg`,
    };
    this.#news.set(id, item);
    return { id, title: item.title };
  }

  async setActive(id: number | string, active: boolean): Promise<NewsItem> {
    const newsId = parseNewsId(id);
    const item = this.#news.get(newsId);
    if (!item) {
      throw new RouteError(404, 'Notícia não encontrada.');
    }

    if (active && !item.active && this.#activeCount() >= NEWS_MAX_ACTIVE) {
      throw new RouteError(409, ACTIVE_LIMIT_MESSAGE);
    }

    item.active = active;
    return shapeNews(item);
  }
}

/** Notícia gravada no Map — `NewsItem` é o formato devolvido na leitura. */
interface StoredNews {
  id: number;
  title: string;
  active: boolean;
  created_at: Date;
  image_url: string;
}

function parseNewsId(id: number | string): number {
  const value = Number(id);
  if (!Number.isInteger(value) || value < 1) {
    throw new RouteError(400, 'ID inválido.');
  }
  return value;
}

function shapeNews(item: StoredNews): NewsItem {
  return {
    id: String(item.id),
    title: item.title,
    active: item.active,
    image: item.image_url,
    createdAt: item.created_at.toISOString(),
  };
}
