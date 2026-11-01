import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { resolveConfig } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

test('generated service worker leaves image and API navigations to the network', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'web-inventory-pwa-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Test</title>');

    const config = await resolveConfig(
        { root, configFile, build: { outDir: directory }, logLevel: 'silent' },
        'build',
        'production'
    );
    const plugin = config.plugins.find((entry) => entry.name === 'vite-plugin-pwa');
    assert.ok(plugin?.api);
    await plugin.api.generateSW();
    const script = await readFile(join(directory, 'sw.js'), 'utf8');

    let options;
    const workbox = {
        clientsClaim() {},
        precacheAndRoute() {},
        cleanupOutdatedCaches() {},
        createHandlerBoundToURL() {},
        NavigationRoute: class {
            constructor(_handler, routeOptions) {
                options = routeOptions;
            }
        },
        registerRoute() {},
        NetworkOnly: class {},
    };
    runInNewContext(
        script,
        {
            self: { define() {}, skipWaiting() {} },
            define(_dependencies, initialize) {
                initialize(workbox);
            },
        },
        { timeout: 1000 }
    );
    assert.ok(options?.denylist, 'generated worker registers a navigation fallback');

    const usesFallback = (path) => {
        const url = new URL(path, 'https://inventory.example');
        return !options.denylist.some((pattern) => pattern.test(url.pathname + url.search));
    };
    for (const path of [
        '/images/container/photo.jpg',
        '/images/container/photo.jpg?v=1',
        '/images',
        '/images?size=full',
        '/api',
        '/api/containers',
    ]) {
        assert.equal(usesFallback(path), false, `${path} must reach the network`);
    }
    for (const path of ['/', '/containers/123', '/containers/123?sort=name', '/images-archive']) {
        assert.equal(usesFallback(path), true, `${path} must keep the app fallback`);
    }
});
