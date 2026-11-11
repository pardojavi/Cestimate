import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: './'` permite publicar en GitHub Pages bajo /cestimate/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // En desarrollo la API corre en otro puerto; en producción la URL
      // viene del build (apps/web/.env.production → VITE_API_URL).
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
