import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function environment(saved, dark = false) {
    const values = new Map(saved === null ? [] : [['theme', saved]]);
    const classes = new Set();
    const root = {
        dataset: {}, style: {},
        setAttribute(key, value) { if (key === 'data-theme') this.dataset.theme = value; },
        classList: { toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } },
    };
    const meta = { content: '', setAttribute(key, value) { this[key] = value; } };
    const listeners = new Set();
    const media = {
        matches: dark,
        addEventListener(_, fn) { listeners.add(fn); },
        removeEventListener(_, fn) { listeners.delete(fn); },
    };
    const context = {
        exports: {},
        localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        document: { documentElement: root, querySelector: () => meta },
        window: { matchMedia: () => media },
    };
    runInNewContext(js, context);
    return { context, root, meta, media, listeners, values, classes };
}

function expectTheme(env, dark) {
    assert.equal(env.root.dataset.theme, dark ? 'dark' : 'light');
    assert.equal(env.root.style.colorScheme, dark ? 'dark' : 'light');
    assert.equal(env.root.style.backgroundColor, dark ? '#020617' : '#ffffff');
    assert.equal(env.meta.content, dark ? '#020617' : '#ffffff');
    assert.equal(env.classes.has('theme-midnight'), dark);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const saved of [null, 'dark', 'midnight', 'light', 'system', 'invalid']) {
    for (const dark of [false, true]) {
        test(`prepaint/runtime agree: ${saved}, OS dark=${dark}`, () => {
            const env = environment(saved, dark);
            runInNewContext(script, env.context);
            const expected = saved === 'system' ? dark : saved !== 'light';
            expectTheme(env, expected);
            const { readTheme, applyTheme } = env.context.exports;
            const preference = readTheme();
            assert.equal(preference, saved === 'light' || saved === 'system' ? saved : 'midnight');
            applyTheme(preference, dark);
            expectTheme(env, expected);
        });
    }
}

test('system tracks OS live, can be reselected, and fixed choices ignore OS', () => {
    const env = environment(null);
    const { trackTheme } = env.context.exports;
    const changeOS = dark => { env.media.matches = dark; env.listeners.forEach(fn => fn()); };
    let stop = trackTheme('system', () => {});
    expectTheme(env, false);
    changeOS(true); expectTheme(env, true);
    stop();
    stop = trackTheme('light', () => {});
    changeOS(false); changeOS(true); expectTheme(env, false);
    stop();
    stop = trackTheme('midnight', () => {});
    changeOS(false); expectTheme(env, true);
    stop();
    stop = trackTheme('system', () => {});
    expectTheme(env, false);
    assert.equal(env.values.get('theme'), 'system');
    stop(); assert.equal(env.listeners.size, 0);
});

for (const folder of ['public', ...(process.env.CHECK_DIST ? ['dist'] : [])]) {
    test(`${folder} CSP allows exact LF prepaint bytes`, () => {
        const served = folder === 'dist' ? readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8') : html;
        const inline = served.match(/<script>([\s\S]*?)<\/script>/)[1];
        assert.ok(!inline.includes('\r'), 'CSP-sensitive script must have LF line endings');
        const hash = createHash('sha256').update(inline).digest('base64');
        const config = JSON.parse(readFileSync(new URL(`../${folder}/staticwebapp.config.json`, import.meta.url), 'utf8'));
        assert.ok(config.globalHeaders['Content-Security-Policy'].includes(`'sha256-${hash}'`), hash);
    });
}
