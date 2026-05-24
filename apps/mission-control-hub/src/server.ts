import { insertEvent, updateLastSeen, getInstances, getEvents, type McEvent } from "./db";
import { validateApiKey } from "./auth";
import { addClient, removeClient, broadcast } from "./sse";

const port = parseInt(process.env.MC_PORT ?? "4001", 10);

Bun.serve({
  port,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // POST /events — ingest event
    if (req.method === "POST" && url.pathname === "/events") {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token || !validateApiKey(token)) {
        return new Response("Unauthorized", { status: 401 });
      }

      let event: McEvent;
      try {
        event = (await req.json()) as McEvent;
      } catch {
        return new Response("Bad Request", { status: 400 });
      }

      insertEvent(event);
      updateLastSeen(event.instance_id, event.ts);
      broadcast(event);

      return new Response("OK", { status: 200 });
    }

    // GET /events/stream — SSE fan-out
    if (req.method === "GET" && url.pathname === "/events/stream") {
      let controller!: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(c) {
          controller = c;
          addClient(controller);
        },
        cancel() {
          removeClient(controller);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // GET /api/instances — list all instances
    if (req.method === "GET" && url.pathname === "/api/instances") {
      const rows = getInstances();
      return Response.json(rows);
    }

    // GET /api/events — filtered event history
    if (req.method === "GET" && url.pathname === "/api/events") {
      const filters = {
        instance_id: url.searchParams.get("instance_id") ?? undefined,
        type: url.searchParams.get("type") ?? undefined,
        since: url.searchParams.get("since") ?? undefined,
      };
      const rows = getEvents(filters);
      return Response.json(rows);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`mission-control-hub listening on port ${port}`);
