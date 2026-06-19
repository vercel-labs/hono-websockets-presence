import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy the WebSocket endpoint to the Hono server in dev so the client can use
// a same-origin relative URL (/server/ws) that also works in production, where
// the backend is a Vercel service mounted under /server (see vercel.json).
// (For `vercel dev -L`, the Services router handles this instead.)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/server": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
