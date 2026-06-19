# Agent Guide

This repo is a minimal room-presence template for Hono WebSockets, React, Redis,
and Vercel Services.

## Project Shape

- Root package: Hono WebSocket server.
- `frontend/`: Vite React client.
- `vercel.json`: maps `frontend/` to `/` and `src/server.ts` to `/server/*`.
- `.env.example`: documents `REDIS_URL`; real `.env*` files are ignored.

## Runtime Contract

- Frontend connects to `/server/ws/:roomId`.
- Valid room ids are lowercase letters, numbers, and hyphens, up to 64 chars.
  Invalid or missing rooms fall back to `lobby`.
- Browser tab identity lives in `sessionStorage` under `presence:clientId`.
- Client messages:
  - `hello`: `{ "type": "hello", "id": "<client id>" }`
  - `ping`: keep-alive; server ignores it.
- Server messages:
  - `presence`: `{ "type": "presence", "roomId": "...", "count": 1, "members": ["..."] }`

## Presence Store

`src/presence.ts` owns the storage boundary.

- With `REDIS_URL`, presence is Redis-backed.
- Without `REDIS_URL`, presence is in memory and only correct within one server
  process.
- Redis sorted set key: `presence:online:<roomId>`.
- Redis pub/sub channel: `presence:changed:<roomId>`.
- Stale ids are pruned after 30 seconds.
- Local socket heartbeats refresh every 5 seconds from the server entrypoint.

## Change Rules

- Keep `/server/ws/:roomId` aligned across `vercel.json`, `src/index.ts`, and
  `frontend/src/Presence.tsx`.
- Put protocol changes in both server and client code in the same change.
- Keep room scoping in every Redis key, channel, and broadcast.
- Do not add user-auth or durable profile data without documenting the new data
  model and privacy expectations.
- Keep local development working without Redis.

## Sensitive Data Rules

- Never commit real `.env*` files, Vercel project state, local agent settings,
  private keys, certificates, logs, dependency folders, or build output.
- Keep `.env.example` placeholder-only.
- Do not paste live Redis URLs, Vercel tokens, API keys, or local tunnel URLs into
  docs, tests, comments, or examples.
- If a new tool creates local state, add that path to `.gitignore` before using
  it in normal development.

## Useful Commands

```sh
pnpm install
pnpm dev
```

```sh
cd frontend
pnpm install
pnpm dev
pnpm build
```
