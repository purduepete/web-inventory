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
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
                name: 'Web Inventory',
                short_name: 'Inventory',
                description: 'Photograph, label and search the contents of your containers.',
                theme_color: '#1f2933',
                background_color: '#1f2933',
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
                // Never cache API calls; they must hit the network (queued offline via Dexie).
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
                target: 'http://localhost:7071',
                changeOrigin: true,
            },
        },
    },
});
