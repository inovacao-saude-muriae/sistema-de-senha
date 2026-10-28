import 'server-only';

import type { Prisma } from '@/server/generated/prisma/client';
import type { NewsPage } from '@/shared/types/domain';
import type {
  CreateNewsInput,
  ListNewsOptions,
  NewsItem,
  NewsRepository,
} from './types';

import { prisma } from '@/server/db/prisma-client';
import { routeError, RouteError } from '@/server/http/errors';
import {
  deleteFromS3,
  extractKeyFromUrl,
  getPublicUrl,
  uploadToS3,
} from '@/server/storage/s3-client';
import {
  NEWS_MAX_ACTIVE,
  NEWS_PAGE_SIZE,
  NEWS_STATUSES,
  NEWS_TITLE_MAX,
} from '@/shared/constants';
import { errorMessage } from '@/shared/errors';
import {
  hasValidImageSignature,
  imageExtensionFor,
  isAllowedImageType,
  isValidFileSize,
  isValidNewsTitle,
  normalizePage,
  normalizePageSize,
} from '@/shared/validation';

const NEWS_SELECT = {
  id: true,
  title: true,
  active: true,
  created_at: true,
  image_url: true,
} as const;

/**
 * Mais recentes primeiro. O `id` desempata linhas com o mesmo `created_at`
 * (o seed e os testes criam várias no mesmo instante) e `nulls: 'last'`
 * mantém linhas legadas sem data no fim, em vez de no topo.
 */
const NEWS_ORDER_BY: Prisma.newsOrderByWithRelationInput[] = [
  { created_at: { nulls: 'last', sort: 'desc' } },
  { id: 'desc' },
];

const ACTIVE_LIMIT_MESSAGE = `Limite de ${NEWS_MAX_ACTIVE} notícias ativas atingido. Inative uma notícia antes de publicar ou reativar.`;

export class PostgresNewsRepository implements NewsRepository {
  /** Create a news item (upload image to S3 + save to db) */
  async create({
    title,
    image,
  }: CreateNewsInput): Promise<{ news: NewsItem; success: true }> {
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    if (!trimmedTitle) {
      throw routeError(400, 'Informe um título.');
    }
    if (!isValidNewsTitle(trimmedTitle)) {
      throw routeError(
        400,
        `O título deve ter no máximo ${NEWS_TITLE_MAX} caracteres.`,
      );
    }
    if (!image || typeof image === 'string') {
      throw routeError(400, 'Envie um arquivo de imagem.');
    }
    if (!isAllowedImageType(image.type)) {
      throw routeError(
        400,
        'Formato inválido. Use JPG, PNG, WEBP, GIF ou AVIF.',
      );
    }
    if (!isValidFileSize(image.size)) {
      throw routeError(400, 'Imagem deve ter no máximo 5 MB.');
    }

    // A extensão sai do MIME, nunca do nome enviado pelo cliente.
    const ext = imageExtensionFor(image.type);
    if (!ext) {
      throw routeError(
        400,
        'Formato inválido. Use JPG, PNG, WEBP, GIF ou AVIF.',
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    if (!hasValidImageSignature(buffer)) {
      throw routeError(400, 'O arquivo enviado não é uma imagem válida.');
    }

    try {
      const activeCount = await prisma.news.count({ where: { active: true } });
      if (activeCount >= NEWS_MAX_ACTIVE) {
        throw routeError(409, ACTIVE_LIMIT_MESSAGE);
      }

      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      try {
        await uploadToS3(fileName, buffer, image.type);
      } catch (error) {
        throw routeError(
          500,
          errorMessage(error, 'Erro ao fazer upload da imagem.'),
        );
      }

      const imageUrl = getPublicUrl(fileName);

      try {
        const row = await prisma.news.create({
          data: { title: trimmedTitle, image_url: imageUrl },
          select: NEWS_SELECT,
        });

        return { news: shapeNews(row), success: true };
      } catch (error) {
        // Rollback: delete from S3 if DB write fails
        await deleteFromS3(fileName);
        throw error;
      }
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw routeError(500, errorMessage(error, 'Erro ao salvar notícia.'));
    }
  }

  /**
   * Exclusão definitiva. A linha some antes do objeto: se o S3 falhar, sobra
   * um arquivo órfão — nunca uma notícia ativa apontando para uma imagem que
   * já não existe.
   */
  async destroy(id: number | string): Promise<{ success: true }> {
    try {
      const newsId = parseNewsId(id);
      const row = await prisma.news.findUnique({
        select: { active: true, image_url: true },
        where: { id: newsId },
      });

      if (!row) {
        throw routeError(404, 'Notícia não encontrada.');
      }
      if (row.active) {
        throw routeError(
          409,
          'Inative a notícia antes de excluí-la definitivamente.',
        );
      }

      await prisma.news.delete({ where: { id: newsId } });

      // Best effort: remove image from S3
      const key = extractKeyFromUrl(row.image_url);
      if (key) await deleteFromS3(key);

      return { success: true };
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw routeError(500, errorMessage(error, 'Erro ao excluir notícia.'));
    }
  }

  /**
   * Listagem administrativa: filtra por status, pagina e devolve os
   * contadores das duas abas.
   */
  async list(options: ListNewsOptions = {}): Promise<NewsPage> {
    const status = options.status ?? NEWS_STATUSES.ACTIVE;
    const where = { active: status === NEWS_STATUSES.ACTIVE };
    const pageSize = normalizePageSize(options.pageSize, NEWS_PAGE_SIZE);
    const requestedPage = normalizePage(options.page);

    try {
      const [total, active, inactive] = await Promise.all([
        prisma.news.count({ where }),
        prisma.news.count({ where: { active: true } }),
        prisma.news.count({ where: { active: false } }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, totalPages);

      const rows =
        total === 0
          ? []
          : await prisma.news.findMany({
              orderBy: NEWS_ORDER_BY,
              select: NEWS_SELECT,
              skip: (page - 1) * pageSize,
              take: pageSize,
              where,
            });

      return {
        counts: { active, inactive },
        items: rows.map((row) => shapeNews(row)),
        pagination: { page, pageSize, total, totalPages },
      };
    } catch (error) {
      throw routeError(500, errorMessage(error, 'Erro ao carregar notícias.'));
    }
  }

  /** List active news (limited to `NEWS_MAX_ACTIVE`, most recent first) */
  async listActive(): Promise<NewsItem[]> {
    try {
      const rows = await prisma.news.findMany({
        orderBy: NEWS_ORDER_BY,
        select: NEWS_SELECT,
        take: NEWS_MAX_ACTIVE,
        where: { active: true },
      });

      return rows.map((row) => shapeNews(row));
    } catch {
      return [];
    }
  }

  /**
   * Arquiva ou reativa. Não mexe no S3: a imagem continua disponível para
   * pré-visualização e para uma futura reativação.
   */
  async setActive(id: number | string, active: boolean): Promise<NewsItem> {
    try {
      const newsId = parseNewsId(id);
      const row = await prisma.news.findUnique({
        select: NEWS_SELECT,
        where: { id: newsId },
      });

      if (!row) {
        throw routeError(404, 'Notícia não encontrada.');
      }

      if (active && !row.active) {
        const activeCount = await prisma.news.count({
          where: { active: true },
        });
        if (activeCount >= NEWS_MAX_ACTIVE) {
          throw routeError(409, ACTIVE_LIMIT_MESSAGE);
        }
      }

      const updated = await prisma.news.update({
        data: { active },
        select: NEWS_SELECT,
        where: { id: newsId },
      });

      return shapeNews(updated);
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw routeError(500, errorMessage(error, 'Erro ao atualizar notícia.'));
    }
  }
}

/** Valida e converte o id opaco da borda HTTP. */
function parseNewsId(id: number | string): bigint {
  const value = Number(id);
  if (!Number.isInteger(value) || value < 1) {
    throw routeError(400, 'ID inválido.');
  }
  return BigInt(value);
}

/** Formato de linha do Prisma → formato de wire. */
function shapeNews(row: {
  readonly id: bigint;
  readonly title: string;
  readonly active: boolean;
  readonly created_at: Date | null;
  readonly image_url: string;
}): NewsItem {
  return {
    id: String(row.id),
    title: row.title,
    active: row.active,
    image: row.image_url,
    createdAt: row.created_at?.toISOString() ?? null,
  };
}
