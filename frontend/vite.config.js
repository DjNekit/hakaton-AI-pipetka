import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// В режиме разработки /api проксируется на Django, /chat — на сервис чата (TanStack AI)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
      "/chat": process.env.VITE_CHAT_TARGET || "http://127.0.0.1:3000",
    },
  },
  build: { outDir: "dist", assetsDir: "assets" },
});
