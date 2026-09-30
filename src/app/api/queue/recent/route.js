import { queue } from "@/lib/repositories";
import { requireSession } from "@/lib/api-auth";
import { SECTORS, DEFAULT_RECENT_LIMIT } from "@/lib/constants.js";

/**
 * GET /api/queue/recent?sector=farmacia&limit=30
 * Returns recent queue calls for a sector, plus the sector's reset marker.
 * Used as polling fallback when SSE is unavailable.
 *
 * The `resetAt` marker lets clients detect a reset performed on another device.
 * Calls made before the last reset are excluded — those rows survive the reset
 * (so `/historico` keeps working) but must never be replayed into a monitor.
 */
export async function GET(request) {
  const { error } = await requireSession();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const sector = searchParams.get("sector");
  const limit = parseInt(searchParams.get("limit") || String(DEFAULT_RECENT_LIMIT), 10);

  if (!sector || !Object.hasOwn(SECTORS, sector)) {
    return Response.json(
      { error: "Invalid sector." },
      { status: 400 },
    );
  }

  try {
    const resetAt = await queue.getSectorResetAt(sector);
    const calls = await queue.getRecentCalls(sector, limit, resetAt);
    return Response.json({
      calls,
      resetAt: resetAt ? resetAt.toISOString() : null,
    });
  } catch {
    return Response.json(
      { calls: [], resetAt: null, error: "Não foi possível carregar a fila." },
      { status: 500 },
    );
  }
}
