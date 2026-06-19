import { listen, server } from "./index.js";

if (!process.env.VERCEL || process.env.VERCEL_DEV_PORT) {
  listen();
}

export default server;
