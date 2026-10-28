import type { ListNewsOptions } from '@/server/repositories/types';
import type { NewsPatchBody } from '@/shared/types/api';

import { NextResponse } from 'next/server';

import { requirePermission, requireSession } from '@/server/http/api-auth';
import {
  createNews,
  deleteNews,
  listNews,
  setNewsActive,
} from '@/server/services/news-service';
import { isNewsStatus, NEWS_MAX_ACTIVE } from '@/shared/constants';
import { errorMessage, errorStatus } from '@/shared/errors';
import { NEWS_CREATE, NEWS_DELETE } from '@/shared/permissions';

/* ─────────────────────────────────────────────────
   DELETE — exclusão definitiva (linha + storage)
   Só vale para notícias inativas: o fluxo normal é arquivar (PATCH).
   Exige a permissão `noticias.excluir`.
───────────────────────────────────────────────── */
export async function DELETE(request: Request) {
  try {
    const { error } = await requirePermission(NEWS_DELETE);
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID da notícia é obrigatório' },
        { status: 400 },
      );
    }

    await deleteNews(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, 'Erro ao excluir notícia') },
      { status: errorStatus(error, 500) },
    );
  }
}

/* ─────────────────────────────────────────────────
   GET — lista notícias com status + paginação
   Sem query string mantém o recorte do monitor (ativas, página 1, 10
   itens). O admin envia `status`, `page` e `pageSize` explicitamente.
   Usado pelo admin e pelos monitores (ambos autenticados).
───────────────────────────────────────────────── */
export async function GET(request?: Request) {
  try {
    const { error } = await requireSession();
    if (error) return error;

    const page = await listNews(readListOptions(request));
    return NextResponse.json({
      counts: page.counts,
      news: page.items,
      pagination: page.pagination,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, 'Erro ao carregar notícias') },
      { status: errorStatus(error, 500) },
    );
  }
}

/* ─────────────────────────────────────────────────
   PATCH — arquiva ou reativa (soft delete utilizável)
   Arquivar exige `noticias.excluir`; reativar, `noticias.criar`.
───────────────────────────────────────────────── */
export async function PATCH(request: Request) {
  try {
    const body = (await request
      .json()
      .catch<NewsPatchBody>(() => ({}))) as NewsPatchBody;

    if (body.id === undefined || body.id === null || body.id === '') {
      return NextResponse.json(
        { error: 'ID da notícia é obrigatório' },
        { status: 400 },
      );
    }
    if (typeof body.active !== 'boolean') {
      return NextResponse.json(
        { error: 'Informe se a notícia deve ficar ativa' },
        { status: 400 },
      );
    }

    const { error } = body.active
      ? await requirePermission(NEWS_CREATE)
      : await requirePermission(NEWS_DELETE);
    if (error) return error;

    const news = await setNewsActive(String(body.id), body.active);
    return NextResponse.json({ news, success: true });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, 'Erro ao atualizar notícia') },
      { status: errorStatus(error, 500) },
    );
  }
}

/* ─────────────────────────────────────────────────
   POST — cria nova notícia (upload + banco)
   Exige a permissão `noticias.criar`: o texto e a imagem aparecem nos
   monitores. Com `NEWS_MAX_ACTIVE` publicadas, responde 409 e a UI abre o
   gerenciador rápido de ativas.
───────────────────────────────────────────────── */
export async function POST(request: Request) {
  try {
    const { error } = await requirePermission(NEWS_CREATE);
    if (error) return error;

    const formData = await request.formData();
    const title = formData.get('title');
    const image = formData.get('image');

    // `FormData.get` devolve `string | File | null`; o título é sempre uma
    // parte de texto, então o `typeof` rejeita multipart malformado em vez
    // de deixar um `File` chegar até o insert.
    if (typeof title !== 'string' || !title || !image) {
      return NextResponse.json(
        { error: 'Título e imagem são obrigatórios' },
        { status: 400 },
      );
    }

    const result = await createNews({ title, image });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, 'Erro ao salvar notícia') },
      { status: errorStatus(error, 500) },
    );
  }
}

/** Query string → opções do repositório. */
function readListOptions(request?: Request): ListNewsOptions {
  if (!request) {
    return { pageSize: NEWS_MAX_ACTIVE };
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const pageSize = searchParams.get('pageSize');

  return {
    page: Number(searchParams.get('page')),
    pageSize: pageSize === null ? NEWS_MAX_ACTIVE : Number(pageSize),
    status: isNewsStatus(status) ? status : undefined,
  };
}
