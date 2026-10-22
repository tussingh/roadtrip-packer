/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH lets the same build work at a domain root or a GitHub Pages
// project path such as /roadtrip-packer/.
const base = process.env.BASE_PATH ?? './';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'map-assets/**/*'],
      manifest: {
        name: 'Milestone — Family Road Trip Packer',
        short_name: 'Milestone',
        description: 'Offline packing checklists and maps for family road trips. No account, no AI, no tracking.',
        lang: 'en-IN',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F6F3',
        theme_color: '#0E5E46',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell + map glyphs/sprites so it opens in airplane mode.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,pbf,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Offline region archives live in IndexedDB. Online OpenFreeMap tiles for
        // a saved trip route are kept in the 'ofm-tiles' cache (see offlineTiles.ts).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && (url.pathname.startsWith('/styles/') || /^\/planet\/?$/.test(url.pathname)),
            handler: 'NetworkFirst',
            options: { cacheName: 'ofm-meta', networkTimeoutSeconds: 4, expiration: { maxEntries: 20 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: { cacheName: 'ofm-tiles', expiration: { maxEntries: 12000, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('pmtiles') || id.includes('@protomaps')) return 'maps-data';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
