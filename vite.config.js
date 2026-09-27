import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173 },
  build: { target: 'esnext', outDir: 'dist', sourcemap: false },
});
