import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// During local dev the SWA emulator / Functions host proxies /api.
// In production, Azure Static Web Apps routes /api to the linked Functions app.
export default defineConfig({
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
                theme_color: '#1a1b26',
                background_color: '#1a1b26',
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
                // Let the network/platform handle anything that isn't an app route:
                // - /api/*            → Functions backend (queued offline via Dexie)
                // - /.auth/*, /.swa/* → Static Web Apps auth + platform endpoints
                // - /login, /logout   → our rewrites to /.auth (see staticwebapp.config.json)
                // Without these, the service worker's navigation fallback serves the
                // cached app shell for the auth handshake, breaking login (intermittent 403s).
                navigateFallbackDenylist: [/^\/api/, /^\/\.auth/, /^\/\.swa/, /^\/login/, /^\/logout/],
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
                target: 'http://localhost:7071',
                changeOrigin: true,
            },
        },
    },
});
