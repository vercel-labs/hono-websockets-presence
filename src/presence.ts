import { Redis } from 'ioredis'

// How long a connection's heartbeat is considered "live". Connections that stop
// refreshing their score (closed tabs, function max-duration cutoffs) fall out
// of the count once they go stale, even if we never saw a clean disconnect.
const STALE_MS = 30_000
const KEY_PREFIX = 'presence:online:'
// Pub/sub channel instances use to tell each other "presence changed, re-read".
const CHANNEL_PREFIX = 'presence:changed:'
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}*`

/**
 * Presence is stored as a Redis sorted set: member = connection id,
 * score = last-seen epoch millis. WebSocket connections on Vercel are not
 * pinned across reconnects/deploys, so every instance shares state through this
 * set. On any change an instance publishes to a channel; every instance
 * subscribes and re-broadcasts, so updates are realtime across instances.
 */
export interface PresenceStore {
  join(roomId: string, id: string): Promise<void>
  leave(roomId: string, id: string): Promise<void>
  /** Refresh last-seen for the connections this instance currently holds. */
  heartbeat(roomId: string, ids: string[]): Promise<void>
  /** Prune stale entries and return the ids of the live connections. */
  members(roomId: string): Promise<string[]>
  /** Run `onChange` with the room id whenever presence changes on any instance. */
  subscribe(onChange: (roomId: string) => void): void
}

function now(): number {
  return Date.now()
}

function key(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`
}

function channel(roomId: string): string {
  return `${CHANNEL_PREFIX}${roomId}`
}

class RedisPresenceStore implements PresenceStore {
  // One connection for commands/publish, plus a second one dedicated to the
  // subscription — a Redis connection in subscriber mode can't run any other
  // commands. ioredis reconnects and re-subscribes automatically, so the
  // realtime stream self-heals across network blips and instance restarts.
  constructor(
    private redis: Redis,
    private sub: Redis,
  ) {}

  async join(roomId: string, id: string): Promise<void> {
    await this.redis.zadd(key(roomId), now(), id)
    await this.redis.publish(channel(roomId), id)
  }

  async leave(roomId: string, id: string): Promise<void> {
    await this.redis.zrem(key(roomId), id)
    await this.redis.publish(channel(roomId), id)
  }

  async heartbeat(roomId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const ts = now()
    const args = ids.flatMap((id) => [ts, id])
    await this.redis.zadd(key(roomId), ...args)
  }

  async members(roomId: string): Promise<string[]> {
    await this.redis.zremrangebyscore(key(roomId), 0, now() - STALE_MS)
    return await this.redis.zrange(key(roomId), 0, -1)
  }

  subscribe(onChange: (roomId: string) => void): void {
    void this.sub.psubscribe(CHANNEL_PATTERN)
    this.sub.on('pmessage', (_pattern, matchedChannel) => {
      const roomId = matchedChannel.slice(CHANNEL_PREFIX.length)
      if (roomId) onChange(roomId)
    })
  }
}

/** In-memory fallback so local dev works without Redis. */
class MemoryPresenceStore implements PresenceStore {
  private rooms = new Map<string, Map<string, number>>()
  private listeners = new Set<(roomId: string) => void>()

  async join(roomId: string, id: string): Promise<void> {
    this.room(roomId).set(id, now())
    this.notify(roomId)
  }

  async leave(roomId: string, id: string): Promise<void> {
    this.room(roomId).delete(id)
    this.notify(roomId)
  }

  async heartbeat(roomId: string, ids: string[]): Promise<void> {
    const ts = now()
    const room = this.room(roomId)
    for (const id of ids) room.set(id, ts)
  }

  private prune(roomId: string): void {
    const cutoff = now() - STALE_MS
    const room = this.room(roomId)
    for (const [id, ts] of room) {
      if (ts < cutoff) room.delete(id)
    }
  }

  async members(roomId: string): Promise<string[]> {
    this.prune(roomId)
    return [...this.room(roomId).keys()]
  }

  subscribe(onChange: (roomId: string) => void): void {
    // Single process, so "across instances" is just this one — notify directly.
    this.listeners.add(onChange)
  }

  private room(roomId: string): Map<string, number> {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Map()
      this.rooms.set(roomId, room)
    }
    return room
  }

  private notify(roomId: string): void {
    for (const listener of this.listeners) listener(roomId)
  }
}

function createStore(): PresenceStore {
  const url = process.env.REDIS_URL
  if (url) {
    return new RedisPresenceStore(new Redis(url), new Redis(url))
  }
  console.warn(
    '[presence] REDIS_URL not set — using in-memory store. ' +
      'Live presence will not be shared across function instances.',
  )
  return new MemoryPresenceStore()
}

export const presence: PresenceStore = createStore()
