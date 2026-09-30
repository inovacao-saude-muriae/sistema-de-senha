import { NextResponse } from "next/server";
import { read } from "@/lib/repositories";
import { requireSession } from "@/lib/api-auth";
import { MIN_DAYS, MAX_DAYS, DEFAULT_DAYS } from "@/lib/constants.js";

/* ─────────────────────────────────────────────────
   GET — retorna estatísticas e histórico
   Query params:
   - days: número de dias (padrão 30, máx 90)
   - sector: filtro por setor ("farmacia"|"recepcao")
   - from: data inicial (YYYY-MM-DD)
   - to: data final (YYYY-MM-DD)
   Somente `/historico` consome esta rota, e ele é autenticado.
───────────────────────────────────────────────── */
export async function GET(request) {
  const { error } = await requireSession();
  if (error) return error;

  const url = new URL(request.url);
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number(url.searchParams.get("days")) || DEFAULT_DAYS));
  const sector = url.searchParams.get("sector") || null;
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;

  try {
    const stats = await read.getStats({ days, sector, from: from ? new Date(from) : null, to: to ? new Date(to) : null });
    return NextResponse.json(stats);
  } catch (err) {
    // On error, return empty structure to avoid breaking admin UI
    return NextResponse.json({
      days,
      summary: { total: 0, today: 0, preferencial: 0, normal: 0 },
      bySector: [],
      byType: [],
      recent: [],
      recentBySector: {},
      noDb: true,
    });
  }
}