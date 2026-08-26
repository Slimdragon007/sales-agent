import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRealtimeApiPlugin } from "./server/realtime-api";

export default defineConfig(({ mode }) => ({
  plugins: [react(), createRealtimeApiPlugin(mode)],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
}));
