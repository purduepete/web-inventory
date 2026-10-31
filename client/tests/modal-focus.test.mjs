import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAppleTouchDevice } from '../src/device.ts';

const devices = [
    {
        label: 'Windows desktop',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        maxTouchPoints: 0,
        ios: false,
    },
    {
        label: 'Mac desktop',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        ios: false,
    },
    {
        label: 'iPhone',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
        ios: true,
    },
    {
        label: 'iPad desktop identity',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
        ios: true,
    },
];

for (const { label, ios, ...device } of devices) {
    test(`isAppleTouchDevice is ${ios} on ${label}`, () => {
        assert.equal(isAppleTouchDevice(device), ios);
    });
}

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('prompt dialog focuses Close on iPhone and iPad and the input on desktop', () => {
    const dialog = source('Dialog.tsx');
    assert.match(dialog, /\(isAppleTouchDevice\(\) \? closeRef : inputRef\)\.current\?\.focus\(\)/);
    assert.match(dialog, /ref=\{closeRef\}\s*className="ghost small icon-btn"\s*aria-label="Close"/);
    assert.doesNotMatch(dialog, /autoFocus/);
});

test('Add item modal focuses Close on iPhone and iPad and the name field on desktop', () => {
    const page = source('pages/ContainerPage.tsx');
    assert.match(page, /\(isAppleTouchDevice\(\) \? closeRef : nameRef\)\.current\?\.focus\(\)/);
    const modal = page.slice(page.indexOf('aria-label="Add item"'));
    assert.match(modal, /ref=\{closeRef\}\s*className="ghost small icon-btn"\s*aria-label="Close"/);
    // Tapping the field must still edit it: nothing makes it read-only or unfocusable.
    const name = modal.slice(
        modal.indexOf('id="add-item-name"'),
        modal.indexOf('/>', modal.indexOf('id="add-item-name"'))
    );
    assert.doesNotMatch(name, /readOnly|tabIndex|autoFocus/);
});
