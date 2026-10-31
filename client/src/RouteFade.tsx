import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

const LEAVE_MS = 250;

/**
 * Fades the outgoing route out over 250ms, swaps in the new route, then fades it
 * in over 600ms (see `.route-fade` in styles.css). Query-string changes update in
 * place. `refreshKey` remounts the current route without replaying the fade.
 */
export function RouteFade({ refreshKey, refreshed }: { refreshKey: number; refreshed: boolean }) {
    const { pathname } = useLocation();
    const outlet = useOutlet();
    const [shownPath, setShownPath] = useState(pathname);
    const [leaving, setLeaving] = useState(false);
    const firstPage = useRef(true);
    const current = shownPath === pathname;
    // useOutlet returns a new element every render, so state here would loop forever.
    const shownOutlet = useRef<ReactNode>(outlet);
    if (current) shownOutlet.current = outlet;

    useEffect(() => {
        if (pathname === shownPath) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            firstPage.current = false;
            setShownPath(pathname);
            return;
        }
        setLeaving(true);
        const timer = setTimeout(() => {
            firstPage.current = false;
            setLeaving(false);
            setShownPath(pathname);
        }, LEAVE_MS);
        return () => clearTimeout(timer);
    }, [pathname, shownPath]);

    return (
        <div className="route-fade" data-leaving={leaving || undefined}>
            <div
                className="page"
                key={shownPath}
                data-first-entry={firstPage.current || undefined}
                data-refreshed={(current && refreshed) || undefined}
            >
                <Fragment key={refreshKey}>{shownOutlet.current}</Fragment>
            </div>
        </div>
    );
}
