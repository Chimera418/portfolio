// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import react from '@astrojs/react';

import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  output: 'server',

  server: {
    port: 4321,
  },

  base: process.env.NODE_ENV === 'production' ? '/' : '/',

  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover'
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '$lib': '/src/components/plinko'
      }
    }
  },

  adapter: vercel(),
  integrations: [react(), svelte()]
});