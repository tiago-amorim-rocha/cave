import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs/promises';
import path from 'node:path';

export default defineConfig(({ command }) => {
  // TEMP: force carving step-debug enabled everywhere.
  // (Previously: enabled by default only for `vite` dev server, and gated in prod via `CARVE_DEBUG=1`.)
  const carveDebug = true;

  return {
    define: {
      __CARVE_DEBUG__: JSON.stringify(carveDebug),
    },
  base: '/cave/',
  publicDir: 'public',
  server: {
    hmr: {
      overlay: false // Disable blocking error overlay
    }
  },
  plugins: [
    {
      name: 'debug-dump-logs',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'POST' || req.url !== '/__debug/dump-logs') {
            next();
            return;
          }

          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 2_000_000) {
              res.statusCode = 413;
              res.end('Payload too large');
              req.destroy();
            }
          });

          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const now = new Date();
              const safeStamp = now.toISOString().replace(/[:.]/g, '-');
              const filename = `debug-console-${safeStamp}.json`;
              const outPath = path.resolve(process.cwd(), filename);
              await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, path: filename }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
            }
          });
        });
      }
    },
    VitePWA({
      // Workbox's internal Rollup+Terser bundling currently fails under this setup.
      // Using development mode skips Terser for the generated SW bundle (app build remains production-minified).
      mode: 'development',
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
  };
});
