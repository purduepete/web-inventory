import { defineConfig } from 'vite';
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

// Development requests use the same ASP.NET API as production.
export default defineConfig({
    define: {
        __BUILD_SHA__: JSON.stringify(buildSha()),
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            // We register the service worker ourselves (src/pwa.ts) so we can add
            // periodic update checks; disable the auto-injected registration to
            // avoid registering twice.
            injectRegister: null,
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
                name: 'Web Inventory',
                short_name: 'Inventory',
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
});
