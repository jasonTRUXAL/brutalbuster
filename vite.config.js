import { defineConfig } from 'vite';

// `base: './'` makes the build work from any sub-path (GitHub Pages, a folder on
// shared hosting, etc.) as well as from a domain root.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
