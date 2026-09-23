import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,  // ← تعطيل التصغير — لأن الملفات لا تحتاجها
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
