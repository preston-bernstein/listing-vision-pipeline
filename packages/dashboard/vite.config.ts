import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  test: {
    // `root: 'client'` above governs the Vite dev/build root only. Vitest has
    // no separate test-only root, so without this the default test include
    // glob (resolved relative to `root`) can never reach
    // `server/server.test.ts`, which lives one level up. Reaching out of
    // `root` via `../server` here is test-discovery-only and doesn't affect
    // the dev server or the production build in any way.
    include: ['src/**/*.{test,spec}.{ts,tsx}', '../server/**/*.{test,spec}.ts']
  }
});
