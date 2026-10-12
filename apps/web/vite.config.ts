import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    // Arena exposes the dev server through a per-session preview hostname.
    // The app still uses relative API URLs through Vite's local proxy.
    allowedHosts: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.FOCUSAI_API_PROXY ?? "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
