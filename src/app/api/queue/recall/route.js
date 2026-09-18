import { NextResponse } from "next/server";
import { queue } from "@/lib/repositories";
import { eventManager } from "@/lib/event-manager";
import { auth } from "@/auth";
import { SECTORS, LOCALE } from "@/lib/constants.js";

/* ─────────────────────────────────────────────────
   POST — repete a última senha chamada de um setor
   Emite evento SSE para os monitores reproduzirem o áudio.
───────────────────────────────────────────────── */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sector } = body;

    if (!sector || !Object.hasOwn(SECTORS, sector)) {
      return NextResponse.json(
        { error: "Setor não informado." },
        { status: 400 }
      );
    }

    const calls = await queue.getRecentCalls(sector, 1);
    if (!calls.length) {
      return NextResponse.json(
        { error: "Nenhuma senha anterior para repetir." },
        { status: 404 }
      );
    }

    const last = calls[0];

    const callEvent = {
      id: last.id,
      number: last.number,
      type: last.type,
      time: new Intl.DateTimeFormat(LOCALE, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
    };

    eventManager.emitQueueRecall(sector, callEvent);

    return NextResponse.json({
      success: true,
      number: last.number,
      type: last.type,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Erro ao repetir senha" },
      { status: err.status || 500 }
    );
  }
}
