import { prisma } from "../prisma-client.js";
import { MIN_DAYS, MAX_DAYS, DEFAULT_DAYS, LOCALE, CALL_TYPES } from "../constants.js";

/**
 * Build empty response structure
 * @param {number} days
 * @returns {Object}
 */
function emptyResponse(days) {
  return {
    days,
    summary: { total: 0, today: 0, preferencial: 0, normal: 0 },
    bySector: [],
    byType: [],
    recent: [],
    recentBySector: {},
    noDb: true,
  };
}

/**
 * Format date for display (HH:mm)
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Normalize a queue call record for frontend consumption
 * @param {any} call - raw database record
 * @returns {{ id:string, number:number, type:string, time:string }}
 */
function formatCallRecord(call) {
  return {
    id: String(call.id),
    sector_id: call.sector_id,
    number: call.number_int,
    type:
      call.type === CALL_TYPES.PREFERENTIAL || call.type === CALL_TYPES.PREFERENCIAL
        ? CALL_TYPES.PREFERENCIAL
        : CALL_TYPES.NORMAL,
    time: formatTime(new Date(call.created_at || Date.now())),
  };
}

export class ReadRepository {
  /**
   * Get stats for a time window with filters
   * @param {{
   *   sector?: 'farmacia'|'recepcao'|null,
   *   since?: Date,
   *   until?: Date|null,
   *   limit?: number
   * }} options
   * @returns {Promise<{
   *   days: number,
   *   summary: { total:number, today:number, preferencial:number, normal:number },
   *   bySector: Array<{sector:string, total:number}>,
   *   byType: Array<{type:string, total:number}>,
   *   recent: Array<{id:string, number:number, type:string, time:string}>,
   *   recentBySector: Record<string, Array<{id:string, number:number, type:string, time:string}>>
   * }>}
   */
  async getStats(options = {}) {
    try {
      // Parse options
      const sector = options.sector || null;
      const since = options.since
        ? new Date(options.since)
        : new Date(Date.now() - (options.days || DEFAULT_DAYS) * 24 * 60 * 60 * 1000);
      const until = options.until ? new Date(options.until) : null;
      const limit = options.limit || 200;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      // Build where clause for all calls
      const whereClause = {
        created_at: {
          gte: since.toISOString(),
        },
      };

      if (until) {
        whereClause.created_at.lte = until.toISOString();
      }

      if (sector) {
        whereClause.sector_id = sector;
      }

      // Build where clause for recent calls
      const recentWhereClause = { ...whereClause };

      // Execute both queries in parallel
      const [calls, recent] = await Promise.all([
        prisma.queue_calls.findMany({
          where: whereClause,
          select: {
            sector_id: true,
            type: true,
            created_at: true,
            number_int: true,
          },
        }),
        prisma.queue_calls.findMany({
          where: recentWhereClause,
          orderBy: { created_at: "desc" },
          take: limit,
          select: {
            id: true,
            sector_id: true,
            number_str: true,
            type: true,
            created_at: true,
            number_int: true,
          },
        }),
      ]);

      // Calculate totals
      const total = calls.length;
      const todayCount = calls.filter((c) => c.created_at >= todayIso).length;
      const prefCount = calls.filter((c) =>
        ["preferencial", "preferential"].includes(c.type),
      ).length;
      const normalCount = total - prefCount;

      // Group by sector
      const sectorMap = {};
      for (const c of calls) {
        sectorMap[c.sector_id] = (sectorMap[c.sector_id] || 0) + 1;
      }
      const bySector = Object.entries(sectorMap)
        .map(([sector, count]) => ({ sector, total: count }))
        .sort((a, b) => b.total - a.total);

      // Group by type
      const typeMap = {};
      for (const c of calls) {
        typeMap[c.type] = (typeMap[c.type] || 0) + 1;
      }
      const byType = Object.entries(typeMap)
        .map(([type, count]) => ({ type, total: count }))
        .sort((a, b) => b.total - a.total);

      // Format recent calls
      const formattedRecent = recent.map(formatCallRecord);

      // Group recent by sector (max 50 per sector)
      const recentBySector = {};
      for (const item of formattedRecent) {
        const sid = item.sector_id || "desconhecido";
        if (!recentBySector[sid]) recentBySector[sid] = [];
        if (recentBySector[sid].length < 50) recentBySector[sid].push(item);
      }

      return {
        days: Math.min(
          MAX_DAYS,
          Math.max(
            MIN_DAYS,
            Math.ceil((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
          ),
        ),
        summary: {
          total,
          today: todayCount,
          preferencial: prefCount,
          normal: normalCount,
        },
        bySector,
        byType,
        recent: formattedRecent,
        recentBySector,
      };
    } catch (error) {
      // On error, return empty structure instead of throwing
      const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number(options.days) || DEFAULT_DAYS));
      return emptyResponse(days);
    }
  }
}
