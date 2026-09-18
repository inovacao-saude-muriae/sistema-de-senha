import { queue } from "@/lib/repositories";
import { SECTORS, DEFAULT_RECENT_LIMIT } from "@/lib/constants.js";

/**
 * GET /api/queue/recent?sector=farmacia&limit=30
 * Returns recent queue calls for a sector.
 * Used as polling fallback when SSE is unavailable.
 */
export async function GET(request) {
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
    const calls = await queue.getRecentCalls(sector, limit);
    return Response.json({ calls });
  } catch (error) {
    return Response.json({ calls: [], error: error.message }, { status: 500 });
  }
}
