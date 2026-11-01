import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const apiPort = process.env.API_PORT || 8787;

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5181,
    strictPort: true,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  test: {
    include: ['test/**/*.test.js'],
  },
});
