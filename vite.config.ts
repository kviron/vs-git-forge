import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, 'src');

export default defineConfig({
  plugins: [solid()],
  esbuild: { jsxImportSource: 'solid-js' },
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'media'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/app/webview-main.tsx'),
      formats: ['iife'],
      name: 'GitForgeWebview',
      fileName: () => 'webview.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'webview.[ext]',
      },
    },
    target: 'esnext',
    minify: true,
    sourcemap: false,
  },
});
