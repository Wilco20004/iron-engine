import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the app also works under Home Assistant ingress.
  base: './',
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist' },
});
