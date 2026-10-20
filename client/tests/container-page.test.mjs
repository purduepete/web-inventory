import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Add item modal leaves Escape to an open dropdown', () => {
    const page = readFileSync(new URL('../src/pages/ContainerPage.tsx', import.meta.url), 'utf8');
    const select = readFileSync(new URL('../src/Select.tsx', import.meta.url), 'utf8');
    assert.match(select, /case 'Escape':\s*e\.preventDefault\(\);\s*setOpen\(false\);/);
    assert.match(page, /e\.key === 'Escape' && !e\.defaultPrevented\) onClose\(false\)/);
    assert.doesNotMatch(page, /e\.key === 'Escape'\) onClose\(false\)/);
});

test('container header grid can shrink so long titles ellipsize on phones', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const grid = css.match(/\.head-grid \{[^}]*\}/)[0];
    assert.match(grid, /grid-template-columns: minmax\(0, 1fr\);/);
});
