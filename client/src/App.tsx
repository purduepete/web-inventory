import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Info, Monitor, Moon, Palette, RefreshCw, Sun } from 'lucide-react';
import { pendingCount, syncNow } from './db';
import { Icon } from './Icon';
import { HelpDialog } from './HelpDialog';
import { KeyGate } from './KeyGate';
import { clearKey, getKey, validateKey, KEY_INVALID_EVENT, platformAuth } from './api';
import { readTheme, trackTheme, type ThemePreference } from './theme';
import { RouteFade } from './RouteFade';
import { FirstLoad } from './FirstLoad';

const THEME_LABELS: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    midnight: 'Midnight',
};

export default function App() {
    const [online, setOnline] = useState(navigator.onLine);
    const [pending, setPending] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    // Access state: 'checking' while we validate a stored key against the server,
    // 'authed' once it's confirmed, 'gate' when there's no valid key. Starting in
    // 'checking' (when a key exists) means the app UI never paints before the key
    // is verified — an invalid/stale key drops straight to the gate.
    const [authState, setAuthState] = useState<'checking' | 'authed' | 'gate'>(() =>
        platformAuth || getKey() ? 'checking' : 'gate'
    );
    // During the initial key check we render only the themed background — no
    // positioned card — so nothing can appear off-centre while the iOS standalone
    // launch viewport resettles. A loader card is revealed ONLY if the check runs
    // long (by which point the viewport has long since settled).
    const [slowCheck, setSlowCheck] = useState(false);
    const location = useLocation();
    const [reloadKey, setReloadKey] = useState(0);
    const [reloadedLocation, setReloadedLocation] = useState<string | null>(null);
    const [reloading, setReloading] = useState(false);
    const finishReload = useCallback(() => setReloading(false), []);
    const [helpOpen, setHelpOpen] = useState(false);
    const [theme, setTheme] = useState<ThemePreference>(readTheme);
    const [headerPanel, setHeaderPanel] = useState<'info' | 'theme' | null>(null);
    const infoAnchorRef = useRef<HTMLDivElement>(null);
    const themeAnchorRef = useRef<HTMLDivElement>(null);
    const infoTriggerRef = useRef<HTMLButtonElement>(null);
    const themeTriggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        return trackTheme(theme, () => {});
    }, [theme]);

    useEffect(() => {
        if (!headerPanel) return;

        const onPointerDown = (event: PointerEvent) => {
            const anchor = headerPanel === 'info' ? infoAnchorRef.current : themeAnchorRef.current;
            if (anchor && !anchor.contains(event.target as Node)) setHeaderPanel(null);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setHeaderPanel(null);
            (headerPanel === 'info' ? infoTriggerRef.current : themeTriggerRef.current)?.focus();
        };

        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [headerPanel]);

    function reloadData() {
        if (reloading) return;
        setReloading(true);
        // Remount the current route so its data-loading effects re-run.
        setReloadedLocation(location.key);
        setReloadKey((k) => k + 1);
    }

    useEffect(() => {
        // Only surface a loader card if the key check is slow. The delay is long
        // enough that the iOS standalone launch viewport has fully settled, so the
        // centred card can never be seen mid-resettle.
        if (authState !== 'checking') return;
        const t = setTimeout(() => setSlowCheck(true), 900);
        return () => clearTimeout(t);
    }, [authState]);

    useEffect(() => {
        // Validate a stored key on load before showing the app. No key → gate;
        // rejected key → forget it and show the gate.
        if (!platformAuth && !getKey()) {
            setAuthState('gate');
            return;
        }
        let cancelled = false;
        void validateKey().then((ok) => {
            if (cancelled) return;
            if (ok) {
                setAuthState('authed');
            } else {
                clearKey();
                setAuthState('gate');
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        // When any API call gets a 401 the key has been cleared; drop to the gate.
        const onInvalid = () => setAuthState('gate');
        window.addEventListener(KEY_INVALID_EVENT, onInvalid);
        return () => window.removeEventListener(KEY_INVALID_EVENT, onInvalid);
    }, []);

    function signOut() {
        if (platformAuth) {
            window.location.assign('/cdn-cgi/access/logout');
            return;
        }
        clearKey();
        setAuthState('gate');
    }

    useEffect(() => {
        const refresh = () => void pendingCount().then(setPending);
        refresh();
        const autoSync = () => {
            if (!navigator.onLine) return;
            setSyncing(true);
            void syncNow()
                .then((r) => {
                    refresh();
                    if (r.failed > 0) setSyncMsg('Some changes failed to sync — will retry.');
                })
                .finally(() => setSyncing(false));
        };
        // Attempt a sync on startup if we're already online with a queue —
        // the 'online' event only fires on a transition, not at load.
        autoSync();
        const onOnline = () => {
            setOnline(true);
            autoSync();
        };
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        // The queue layer fires 'pending-changed' on enqueue/sync, so we react to
        // it directly instead of polling on a timer.
        window.addEventListener('pending-changed', refresh);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('pending-changed', refresh);
        };
    }, []);

    async function manualSync() {
        if (syncing || !navigator.onLine) return;
        setSyncing(true);
        try {
            const r = await syncNow();
            setPending(await pendingCount());
            if (r.failed > 0) setSyncMsg('Some changes failed to sync — will retry.');
        } catch {
            // queue stays; will retry on next sync
        } finally {
            setSyncing(false);
        }
    }

    // Briefly show, then auto-dismiss, a sync failure message.
    useEffect(() => {
        if (!syncMsg) return;
        const t = setTimeout(() => setSyncMsg(null), 4000);
        return () => clearTimeout(t);
    }, [syncMsg]);

    // While validating a stored key, render only the themed background so nothing
    // is painted (and nothing can jump) during the iOS launch viewport resettle.
    // A centred loader card appears only if the check is slow (see `slowCheck`).
    if (authState === 'checking') {
        return (
            <div className="app-splash" aria-hidden="true">
                {slowCheck && (
                    <div className="gate-card">
                        <span className="brand-mark gate-mark">
                            <Icon name="lock" size={22} />
                        </span>
                        <p className="muted gate-sub">Checking access…</p>
                    </div>
                )}
            </div>
        );
    }

    // Show the access-key gate until a valid key is confirmed.
    if (authState !== 'authed') {
        if (platformAuth)
            return (
                <main className="page">
                    <h1>Sign-in required</h1>
                    <p>Refresh to sign in through Cloudflare Access. Private access requires Tailscale.</p>
                    <button onClick={() => window.location.reload()}>Refresh</button>
                </main>
            );
        return <KeyGate onSaved={() => setAuthState('authed')} />;
    }

    return (
        <>
            <FirstLoad>
                <header className="topbar">
                    <span className="brand">
                        <span className="brand-mark">
                            <Icon name="box" size={18} />
                        </span>
                        Web Inventory
                    </span>
                    <div className="topbar-actions">
                        {(!online || pending > 0 || syncing) && (
                            <button
                                type="button"
                                className={`sync-pill ${syncing ? 'syncing' : !online ? 'offline' : 'idle'}`}
                                onClick={manualSync}
                                aria-label={
                                    syncing
                                        ? `Syncing, ${pending} remaining`
                                        : !online
                                          ? `Offline, ${pending} to sync`
                                          : `${pending} to sync, tap to sync`
                                }
                            >
                                <Icon
                                    name={syncing ? 'sync' : !online ? 'cloud-off' : 'cloud'}
                                    size={15}
                                    className={syncing ? 'spinning' : undefined}
                                />
                                <span>{pending}</span>
                            </button>
                        )}
                        <div
                            className="header-popover-anchor"
                            ref={infoAnchorRef}
                            onMouseEnter={() => setHeaderPanel('info')}
                            onMouseLeave={() => {
                                if (!infoAnchorRef.current?.contains(document.activeElement)) setHeaderPanel(null);
                            }}
                            onBlur={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    setHeaderPanel((current) => (current === 'info' ? null : current));
                                }
                            }}
                        >
                            <span id="refresh-sync-description" className="sr-only">
                                Reload fetches the current view again. Sync sends queued changes to the cloud.
                            </span>
                            <button
                                ref={infoTriggerRef}
                                type="button"
                                className="theme-toggle"
                                onClick={() => setHeaderPanel('info')}
                                onFocus={() => setHeaderPanel('info')}
                                aria-label="Refresh and sync information"
                                aria-describedby="refresh-sync-description"
                                aria-haspopup="dialog"
                                aria-expanded={headerPanel === 'info'}
                                aria-controls="refresh-sync-popover"
                            >
                                <Info size={18} aria-hidden="true" />
                            </button>
                            <div
                                id="refresh-sync-popover"
                                className="header-popover"
                                role="dialog"
                                aria-labelledby="refresh-sync-title"
                                hidden={headerPanel !== 'info'}
                            >
                                <h2 id="refresh-sync-title">Refresh and sync</h2>
                                <p>
                                    Reload fetches the current view again. Sync sends your queued changes to the cloud.
                                </p>
                                <button
                                    type="button"
                                    className="ghost small"
                                    onClick={() => {
                                        setHeaderPanel(null);
                                        setHelpOpen(true);
                                    }}
                                >
                                    Help and key concepts
                                </button>
                            </div>
                        </div>
                        <button
                            type="button"
                            className={`theme-toggle reload-btn${reloading ? ' spinning' : ''}`}
                            onClick={reloadData}
                            aria-label="Reload data"
                            aria-busy={reloading}
                            disabled={reloading}
                        >
                            <RefreshCw size={18} aria-hidden="true" />
                        </button>
                        <div
                            className="header-popover-anchor"
                            ref={themeAnchorRef}
                            onBlur={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    setHeaderPanel((current) => (current === 'theme' ? null : current));
                                }
                            }}
                        >
                            <button
                                ref={themeTriggerRef}
                                type="button"
                                className="theme-toggle"
                                onClick={() => setHeaderPanel((current) => (current === 'theme' ? null : 'theme'))}
                                aria-label={`Theme: ${THEME_LABELS[theme]}`}
                                aria-haspopup="dialog"
                                aria-expanded={headerPanel === 'theme'}
                                aria-controls="theme-popover"
                            >
                                <Palette size={18} aria-hidden="true" />
                            </button>
                            <div
                                id="theme-popover"
                                className="header-popover"
                                role="dialog"
                                aria-label="Appearance settings"
                                hidden={headerPanel !== 'theme'}
                            >
                                <span className="header-popover-label">Theme</span>
                                <div
                                    className="header-theme-picker"
                                    role="group"
                                    aria-label="Theme"
                                    style={
                                        {
                                            '--theme-index': ['light', 'midnight', 'system'].indexOf(theme),
                                        } as CSSProperties
                                    }
                                >
                                    <span className="header-theme-selection" aria-hidden="true" />
                                    <button
                                        type="button"
                                        className="header-theme-option"
                                        onClick={() => setTheme('light')}
                                        aria-pressed={theme === 'light'}
                                    >
                                        <Sun size={15} aria-hidden="true" />
                                        <span>Light</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="header-theme-option"
                                        onClick={() => setTheme('midnight')}
                                        aria-pressed={theme === 'midnight'}
                                    >
                                        <Moon size={15} aria-hidden="true" />
                                        <span>Midnight</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="header-theme-option"
                                        onClick={() => setTheme('system')}
                                        aria-pressed={theme === 'system'}
                                    >
                                        <Monitor size={15} aria-hidden="true" />
                                        <span>System</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="content">
                    <RouteFade
                        refreshKey={reloadKey}
                        refreshed={reloadedLocation === location.key}
                        onReady={finishReload}
                    />
                </main>
                {syncMsg && (
                    <div className="toast" role="status" onClick={() => setSyncMsg(null)}>
                        {syncMsg}
                    </div>
                )}
                <nav className="tabbar">
                    <NavLink to="/" end className="tab">
                        <Icon name="search" />
                        Search
                    </NavLink>
                    <div className="tab-group">
                        <div className="tab-group-title">
                            <Icon name="boxes" />
                            Containers
                        </div>
                        <NavLink to="/containers" end className="tab subtab">
                            <Icon name="box" />
                            Inventory
                        </NavLink>
                        <NavLink to="/containers/new" className="tab subtab">
                            <Icon name="plus" />
                            Add
                        </NavLink>
                    </div>
                    <NavLink to="/scan" className="tab">
                        <Icon name="scan" />
                        Scan
                    </NavLink>
                    <NavLink to="/manage" className="tab">
                        <Icon name="tag" />
                        Tags
                    </NavLink>
                </nav>

                <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onSignOut={signOut} />
            </FirstLoad>
        </>
    );
}
