import { prisma } from "../prisma-client.js";
import { normalizeCallType } from "./utils.js";
import {
  DEFAULT_QUEUE_NUMBER,
  DEFAULT_RECENT_LIMIT,
  LOCALE,
  MAX_QUEUE_NUMBER,
  MIN_QUEUE_NUMBER
} from "../constants.js";

/**
 * Format time for display (HH:mm)
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export class QueueRepository {
  /**
   * Get next number for sector and type (normal/preferencial)
   * Uses atomic transaction with upsert + wraparound at `MAX_QUEUE_NUMBER`.
   * Returns { number, wraparound } — wraparound is true when 999→000 occurs.
   * @param {'farmacia'|'recepcao'} sector
   * @param {'normal'|'preferencial'} type
   * @returns {Promise<{ number: number, wraparound: boolean }>}
   */
  async nextNumber(sector, type) {
    const { sequenceType } = normalizeCallType(type);

    return await prisma.$transaction(async (tx) => {
      // Upsert the sequence row, incrementing the counter atomically.
      // New rows start at 0 (first password = 000). Prisma's upsert applies
      // the increment only to existing rows, so a newly created row returns
      // the create value (0) directly.
      const seq = await tx.queue_sequences.upsert({
        where: {
          sector_id_call_type: {
            sector_id: sector,
            call_type: sequenceType,
          },
        },
        update: {
          current_number: { increment: 1 },
          updated_at: new Date(),
        },
        create: {
          sector_id: sector,
          call_type: sequenceType,
          current_number: 0,
        },
      });

      // Handle wraparound: if counter exceeded MAX, reset to -1 and return 0
      if (seq.current_number > MAX_QUEUE_NUMBER) {
        await tx.queue_sequences.update({
          where: {
            sector_id_call_type: {
              sector_id: sector,
              call_type: sequenceType,
            },
          },
          data: {
            current_number: MIN_QUEUE_NUMBER - 1,
            updated_at: new Date(),
          },
        });
        return { number: MIN_QUEUE_NUMBER, wraparound: true };
      }

      return { number: seq.current_number, wraparound: false };
    });
  }

  /**
   * Save a queue call
   * @param {{
   *   sector: 'farmacia'|'recepcao',
   *   number: number,
   *   numberStr: string,
   *   sequenceType: 'normal'|'preferencial',
   *   callType: 'normal'|'preferencial',
   *   attendantId: string|null
   * }} call
   * @returns {Promise<{id: string}>}
   */
  async saveCall(call) {
    const { sector, number, numberStr, sequenceType, attendantId } = call;

    // Validate attendantId format (UUID v1-v8)
    const callerId =
      attendantId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attendantId,
      )
        ? attendantId
        : null;

    const created = await prisma.queue_calls.create({
      data: {
        sector_id: sector,
        type: sequenceType,
        number_int: number,
        number_str: numberStr,
        called_by: callerId,
      },
    });

    return { id: String(created.id) };
  }

  /**
   * Reset sequence for sector.
   * Sets counter to -1 so the next call returns 0 (first password = 000).
   * @param {'farmacia'|'recepcao'} sector
   * @returns {Promise<void>}
   */
  async resetSector(sector) {
    await prisma.queue_sequences.updateMany({
      where: {
        sector_id: sector,
      },
      data: {
        current_number: MIN_QUEUE_NUMBER - 1,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Set next number for sector and type (sync/reset to specific value)
   * The next call to nextNumber() will return this value.
   * @param {'farmacia'|'recepcao'} sector
   * @param {'normal'|'preferencial'} type
   * @param {number} nextNumber - The next number to return
   * @returns {Promise<void>}
   */
  async setNextNumber(sector, type, nextNumber) {
    const { sequenceType } = normalizeCallType(type);
    const num = Number(nextNumber);

    if (!Number.isInteger(num) || num < MIN_QUEUE_NUMBER || num > MAX_QUEUE_NUMBER) {
      throw new Error(`Número inválido ("${num}"). Use um valor entre ${MIN_QUEUE_NUMBER} e ${MAX_QUEUE_NUMBER}.`);
    }

    // Store nextNumber - 1 because nextNumber() increments before returning
    const currentNumber = num - 1;

    await prisma.queue_sequences.upsert({
      where: {
        sector_id_call_type: {
          sector_id: sector,
          call_type: sequenceType,
        },
      },
      update: {
        current_number: currentNumber,
        updated_at: new Date(),
      },
      create: {
        sector_id: sector,
        call_type: sequenceType,
        current_number: currentNumber,
      },
    });
  }

  /**
   * Get recent calls for a sector (for monitor history)
   * @param {'farmacia'|'recepcao'} sector
   * @param {number} limit
   * @returns {Promise<Array<{
   *   id: string,
   *   number: number,
   *   type: string,
   *   time: string
   * }>>}
   */
  async getRecentCalls(sector, limit = DEFAULT_RECENT_LIMIT) {
    try {
      const calls = await prisma.queue_calls.findMany({
        where: {
          sector_id: sector,
        },
        orderBy: {
          created_at: "desc",
        },
        take: limit,
        select: {
          id: true,
          number_int: true,
          type: true,
          created_at: true,
        },
      });

      return calls.map((call) => ({
        id: String(call.id),
        number: call.number_int,
        type:
          call.type === "preferential" || call.type === "preferencial"
            ? "preferencial"
            : "normal",
        time: formatTime(new Date(call.created_at || Date.now())),
      }));
    } catch {
      return [];
    }
  }
}
