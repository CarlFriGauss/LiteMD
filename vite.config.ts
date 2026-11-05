import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  cacheDir: 'D:/projects/TextEditor/.cache/vite',
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**', '**/.cache/**'],
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
