import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// Builds source.html and src/ into dist/source.html, one self-contained file; `npm run build` copies it to index.html.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'esnext', assetsInlineLimit: 100_000_000, rollupOptions: { input: 'source.html' } },
});
