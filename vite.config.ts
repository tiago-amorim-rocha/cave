import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/cave/',
  publicDir: 'public',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-512.svg'],
      devOptions: {
        enabled: false // Disable in dev to avoid confusion
      },
      manifest: {
        name: 'Carvable Caves',
        short_name: 'Caves',
        description: 'Carve smooth 2D caves using marching squares',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/cave/',
        scope: '/cave/',
        icons: [
          {
            src: 'icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Don't cache version.json - always fetch fresh
        globIgnores: ['**/version.json'],
        navigateFallback: null,
        runtimeCaching: [
          {
            // Always network-first for version.json
            urlPattern: /version\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'version-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 0 // Don't cache
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2020',
    outDir: 'dist'
  }
});
