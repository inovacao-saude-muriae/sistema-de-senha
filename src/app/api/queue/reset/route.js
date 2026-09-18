import { NextResponse } from "next/server";
import { queue } from "@/lib/repositories";
import { SECTORS, ALL_SECTORS } from "@/lib/constants.js";

/* ─────────────────────────────────────────────────
   POST — reseta a sequência de senhas de um setor
   Body: { sector: "farmacia"|"recepcao"|"all" }
───────────────────────────────────────────────── */
export async function POST(request) {
  try {
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
    const results = await Promise.all(
      sectorsToReset.map((s) => queue.resetSector(s))
    );

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
      { error: err.message || "Não foi possível zerar a fila." },
      { status: 500 }
    );
  }
}