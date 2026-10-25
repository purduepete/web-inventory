import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('header exposes refresh information and one accessible theme popover', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let header;
    function find(node) {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'header') header = node;
        ts.forEachChild(node, find);
    }
    find(ast);
    assert.ok(header, 'app header exists');
    const headerText = header.getText(ast);
    assert.doesNotMatch(headerText, /<(?:select|datalist)\b/);
    assert.match(headerText, /aria-label="Refresh and sync information"/);
    assert.match(headerText, /aria-describedby="refresh-sync-description"/);
    assert.match(headerText, /id="refresh-sync-popover"/);
    assert.match(headerText, /aria-expanded={headerPanel === 'info'}/);
    assert.match(headerText, /aria-busy={reloading}/);
    assert.match(headerText, /aria-controls="theme-popover"/);
    assert.match(headerText, /aria-label={`Theme: \$\{THEME_LABELS\[theme\]\}`}/);
    for (const preference of ['system', 'light', 'midnight']) {
        assert.match(headerText, new RegExp(`setTheme\\('${preference}'\\)`));
        assert.match(headerText, new RegExp(`aria-pressed={theme === '${preference}'}`));
    }
    assert.ok(
        headerText.indexOf("setTheme('light')") < headerText.indexOf("setTheme('midnight')") &&
            headerText.indexOf("setTheme('midnight')") < headerText.indexOf("setTheme('system')"),
        'theme options are ordered Light, Midnight, System'
    );
    assert.match(headerText, /'--theme-index': \['light', 'midnight', 'system'\]\.indexOf\(theme\)/);
    assert.equal((headerText.match(/aria-haspopup="dialog"/g) || []).length, 2);
    assert.doesNotMatch(headerText, /\btitle=/);
    assert.ok(
        headerText.indexOf('aria-label="Refresh and sync information"') <
            headerText.indexOf('aria-label="Reload data"') &&
            headerText.indexOf('aria-label="Reload data"') < headerText.indexOf('aria-label={`Theme:'),
        'refresh action sits between the information and theme controls'
    );
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const themeToggleStyles = styles.match(/\.theme-toggle\s*\{([^}]*)\}/)?.[1];
    assert.ok(themeToggleStyles, 'header icon controls have a shared style');
    assert.match(themeToggleStyles, /border:\s*0;/, 'header icon controls have no border');
    const narrowPopoverStyles = styles.match(/@media \(max-width: 639px\)\s*\{([\s\S]*?)\n\}/)?.[1];
    assert.match(narrowPopoverStyles, /\.header-popover\s*\{[\s\S]*?position:\s*fixed;/);
    assert.match(narrowPopoverStyles, /right:\s*max\(16px,\s*env\(safe-area-inset-right\)\);/);
    assert.match(narrowPopoverStyles, /width:\s*min\(/);
});

const source = readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function environment(saved, dark = false) {
    const values = new Map(saved === null ? [] : [['theme', saved]]);
    const classes = new Set();
    const root = {
        dataset: {},
        style: {},
        setAttribute(key, value) {
            if (key === 'data-theme') this.dataset.theme = value;
        },
        classList: {
            toggle(key, enabled) {
                if (enabled) classes.add(key);
                else classes.delete(key);
            },
        },
    };
    const meta = {
        content: '',
        setAttribute(key, value) {
            this[key] = value;
        },
    };
    const listeners = new Set();
    const media = {
        matches: dark,
        addEventListener(_, fn) {
            listeners.add(fn);
        },
        removeEventListener(_, fn) {
            listeners.delete(fn);
        },
    };
    const context = {
        exports: {},
        localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
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
    const changeOS = (dark) => {
        env.media.matches = dark;
        env.listeners.forEach((fn) => fn());
    };
    let stop = trackTheme('system', () => {});
    expectTheme(env, false);
    changeOS(true);
    expectTheme(env, true);
    stop();
    stop = trackTheme('light', () => {});
    changeOS(false);
    changeOS(true);
    expectTheme(env, false);
    stop();
    stop = trackTheme('midnight', () => {});
    changeOS(false);
    expectTheme(env, true);
    env.values.set('theme', 'system'); // another tab picked System
    changeOS(true);
    assert.equal(env.values.get('theme'), 'system', 'OS change must not overwrite the saved choice');
    changeOS(false);
    stop();
    stop = trackTheme('system', () => {});
    expectTheme(env, false);
    assert.equal(env.values.get('theme'), 'system');
    stop();
    assert.equal(env.listeners.size, 0);
});

for (const folder of ['public', ...(process.env.CHECK_DIST ? ['dist'] : [])]) {
    test(`${folder} CSP allows exact LF prepaint bytes`, () => {
        const served = folder === 'dist' ? readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8') : html;
        const inline = served.match(/<script>([\s\S]*?)<\/script>/)[1];
        assert.ok(!inline.includes('\r'), 'CSP-sensitive script must have LF line endings');
        const hash = createHash('sha256').update(inline).digest('base64');
        const config = JSON.parse(
            readFileSync(new URL(`../${folder}/staticwebapp.config.json`, import.meta.url), 'utf8')
        );
        assert.ok(config.globalHeaders['Content-Security-Policy'].includes(`'sha256-${hash}'`), hash);
    });
}
