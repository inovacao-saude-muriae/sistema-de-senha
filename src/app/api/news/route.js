import { NextResponse } from "next/server";
import { news } from "@/lib/repositories";
import { requireSession, requireRole } from "@/lib/api-auth";

/* ─────────────────────────────────────────────────
   GET — lista notícias ativas
   Usado pelo admin e pelos monitores (ambos autenticados).
───────────────────────────────────────────────── */
export async function GET() {
  try {
    const { error } = await requireSession();
    if (error) return error;

    const newsList = await news.listActive();
    return NextResponse.json({ news: newsList });
  } catch {
    return NextResponse.json(
      { error: "Erro ao carregar notícias" },
      { status: 500 }
    );
  }
}

/* ─────────────────────────────────────────────────
   POST — cria nova notícia (upload + banco)
   Restrito a administradores: o texto e a imagem aparecem nos monitores.
───────────────────────────────────────────────── */
export async function POST(request) {
  try {
    const { error } = await requireRole();
    if (error) return error;

    const formData = await request.formData();
    const title = formData.get("title");
    const image = formData.get("image");

    if (!title || !image) {
      return NextResponse.json(
        { error: "Título e imagem são obrigatórios" },
        { status: 400 }
      );
    }

    const result = await news.create({ title, image });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Erro ao salvar notícia" },
      { status: err.status || 500 }
    );
  }
}

/* ─────────────────────────────────────────────────
   DELETE — remove notícia (soft delete + storage)
   Restrito a administradores.
───────────────────────────────────────────────── */
export async function DELETE(request) {
  try {
    const { error } = await requireRole();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "ID da notícia é obrigatório" },
        { status: 400 }
      );
    }

    await news.remove(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Erro ao excluir notícia" },
      { status: err.status || 500 }
    );
  }
}
