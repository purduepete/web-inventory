import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Short git SHA of the build, surfaced in the UI so we can confirm which bundle a
// device is actually running (falls back to CI's GITHUB_SHA, then 'dev').
function buildSha(): string {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);
    }
}

const reviewApi = 'https://jimbrownhome1.tail8ad282.ts.net:8795';

export default defineConfig(({ isPreview, mode }) => ({
    define: {
        __BUILD_SHA__: JSON.stringify(buildSha()),
    },
    plugins: [
        ...(isPreview && mode === 'review'
            ? [
                  {
                      name: 'read-only-review',
                      async configurePreviewServer(server) {
                          try {
                              const response = await fetch(`${reviewApi}/api/auth/check`, {
                                  signal: AbortSignal.timeout(10000),
                              });
                              if (response.status !== 204) {
                                  throw new Error(`API access check returned HTTP ${response.status}.`);
                              }
                          } catch (cause) {
                              throw new Error(
                                  `Read-only preview cannot reach ${reviewApi}. Connect Tailscale and check the private API.`,
                                  { cause }
                              );
                          }
                          server.middlewares.use((request, response, next) => {
                              const origin = request.headers.origin;
                              if (origin && origin !== `http://${request.headers.host}`) {
                                  response.writeHead(403, { 'Content-Type': 'application/json' });
                                  response.end(
                                      JSON.stringify({ error: 'Preview requests must use the local origin.' })
                                  );
                                  return;
                              }
                              if (request.method !== 'GET' && request.method !== 'HEAD') {
                                  response.writeHead(405, {
                                      Allow: 'GET, HEAD',
                                      'Content-Type': 'application/json',
                                  });
                                  response.end(
                                      JSON.stringify({
                                          error: 'Read-only preview: live inventory changes are blocked.',
                                      })
                                  );
                                  return;
                              }
                              next();
                          });
                      },
                  } satisfies Plugin,
              ]
            : []),
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            // We register the service worker ourselves (src/pwa.ts) so we can add
            // periodic update checks; disable the auto-injected registration to
            // avoid registering twice.
            injectRegister: null,
            // Cloudflare Access needs the session cookie on the manifest request.
            useCredentials: true,
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
                name: 'Web Inventory',
                short_name: 'Web Inventory',
                description: 'Photograph, label and search the contents of your containers.',
                theme_color: '#020617',
                background_color: '#020617',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                icons: [
                    { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
            },
            workbox: {
                // A newly-deployed service worker should take over as soon as it
                // installs (skipWaiting) and control existing clients immediately
                // (clientsClaim), and old precaches should be dropped. Combined with
                // the controllerchange reload in src/pwa.ts, this stops installed
                // standalone PWAs (notably iOS) from lingering on a stale shell.
                skipWaiting: true,
                clientsClaim: true,
                cleanupOutdatedCaches: true,
                // Let the network/platform handle anything that isn't an app route:
                // - /api/* is queued offline via Dexie and uses platform access.
                // Without this, the service worker's navigation fallback would serve
                // the cached app shell for API requests.
                navigateFallbackDenylist: [/^\/api/],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.pathname.startsWith('/api'),
                        handler: 'NetworkOnly',
                    },
                ],
            },
            devOptions: { enabled: false },
        }),
    ],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:18795',
                changeOrigin: true,
            },
        },
    },
    preview:
        isPreview && mode === 'review'
            ? {
                  host: '127.0.0.1',
                  port: 4173,
                  strictPort: true,
                  allowedHosts: ['localhost', '127.0.0.1'],
                  proxy: Object.fromEntries(
                      ['/api', '/images'].map((path) => [
                          path,
                          {
                              target: reviewApi,
                              changeOrigin: true,
                              headers: { Origin: reviewApi },
                          },
                      ])
                  ),
              }
            : undefined,
}));
