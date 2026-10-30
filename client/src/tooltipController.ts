export function attachTooltip(host: HTMLElement, doc: Document = document) {
    const win = doc.defaultView!;
    let active: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let overTooltip = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const triggerAt = (target: EventTarget | null) =>
        target instanceof win.Element ? target.closest<HTMLElement>('[data-tip]') : null;
    const contains = (element: HTMLElement | null, target: EventTarget | null) =>
        target instanceof win.Node && !!element?.contains(target);
    const cancelClose = () => {
        clearTimeout(timer);
        timer = undefined;
    };
    const close = () => {
        cancelClose();
        if (active) {
            const ids = (active.getAttribute('aria-describedby') ?? '')
                .split(/\s+/)
                .filter((id) => id && id !== host.id);
            if (ids.length) active.setAttribute('aria-describedby', ids.join(' '));
            else active.removeAttribute('aria-describedby');
        }
        active = null;
        overTooltip = false;
        if (host.isConnected) host.hidePopover?.();
        host.hidden = true;
    };
    const show = (trigger: HTMLElement) => {
        const text = trigger.dataset.tip;
        if (!text || !trigger.isConnected) return;
        cancelClose();
        if (active !== trigger) close();
        active = trigger;
        host.textContent = text;
        const ids = new Set((trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
        ids.add(host.id);
        trigger.setAttribute('aria-describedby', [...ids].join(' '));
        host.hidden = false;
        host.showPopover?.();
        const viewport = win.visualViewport;
        const left = (viewport?.offsetLeft ?? 0) + 8;
        const top = (viewport?.offsetTop ?? 0) + 8;
        const right = left + (viewport?.width ?? win.innerWidth) - 16;
        const bottom = top + (viewport?.height ?? win.innerHeight) - 16;
        host.style.maxWidth = `${Math.max(0, Math.min(320, right - left))}px`;
        host.style.maxHeight = `${Math.max(0, bottom - top)}px`;
        const anchor = trigger.getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const below = anchor.bottom + 6;
        host.style.left = `${Math.max(left, Math.min(anchor.left + (anchor.width - box.width) / 2, right - box.width))}px`;
        host.style.top = `${Math.max(top, Math.min(below + box.height <= bottom ? below : anchor.top - box.height - 6, bottom - box.height))}px`;
    };
    const scheduleClose = () => {
        cancelClose();
        timer = setTimeout(() => {
            if (active !== focused && active !== hovered && !overTooltip) close();
        }, 120);
    };
    const onPointerOver = (event: PointerEvent) => {
        if (contains(host, event.target)) {
            hovered = null;
            overTooltip = true;
            cancelClose();
            return;
        }
        overTooltip = false;
        hovered = triggerAt(event.target);
        if (hovered && hovered !== triggerAt(event.relatedTarget)) show(hovered);
    };
    const onPointerOut = (event: PointerEvent) => {
        if (contains(host, event.target)) overTooltip = false;
        else hovered = null;
        if (contains(host, event.relatedTarget) || contains(active, event.relatedTarget)) return;
        scheduleClose();
    };
    const onFocusIn = (event: FocusEvent) => {
        focused = triggerAt(event.target);
        if (focused) show(focused);
        else close();
    };
    const onFocusOut = (event: FocusEvent) => {
        if (contains(active, event.relatedTarget)) return;
        focused = null;
        if (active !== hovered && !overTooltip) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && active) {
            close();
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const observer = new win.MutationObserver(() => {
        if (active && (!active.isConnected || active.dataset.tip !== host.textContent)) close();
    });
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tip'] });
    doc.addEventListener('pointerover', onPointerOver, true);
    doc.addEventListener('pointerout', onPointerOut, true);
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('focusout', onFocusOut, true);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('pointerdown', close, true);
    doc.addEventListener('click', close, true);
    doc.addEventListener('scroll', close, true);
    win.addEventListener('resize', close);
    win.visualViewport?.addEventListener('resize', close);
    win.visualViewport?.addEventListener('scroll', close);
    return () => {
        close();
        observer.disconnect();
        doc.removeEventListener('pointerover', onPointerOver, true);
        doc.removeEventListener('pointerout', onPointerOut, true);
        doc.removeEventListener('focusin', onFocusIn, true);
        doc.removeEventListener('focusout', onFocusOut, true);
        doc.removeEventListener('keydown', onKeyDown, true);
        doc.removeEventListener('pointerdown', close, true);
        doc.removeEventListener('click', close, true);
        doc.removeEventListener('scroll', close, true);
        win.removeEventListener('resize', close);
        win.visualViewport?.removeEventListener('resize', close);
        win.visualViewport?.removeEventListener('scroll', close);
    };
}
