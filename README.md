# hono-websockets-presence

Room-based presence over WebSockets. Open `/rooms/lobby`,
`/rooms/design-review`, or any URL-safe room and each tab sees the live count,
avatars, and join/leave activity for that room only.

The project is a single Vercel deployment with two Services:

- `web`: Vite + React frontend from `frontend/`, mounted at `/`.
- `server`: captured Node/Hono WebSocket server from `src/server.ts`, routed under `/server/*`.

## Architecture

- `src/index.ts` creates the Hono app and Node HTTP server, upgrades
  `/server/ws/:roomId` to a WebSocket, tracks sockets held by the current
  process, and broadcasts roster updates.
- `src/server.ts` is the Vercel Node server entrypoint. It exports the Node
  server for Vercel and calls `server.listen()` only during local development.
- `src/presence.ts` defines the presence store. With `REDIS_URL`, it uses Redis
  sorted sets plus pub/sub. Without `REDIS_URL`, it uses an in-memory store for
  local single-process development.
- `frontend/src/Presence.tsx` creates a per-tab client id in `sessionStorage`,
  connects to `/server/ws/:roomId`, renders the roster, and diffs roster changes
  into join/leave events.
- `frontend/vite.config.ts` proxies `/server` to `localhost:3000` during Vite
  development so the browser can use the same WebSocket URL locally and in
  production.
- `vercel.json` declares the Services routing contract. Keep `/server/ws/:roomId` in sync
  with both Hono routes and the frontend WebSocket URL.

## Presence Model

Each Redis room uses:

- Sorted set: `presence:online:<roomId>`
- Pub/sub channel: `presence:changed:<roomId>`
- Member: browser tab client id
- Score: last-seen epoch milliseconds

Lifecycle:

1. The browser opens `/server/ws/:roomId`.
2. The browser sends `{ "type": "hello", "id": "<session id>" }`.
3. The server adds the id to the room and publishes a change.
4. Each instance re-reads the room roster and broadcasts it to its local sockets.
5. A 5 second upkeep timer refreshes local heartbeats and prunes ids older than
   30 seconds.

## Run Locally

Install root dependencies and start the WebSocket server:

```sh
pnpm install
pnpm dev
```

In another terminal, install frontend dependencies and start Vite:

```sh
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:5173/rooms/lobby` in multiple tabs. Open another path,
such as `http://localhost:5173/rooms/design-review`, to verify rooms are
isolated.

Redis is optional locally. Copy `.env.example` to `.env` only when you need
shared presence across multiple server instances.

## Deploy

Deploy as one Vercel project. Provision Redis and set `REDIS_URL` in the Vercel
environment. Do not commit real environment files.

The backend relies on WebSockets and is intended for Vercel Fluid compute.

## Sensitive Data

Tracked files must contain placeholders only. Real secrets belong in local
`.env*` files or the Vercel project environment.

Ignored local state includes:

- `.env*`, except `.env.example`
- `.vercel/`
- `.claude/`, `.agents/`, `.codex/`
- `node_modules/`, `dist/`, `build/`, `coverage/`
- private key and certificate files such as `*.pem`, `*.key`, and `*.p12`
