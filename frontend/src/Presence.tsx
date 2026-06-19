import { useEffect, useRef, useState } from 'react'
import Avatar from 'boring-avatars'

type Status = 'connecting' | 'online' | 'offline'
type LogEvent = { id: string; kind: 'join' | 'leave'; at: number }

// A stable per-tab identity. Persisted in sessionStorage so a reload keeps the
// same id (no spurious leave/join); it resets only when the tab is closed.
function getClientId(): string {
  const KEY = 'presence:clientId'
  let id = sessionStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(KEY, id)
  }
  return id
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function getRoomId(): string {
  const [, prefix, room] = location.pathname.split('/')
  const candidate = prefix === 'rooms' ? room : undefined
  return candidate && /^[a-z0-9-]{1,64}$/.test(candidate) ? candidate : 'lobby'
}

export default function Presence({ roomId = getRoomId() }: { roomId?: string }) {
  const [members, setMembers] = useState<string[]>([])
  const [events, setEvents] = useState<LogEvent[]>([])
  const [status, setStatus] = useState<Status>('connecting')
  const selfIdRef = useRef<string>(getClientId())
  const selfId = selfIdRef.current

  useEffect(() => {
    let socket: WebSocket
    let reconnectDelay = 1000
    let pingTimer: ReturnType<typeof setInterval>
    let stopped = false
    // Ids we've already accounted for. The first roster of each connection seeds
    // this set silently, so we don't log a "joined" for everyone already present.
    let known = new Set<string>()
    let seeded = false

    function applyRoster(roster: string[]) {
      setMembers(roster)
      const next = new Set(roster)
      if (!seeded) {
        known = next
        seeded = true
        return
      }
      const now = Date.now()
      const fresh: LogEvent[] = []
      for (const id of next) {
        if (!known.has(id)) fresh.push({ id, kind: 'join', at: now })
      }
      for (const id of known) {
        if (!next.has(id)) fresh.push({ id, kind: 'leave', at: now })
      }
      known = next
      if (fresh.length > 0) {
        // Newest first, capped so the log doesn't grow unbounded.
        setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, 20))
      }
    }

    function connect() {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      // The backend is a Vercel service mounted under /server (see vercel.json).
      socket = new WebSocket(`${proto}://${location.host}/server/ws/${roomId}`)

      socket.addEventListener('open', () => {
        setStatus('online')
        reconnectDelay = 1000
        // Re-seed on each (re)connection; the server sends a full roster.
        seeded = false
        // Announce our identity so the server can report who is present.
        socket.send(JSON.stringify({ type: 'hello', id: selfId }))
        // Keep-alive so idle intermediaries don't drop the connection.
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 25000)
      })

      socket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'presence' && Array.isArray(data.members)) {
            applyRoster(data.members)
          }
        } catch {
          // Ignore non-JSON frames.
        }
      })

      socket.addEventListener('close', () => {
        setStatus('offline')
        clearInterval(pingTimer)
        if (!stopped) {
          setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 30000)
        }
      })

      socket.addEventListener('error', () => socket.close())
    }

    connect()

    return () => {
      stopped = true
      clearInterval(pingTimer)
      socket?.close()
    }
  }, [roomId, selfId])

  const count = members.length

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 420 }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        Room: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{roomId}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background:
              status === 'online' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444',
          }}
        />
        <span>
          {count} {count === 1 ? 'person' : 'people'} here now
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {members.map((id) => (
          <div
            key={id}
            title={id === selfId ? 'You' : shortId(id)}
            style={{
              display: 'flex',
              borderRadius: '50%',
              boxShadow: id === selfId ? '0 0 0 2px #2563eb' : 'none',
            }}
          >
            <Avatar size={36} variant="beam" name={id} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>
          Activity
        </div>
        {events.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>No joins or leaves yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {events.map((e) => (
              <li
                key={`${e.id}-${e.kind}-${e.at}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
              >
                <Avatar size={20} variant="beam" name={e.id} />
                <span style={{ fontFamily: 'ui-monospace, monospace', color: '#374151' }}>
                  {e.id === selfId ? 'you' : shortId(e.id)}
                </span>
                <span style={{ color: e.kind === 'join' ? '#16a34a' : '#dc2626' }}>
                  {e.kind === 'join' ? 'joined' : 'left'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
