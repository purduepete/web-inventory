import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/tooltipController.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { attachTooltip } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

class Element extends EventTarget {
    attributes = new Map();
    dataset = {};
    style = {};
    isConnected = true;
    hidden = true;
    textContent = '';
    parent = null;
    rect = { left: 370, top: 740, bottom: 770, width: 20, height: 30 };
    contains(target) {
        return target === this || (target?.parent && this.contains(target.parent));
    }
    closest() {
        return this.dataset.tip ? this : (this.parent?.closest() ?? null);
    }
    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }
    setAttribute(name, value) {
        this.attributes.set(name, value);
    }
    removeAttribute(name) {
        this.attributes.delete(name);
    }
    getBoundingClientRect() {
        return this.rect;
    }
    showPopover() {
        this.inTopLayer = true;
    }
    hidePopover() {
        this.inTopLayer = false;
    }
}

function fixture() {
    let observer;
    const win = Object.assign(new EventTarget(), {
        Element,
        Node: Element,
        innerWidth: 390,
        innerHeight: 780,
        visualViewport: Object.assign(new EventTarget(), { width: 390, height: 780, offsetLeft: 0, offsetTop: 0 }),
        MutationObserver: class {
            constructor(callback) {
                this.callback = callback;
                observer = this;
            }
            observe() {}
            disconnect() {
                this.disconnected = true;
            }
        },
    });
    const doc = Object.assign(new EventTarget(), { defaultView: win, body: new Element() });
    const host = new Element();
    host.id = 'tooltip-test';
    host.rect = { width: 160, height: 40 };
    const trigger = new Element();
    trigger.dataset.tip = 'Edit photos';
    const cleanup = attachTooltip(host, doc);
    const fire = (type, target = trigger, relatedTarget = null, extra = {}) => {
        const event = new Event(type, { cancelable: true });
        Object.defineProperty(event, 'target', { value: target });
        Object.assign(event, { relatedTarget }, extra);
        doc.dispatchEvent(event);
        return event;
    };
    return { doc, win, host, trigger, cleanup, fire, observer };
}

test('focus shows a top-layer tooltip, preserves descriptions and clamps at phone edges', () => {
    const f = fixture();
    f.trigger.setAttribute('aria-describedby', 'existing-help');
    f.fire('focusin');
    assert.equal(f.host.hidden, false);
    assert.equal(f.host.inTopLayer, true);
    assert.equal(f.host.textContent, 'Edit photos');
    assert.equal(f.trigger.getAttribute('aria-describedby'), 'existing-help tooltip-test');
    assert.equal(f.host.style.left, '222px');
    assert.equal(f.host.style.top, '694px');
    f.trigger.setAttribute('aria-describedby', 'existing-help tooltip-test added-while-open');
    const escape = f.fire('keydown', f.trigger, null, { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(f.host.hidden, true);
    assert.equal(f.trigger.getAttribute('aria-describedby'), 'existing-help added-while-open');
    f.cleanup();
});

test('pointer can cross the gap and enter the tooltip, then leaving dismisses it', async () => {
    const f = fixture();
    f.fire('pointerover');
    f.fire('pointerout', f.trigger);
    await new Promise((resolve) => setTimeout(resolve, 30));
    f.fire('pointerover', f.host);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(f.host.hidden, false);
    f.fire('pointerout', f.host);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(f.host.hidden, true);
    f.cleanup();
});

test('keyboard focus retains the hint after pointer leaves and focus leaving closes it', () => {
    const f = fixture();
    f.fire('focusin');
    f.fire('pointerover');
    f.fire('pointerout');
    assert.equal(f.host.hidden, false);
    f.fire('focusout');
    assert.equal(f.host.hidden, true);
    assert.equal(f.trigger.getAttribute('aria-describedby'), null);
    f.cleanup();
});

test('click, scroll, resize, removed triggers and changed hints dismiss; cleanup removes listeners', async () => {
    const f = fixture();
    for (const type of ['pointerdown', 'click', 'scroll']) {
        f.fire('focusin');
        f.fire(type);
        assert.equal(f.host.hidden, true, type);
    }
    for (const type of ['resize', 'scroll']) {
        f.fire('focusin');
        f.win.visualViewport.dispatchEvent(new Event(type));
        assert.equal(f.host.hidden, true, `visual viewport ${type}`);
    }
    f.fire('focusin');
    f.win.dispatchEvent(new Event('resize'));
    assert.equal(f.host.hidden, true);
    f.fire('focusin');
    f.trigger.dataset.tip = 'Done';
    f.observer.callback();
    assert.equal(f.host.hidden, true);
    f.fire('focusin');
    f.trigger.isConnected = false;
    f.observer.callback();
    assert.equal(f.host.hidden, true);
    f.trigger.isConnected = true;
    f.fire('pointerover');
    f.fire('pointerout');
    f.cleanup();
    assert.equal(f.observer.disconnected, true);
    f.fire('focusin');
    f.fire('pointerover');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(f.host.hidden, true);
});

test('delegated hints work on nested icon targets and focusable disabled wrappers', () => {
    const f = fixture();
    const icon = new Element();
    icon.parent = f.trigger;
    f.fire('pointerover', icon);
    assert.equal(f.host.hidden, false);
    f.fire('click');
    f.trigger.dataset.tip = 'No earlier container';
    f.fire('focusin', f.trigger);
    assert.equal(f.host.textContent, 'No earlier container');
    f.cleanup();
});

test('switching triggers removes the old description; Escape stays dismissed within the same trigger', () => {
    const f = fixture();
    const other = new Element();
    other.dataset.tip = 'Save';
    f.fire('focusin');
    f.fire('pointerover', other);
    assert.equal(f.trigger.getAttribute('aria-describedby'), null);
    assert.equal(other.getAttribute('aria-describedby'), f.host.id);
    f.fire('keydown', other, null, { key: 'Escape' });
    const icon = new Element();
    icon.parent = other;
    f.fire('pointerover', icon, other);
    assert.equal(f.host.hidden, true);
    f.fire('pointerover', other);
    assert.equal(f.host.hidden, false);
    f.cleanup();
});

test('cleanup after a portal unmount avoids calling the top-layer API on a detached element', () => {
    const f = fixture();
    f.fire('focusin');
    f.host.isConnected = false;
    f.host.hidePopover = () => {
        throw new Error('InvalidStateError: popover is detached');
    };
    assert.doesNotThrow(f.cleanup);
    assert.equal(f.trigger.getAttribute('aria-describedby'), null);
});

test('React mounts one body portal; native hints are absent and disabled actions stay disabled', () => {
    const root = new URL('../src/', import.meta.url);
    const files = readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.tsx'));
    for (const file of files) {
        const text = readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8');
        assert.doesNotMatch(text, /<(?!iframe\b)[a-z][^>]*\btitle\s*=/s, file);
    }
    const host = readFileSync(new URL('Tooltip.tsx', root), 'utf8');
    assert.match(host, /createPortal\([\s\S]*role="tooltip"[\s\S]*document\.body/);
    const main = readFileSync(new URL('main.tsx', root), 'utf8');
    assert.equal(main.match(/<Tooltip \/>/g).length, 1);
    const container = readFileSync(new URL('pages/ContainerPage.tsx', root), 'utf8');
    assert.match(container, /tabIndex=\{!siblings\.prev \? 0 : undefined\}/);
    assert.match(container, /disabled=\{!siblings\.prev\}/);
    assert.match(container, /tabIndex=\{!siblings\.next \? 0 : undefined\}/);
    assert.match(container, /disabled=\{saving \|\| !name\.trim\(\)\}/);
    const css = readFileSync(new URL('styles.css', root), 'utf8');
    assert.match(css, /\.tooltip\s*\{[^}]*background: var\(--surface\);[^}]*color: var\(--text\);/);
});
