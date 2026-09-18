import { eventManager } from "@/lib/event-manager";
import { SECTORS, KEEPALIVE_INTERVAL } from "@/lib/constants.js";

/**
 * GET /api/queue/events?sector=farmacia
 * Server-Sent Events endpoint for realtime queue updates.
 * Maintains an open connection and pushes events when new queue calls are made.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sector = searchParams.get("sector");

  if (!sector || !Object.hasOwn(SECTORS, sector)) {
    return new Response("Invalid sector.", {
      status: 400,
    });
  }

  let unsubscribeCalls;
  let unsubscribeRecalls;
  let keepaliveTimer;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection comment to establish the stream
      controller.enqueue(":connected\n\n");

      // Keepalive comments to prevent proxy/browser timeouts
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(":ping\n\n");
        } catch {
          // Controller may be closed
          clearInterval(keepaliveTimer);
        }
      }, KEEPALIVE_INTERVAL);

      // Subscribe to queue calls for this sector
      unsubscribeCalls = eventManager.subscribeToQueue(sector, (call) => {
        try {
          const data = JSON.stringify({ type: "call", call });
          controller.enqueue(`data: ${data}\n\n`);
        } catch {
          // Controller may be closed
        }
      });

      // Subscribe to queue recalls for this sector
      unsubscribeRecalls = eventManager.subscribeToRecall(sector, (call) => {
        try {
          const data = JSON.stringify({ type: "recall", call });
          controller.enqueue(`data: ${data}\n\n`);
        } catch {
          // Controller may be closed
        }
      });
    },
    cancel() {
      // Cleanup when client disconnects
      clearInterval(keepaliveTimer);
      unsubscribeCalls?.();
      unsubscribeRecalls?.();
    },
  });

  // Handle client disconnect via abort signal
  request.signal.addEventListener("abort", () => {
    clearInterval(keepaliveTimer);
    unsubscribeCalls?.();
    unsubscribeRecalls?.();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
