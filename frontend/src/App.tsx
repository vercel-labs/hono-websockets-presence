import Presence from "./Presence";

export default function App() {
  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <h1>Real-time room presence with Hono & React</h1>
      <p style={{ color: "#4b5563", marginTop: -8, marginBottom: 24 }}>
        See who is viewing the same room, with live avatars and join/leave updates.
      </p>
      <nav style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <a href="/rooms/lobby">Lobby</a>
        <a href="/rooms/design-review">Design review</a>
        <a href="/rooms/launch-plan">Launch plan</a>
      </nav>
      <Presence />
    </main>
  );
}
