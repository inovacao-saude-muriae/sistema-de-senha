import { NextResponse } from "next/server";
import { queue } from "@/lib/repositories";
import { eventManager } from "@/lib/event-manager";
import { formatNumberString, normalizeCallType } from "@/lib/repositories/utils";
import { auth } from "@/auth";
import { SECTORS, LOCALE } from "@/lib/constants.js";

/* ─────────────────────────────────────────────────
   POST — chama próxima senha de um setor
   Fluxo:
   1. Valida setor e tipo
   2. Obtém próximo número
   3. Formata número (N001, P002, etc.)
   4. Salva chamada no banco
   5. Retorna número e tipo
───────────────────────────────────────────────── */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sector, type } = body;

    // Validate sector
    if (!sector || !Object.hasOwn(SECTORS, sector)) {
      return NextResponse.json(
        { error: "Setor não informado." },
        { status: 400 }
      );
    }

    // Normalize type
    const { sequenceType, callType } = normalizeCallType(type);

    // Get next number
    const nextResult = await queue.nextNumber(sector, sequenceType);
    const nextNum = nextResult.number;
    const isWraparound = nextResult.wraparound || false;
    const numberStr = formatNumberString(nextNum, sequenceType);

    const attendantId = session.user.id;

    // Save the call
    const saved = await queue.saveCall({
      sector,
      number: nextNum,
      numberStr,
      sequenceType,
      callType,
      attendantId,
    });

    // Emit realtime event for monitors
    const callEvent = {
      id: saved.id,
      number: nextNum,
      type: sequenceType,
      wraparound: isWraparound,
      time: new Intl.DateTimeFormat(LOCALE, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
    };
    eventManager.emitQueueCall(sector, callEvent);

    return NextResponse.json({
      success: true,
      number: nextNum,
      numberStr,
      type: sequenceType,
      wraparound: isWraparound,
    });
  } catch (err) {
    if (err.status === 503 || err.message.includes("not configured") || err.message.includes("Não configurado")) {
      return NextResponse.json(
        { error: err.message, useLocal: true },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Erro ao chamar próxima senha" },
      { status: err.status || 500 }
    );
  }
}