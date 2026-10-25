import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { loadConfigFromFile, preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const reviewApi = 'https://jimbrownhome1.tail8ad282.ts.net:8795';

test('read-only review serves local UI and proxies reads, but never forwards writes', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'web-inventory-preview-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Local review build</title>');
    const requests = [];
    const upstream = createServer((request, response) => {
        requests.push({ method: request.method, url: request.url, origin: request.headers.origin });
        if (request.url === '/api/auth/check') {
            response.writeHead(204).end();
        } else {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ localTest: true }));
        }
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    t.after(() => new Promise((resolve) => upstream.close(resolve)));
    const target = `http://127.0.0.1:${upstream.address().port}`;
    const check = t.mock.method(globalThis, 'fetch', async (url) => {
        assert.equal(url, `${reviewApi}/api/auth/check`);
        return new Response(null, { status: 204 });
    });
    const server = await preview({
        root,
        configFile,
        mode: 'review',
        logLevel: 'silent',
        build: { outDir: directory },
        preview: {
            port: 0,
            strictPort: false,
            proxy: { '/api': { target }, '/images': { target } },
        },
    });
    t.after(() => new Promise((resolve) => server.httpServer.close(resolve)));
    assert.equal(check.mock.callCount(), 1, 'startup checks private API access');
    check.mock.restore();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    assert.equal(server.config.preview.host, '127.0.0.1');
    assert.equal(server.config.preview.proxy['/api'].changeOrigin, true);
    assert.equal(server.config.preview.proxy['/api'].headers.Origin, reviewApi);

    assert.match(await (await fetch(base)).text(), /Local review build/);
    assert.equal((await fetch(`${base}/api/auth/check`)).status, 204);
    assert.deepEqual(await (await fetch(`${base}/api/containers`)).json(), { localTest: true });
    assert.equal((await fetch(`${base}/images/test.jpg`)).status, 200);
    assert.equal((await fetch(`${base}/api/containers`, { method: 'HEAD' })).status, 200);
    const reads = requests.length;
    assert.equal(reads, 4);
    assert.ok(requests.every((request) => request.origin === reviewApi));

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        for (const path of ['/api/containers', '/images/test.jpg', '/other']) {
            const response = await fetch(`${base}${path}`, { method });
            assert.equal(response.status, 405, `${method} ${path} is blocked`);
            assert.equal(response.headers.get('allow'), 'GET, HEAD');
            assert.match((await response.json()).error, /Read-only preview/);
        }
    }
    const crossOrigin = await fetch(`${base}/api/containers`, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(crossOrigin.status, 403);
    assert.equal(requests.length, reads, 'blocked requests never reach the upstream API');
    assert.equal(
        (await fetch(`${base}/api/containers`, { headers: { Origin: base } })).status,
        200,
        'same-origin browser reads work'
    );
});

test('review refuses to start when the private API is unavailable', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
    await assert.rejects(
        preview({ root, configFile, mode: 'review', logLevel: 'silent' }),
        /Read-only preview cannot reach .*Connect Tailscale/
    );
});

test('production builds and normal development do not enable the review proxy', async () => {
    for (const environment of [
        { command: 'build', mode: 'production', isPreview: false },
        { command: 'serve', mode: 'development', isPreview: false },
        { command: 'build', mode: 'review', isPreview: false },
    ]) {
        const result = await loadConfigFromFile(environment, configFile, root, 'silent');
        assert.ok(result);
        assert.equal(result.config.preview, undefined);
        assert.ok(!result.config.plugins.some((plugin) => plugin.name === 'read-only-review'));
        assert.equal(result.config.server.proxy['/api'].target, 'http://127.0.0.1:18795');
    }
});
