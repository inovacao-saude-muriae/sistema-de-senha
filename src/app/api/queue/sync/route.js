import { NextResponse } from "next/server";
import { queue } from "@/lib/repositories";
import { eventManager } from "@/lib/event-manager";
import { formatNumberString, normalizeCallType } from "@/lib/repositories/utils";
import { auth } from "@/auth";
import { SECTORS, MIN_QUEUE_NUMBER, MAX_QUEUE_NUMBER } from "@/lib/constants.js";

/* ─────────────────────────────────────────────────
   POST — sincroniza a fila para um número específico
   Body: { sector, type, nextNumber }
───────────────────────────────────────────────── */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sector, type, nextNumber } = body;

    // Validate sector
    if (!sector || !Object.hasOwn(SECTORS, sector)) {
      return NextResponse.json(
        { error: "Setor não informado." },
        { status: 400 }
      );
    }

    // Normalize type
    const { sequenceType } = normalizeCallType(type);

    // Validate nextNumber
    const num = Number(nextNumber);
    if (!Number.isInteger(num) || num < MIN_QUEUE_NUMBER || num > MAX_QUEUE_NUMBER) {
      return NextResponse.json(
        { error: `Número inválido. Use um valor entre ${MIN_QUEUE_NUMBER} e ${MAX_QUEUE_NUMBER}.` },
        { status: 400 }
      );
    }

    // Set the next number in the database
    await queue.setNextNumber(sector, sequenceType, num);

    // Format for response
    const numberStr = formatNumberString(num, sequenceType);

    return NextResponse.json({
      success: true,
      sector,
      type: sequenceType,
      nextNumber: num,
      numberStr,
      message: `Próxima senha de ${SECTORS[sector]?.name || sector}: ${numberStr}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Erro ao sincronizar fila" },
      { status: err.status || 500 }
    );
  }
}
