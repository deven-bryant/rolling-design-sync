import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const api = process.env.RDS_PORTAL_API ?? 'http://localhost:8787';

export default defineConfig({
  base: '/ui/',
  plugins: [react(), tailwindcss()],
  define: {
    __PORTAL_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      '/v3': { target: api, changeOrigin: false },
      '/health': { target: api, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
