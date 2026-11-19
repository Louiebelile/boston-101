import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: (file) => /\.woff2?$/.test(file) || undefined,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        dorchester: resolve(import.meta.dirname, 'dorchester/index.html'),
      },
    },
  },
})
