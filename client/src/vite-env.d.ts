/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected at build time by Vite `define` (see vite.config.ts) — the short git
// SHA of the deployed build, surfaced in the Help dialog so the running bundle
// is verifiable at a glance.
declare const __BUILD_SHA__: string;
