import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

/** The Hub's Fastify server (apps/server). In production it serves this SPA itself. */
const HUB_ORIGIN = 'http://localhost:7400';

const proxy: Record<string, ProxyOptions> = {
  '/api': { target: HUB_ORIGIN },
  '/ws': { target: HUB_ORIGIN, ws: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    sourcemap: true,
    // Served from the Hub over the LAN and cached on the device, so one ~650 kB
    // (~210 kB gzip) entry chunk is fine. Revisit with lazy portal routes.
    chunkSizeWarningLimit: 800,
  },
});
