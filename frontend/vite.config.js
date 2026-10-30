import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// В режиме разработки запросы /api проксируются на Django (python backend/manage.py runserver 8000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.VITE_API_TARGET || "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", assetsDir: "assets" },
});
