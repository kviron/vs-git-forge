import path from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  esbuild: { jsxImportSource: 'solid-js' },
  build: {
    outDir: '../media',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/main.tsx'),
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
