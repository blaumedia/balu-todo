import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The FastAPI server serves the production build (SPA fallback) and owns `/api`.
// In dev we proxy `/api` to it so the client uses relative paths everywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
