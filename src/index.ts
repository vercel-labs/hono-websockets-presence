import "dotenv/config"; // Load .env before any module reads process.env.
import { createServer } from "node:http";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { presence } from "./presence.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

type SocketState = { roomId: string };

// Connections this instance currently holds. Each instance only broadcasts to
// and heartbeats its own sockets; the shared roster for each room comes from Redis.
const sockets = new Map<WSContext, SocketState>();
const localIds = new Map<string, Map<string, number>>();

function normalizeRoomId(value: string | undefined): string {
  const roomId = value?.toLowerCase();
  if (roomId && /^[a-z0-9-]{1,64}$/.test(roomId)) return roomId;
  return "lobby";
}

function trackLocal(roomId: string, id: string): void {
  ensureHeartbeatTimer();
  let room = localIds.get(roomId);
  if (!room) {
    room = new Map();
    localIds.set(roomId, room);
  }
  room.set(id, (room.get(id) ?? 0) + 1);
}

function untrackLocal(roomId: string, id: string): boolean {
  const room = localIds.get(roomId);
  if (!room) return true;
  const next = (room.get(id) ?? 1) - 1;
  if (next > 0) {
    room.set(id, next);
    return false;
  }
  room.delete(id);
  if (room.size === 0) localIds.delete(roomId);
  return true;
}

async function broadcast(roomId: string): Promise<void> {
  const members = await presence.members(roomId);
  const message = JSON.stringify({
    type: "presence",
    roomId,
    count: members.length,
    members,
  });
  for (const [ws, state] of sockets) {
    if (state.roomId !== roomId) continue;
    try {
      ws.send(message);
    } catch {
      // Socket may have closed between our snapshot and send; ignore.
    }
  }
}

// Re-broadcast whenever presence changes on *another* instance. A join/leave
// there publishes to Redis; this fires and pushes the new roster to the sockets
// this instance holds — so cross-instance updates are realtime, not polled.
// (Our own changes are broadcast inline in the handlers below; receiving our own
// published signal here just re-sends an unchanged roster, which clients ignore.)
presence.subscribe((roomId) => {
  void broadcast(roomId);
});

app.get(
  "/server/ws/*",
  upgradeWebSocket((c) => {
    const roomId = normalizeRoomId(
      new URL(c.req.url).pathname.split("/").pop(),
    );
    // The client assigns its own id and sends it in a `hello` message, so we can
    // report who is present (not just how many). Unset until that arrives.
    let id: string | undefined;
    return {
      onOpen(_event, ws) {
        // Register for broadcasts now; join presence once we learn the id.
        sockets.set(ws, { roomId });
      },
      async onMessage(event) {
        let data: unknown;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return; // Ignore non-JSON frames (e.g. keep-alive noise).
        }
        const msg = data as { type?: string; id?: string };
        // Keep-alive pings need no handling; the 5s interval heartbeats localIds.
        if (
          msg.type === "hello" &&
          typeof msg.id === "string" &&
          id === undefined
        ) {
          id = msg.id;
          trackLocal(roomId, id);
          await presence.join(roomId, id);
          // Broadcast now so this connection gets the current roster immediately;
          // join() also published, so other instances update too.
          await broadcast(roomId);
        }
      },
      async onClose(_event, ws) {
        sockets.delete(ws);
        if (id !== undefined) {
          if (untrackLocal(roomId, id)) await presence.leave(roomId, id);
          await broadcast(roomId);
        }
      },
    };
  }),
);

const server = createServer(async (request, response) => {
  const result = await app.fetch(
    new Request(`http://${request.headers.host}${request.url}`, {
      method: request.method,
      headers: request.headers as HeadersInit,
    }),
  );

  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(await result.text());
});

injectWebSocket(server);

function startHeartbeatTimer(): void {
  // Realtime updates flow through pub/sub (see presence.subscribe above). This
  // timer is just upkeep: refresh our connections' heartbeats so they don't go
  // stale, and re-broadcast to reflect anyone who *did* go stale (an unclean
  // disconnect or a recycled instance never publishes a leave).
  setInterval(() => {
    void (async () => {
      for (const [roomId, ids] of localIds) {
        await presence.heartbeat(roomId, [...ids.keys()]);
        await broadcast(roomId);
      }
    })();
  }, 5_000);
}

let heartbeatTimerStarted = false;

function ensureHeartbeatTimer(): void {
  if (!heartbeatTimerStarted) {
    startHeartbeatTimer();
    heartbeatTimerStarted = true;
  }
}

export function listen(port = Number(process.env.PORT ?? 3000)) {
  server.listen(port);
  return server;
}

export { server };
