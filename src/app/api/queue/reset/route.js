import { NextResponse } from "next/server";
import { queue } from "@/lib/repositories";
import { eventManager } from "@/lib/event-manager";
import { requireRole } from "@/lib/api-auth";
import { SECTORS, ALL_SECTORS } from "@/lib/constants.js";

/* ─────────────────────────────────────────────────
   POST — reseta a sequência de senhas de um setor
   Body: { sector: "farmacia"|"recepcao"|"all" }
   Restrito a administradores: o reset é destrutivo e vale para
   todos os dispositivos conectados via SSE.
───────────────────────────────────────────────── */
export async function POST(request) {
  try {
    const { error } = await requireRole();
    if (error) return error;

    const { sector } = await request.json();

    if (!sector) {
      return NextResponse.json(
        { error: "Setor não informado." },
        { status: 400 }
      );
    }

    const sectorsToReset =
      sector === ALL_SECTORS ? Object.keys(SECTORS) : [sector];

    if (!sectorsToReset.every((s) => Object.hasOwn(SECTORS, s))) {
      return NextResponse.json(
        { error: "Setor inválido." },
        { status: 400 }
      );
    }

    // Reset each sector
    await Promise.all(sectorsToReset.map((s) => queue.resetSector(s)));

    // Notify every connected client. Emitting per sector lets each sector's own
    // stream carry the event, so `sector: "all"` propagates naturally.
    for (const s of sectorsToReset) {
      const resetAt = await queue.getSectorResetAt(s);
      eventManager.emitQueueReset(s, resetAt ? resetAt.toISOString() : null);
    }

    return NextResponse.json({
      success: true,
      sectors: sectorsToReset,
    });
  } catch (err) {
    if (err.status) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Não foi possível zerar a fila." },
      { status: 500 }
    );
  }
}
