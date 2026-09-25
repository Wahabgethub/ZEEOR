import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '0.0.0.0', allowedHosts: ['5173-irlr15fbn4ns9qjjcs8yn-dcaed21b.us1.manus.computer'], proxy: { '/api': 'http://localhost:4000' } },
  build: { outDir: 'dist', sourcemap: true }
});
