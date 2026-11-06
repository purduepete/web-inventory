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

test('active header controls use paired theme colors until their state clears', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const active = styles.match(
        /\.theme-toggle\[aria-busy='true'\],\s*\.theme-toggle\[aria-expanded='true'\]\s*\{([^}]*)\}/
    )?.[1];
    assert.ok(active);
    assert.match(active, /background:\s*var\(--accent\);/);
    assert.match(active, /color:\s*var\(--on-accent\);/);
    assert.match(active, /opacity:\s*1;/);
    assert.match(styles, /button:disabled:not\(\.reload-btn\[aria-busy='true'\]\)/);
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /setTimeout\(\(\) => setReloading\(false\)/);
    assert.match(app, /onReady={finishReload}/);
});

test('page readiness clears refresh on success or error and preserves initial shell readiness', () => {
    const source = readFileSync(new URL('../src/FirstLoad.tsx', import.meta.url), 'utf8');
    const js = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const calls = [];
    let current = (failed) => calls.push(['shell', failed]);
    const context = {
        exports: {},
        require: (name) => {
            if (name === 'react') {
                return {
                    createContext: () => ({ Provider: 'provider' }),
                    useContext: () => current,
                    useCallback: (callback) => callback,
                    useLayoutEffect: (effect) => effect(),
                };
            }
            if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
            if (name === './Spinner') return {};
            throw new Error(`Unexpected import: ${name}`);
        },
    };
    runInNewContext(js, context);
    const boundary = context.exports.PageLoad({ children: 'page', onReady: () => calls.push(['refresh']) });
    current = boundary.props.value;
    context.exports.useFirstLoad(false);
    assert.deepEqual(calls, []);
    context.exports.useFirstLoad(true, false, false);
    assert.deepEqual(calls, [['shell', false]]);
    calls.length = 0;
    context.exports.useFirstLoad(true, false, true);
    assert.deepEqual(calls, [['shell', false], ['refresh']]);
    calls.length = 0;
    context.exports.useFirstLoad(true);
    assert.deepEqual(calls, [['shell', false], ['refresh']]);
    calls.length = 0;
    context.exports.useFirstLoad(false, true);
    assert.deepEqual(calls, [['shell', true], ['refresh']]);
});

test('cached home data does not finish refresh before its requests settle', () => {
    const home = readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
    const cacheStart = home.indexOf('void Promise.all([');
    const requestStart = home.indexOf('Promise.allSettled([', cacheStart);
    const requestEnd = home.indexOf('return () =>', requestStart);
    assert.ok(cacheStart >= 0 && requestStart > cacheStart && requestEnd > requestStart);
    assert.match(home, /useFirstLoad\(ready && filtersReady, Boolean\(error\), loadSettled && filtersReady\)/);
    assert.doesNotMatch(home.slice(cacheStart, requestStart), /setLoadSettled\(true\)/);
    assert.match(home.slice(requestStart, requestEnd), /setLoadSettled\(true\)/);
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
    const link = {
        href: '/apple-touch-icon.png?v=2',
        setAttribute(key, value) {
            this[key] = value;
        },
    };
    const context = {
        exports: {},
        localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        document: {
            documentElement: root,
            querySelector: (selector) => (selector === 'link[rel="apple-touch-icon"]' ? link : meta),
        },
        window: { matchMedia: () => media },
    };
    runInNewContext(js, context);
    return { context, root, meta, link, media, listeners, values, classes };
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
test('applies the theme before requesting the font stylesheet', () => {
    const theme = html.indexOf('<script>');
    const font = html.indexOf('https://fonts.googleapis.com/css2');
    assert.ok(theme >= 0 && font > theme);
});
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

test('the site icon follows the active theme and the favicon stays dark', () => {
    const env = environment(null);
    const { applyTheme, SITE_ICONS } = env.context.exports;
    applyTheme('light', true);
    assert.equal(env.link.href, '/apple-touch-icon-light.png?v=2');
    applyTheme('midnight', false);
    assert.equal(env.link.href, '/apple-touch-icon.png?v=2');
    applyTheme('system', false);
    assert.equal(env.link.href, SITE_ICONS.light);
    applyTheme('system', true);
    assert.equal(env.link.href, SITE_ICONS.dark);
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg\?v=2" \/>/);
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=2" \/>/);
    const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
    assert.match(favicon, /<rect x="2" y="2" width="60" height="60" rx="10" fill="#020617"\/>/);
    assert.match(readFileSync(new URL('../public/apple-touch-icon.svg', import.meta.url), 'utf8'), /fill="#020617"/);
    assert.match(
        readFileSync(new URL('../public/apple-touch-icon-light.svg', import.meta.url), 'utf8'),
        /fill="#fff7ed"/
    );
    for (const [name, size] of [
        ['apple-touch-icon.png', 180],
        ['apple-touch-icon-light.png', 180],
        ['pwa-192.png', 192],
        ['pwa-512.png', 512],
    ]) {
        const png = readFileSync(new URL(`../public/${name}`, import.meta.url));
        assert.equal(png.readUInt32BE(16), size, name);
        assert.equal(png.readUInt32BE(20), size, name);
    }
    const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    assert.match(vite, /includeAssets: \['favicon\.svg', 'apple-touch-icon\.png', 'apple-touch-icon-light\.png'\]/);
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.match(app, /<span className="brand-mark">\s*<BrandMark \/>/);
    const mark = readFileSync(new URL('../src/BrandMark.tsx', import.meta.url), 'utf8');
    for (const d of [
        'M32 11 51 20.5 32 30 13 20.5Z',
        'M13 20.5v21L32 51l19-9.5v-21M32 30v21',
        'M36 35.5 46.5 30.3v6.4L36 42Z',
    ]) {
        assert.ok(favicon.includes(`d="${d}"`) && mark.includes(`d="${d}"`), d);
    }
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /--brand-amber: #fbbf24;[\s\S]*--brand-sky: #38bdf8;/);
    assert.match(styles, /:root\[data-theme='light'\] \{[\s\S]*?--brand-amber: #d97706;[\s\S]*?--brand-sky: #0284c7;/);
});
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
