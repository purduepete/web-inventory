import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { pendingCount, syncNow } from './db';
import { Icon } from './Icon';
import { HelpDialog } from './HelpDialog';
import { KeyGate } from './KeyGate';
import { clearKey, getKey, validateKey, KEY_INVALID_EVENT, platformAuth } from './api';
import { readTheme, trackTheme, type ThemePreference } from './theme';
import { Select } from './Select';

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
    const [reloading, setReloading] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [theme, setTheme] = useState<ThemePreference>(readTheme);
    const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(() =>
        theme === 'light' || (theme === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches)
            ? 'light'
            : 'dark'
    );

    useEffect(() => {
        return trackTheme(theme, setEffectiveTheme);
    }, [theme]);

    function toggleTheme() {
        setTheme(effectiveTheme === 'dark' ? 'light' : 'midnight');
    }

    function reloadData() {
        if (reloading) return;
        setReloading(true);
        // Remount the current route so its data-loading effects re-run.
        setReloadKey((k) => k + 1);
        setTimeout(() => setReloading(false), 1000);
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
        <div className="app">
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
                            title={syncing ? 'Syncing…' : !online ? 'Offline — tap to retry' : 'Tap to sync now'}
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
                    <button
                        className={`theme-toggle reload-btn${reloading ? ' spinning' : ''}`}
                        onClick={reloadData}
                        title="Reload data"
                        aria-label="Reload data"
                    >
                        <Icon name="sync" size={18} />
                    </button>
                    <button
                        className="theme-toggle"
                        onClick={() => setHelpOpen(true)}
                        title="Help & key concepts"
                        aria-label="Help and key concepts"
                    >
                        <Icon name="help" size={18} />
                    </button>
                    <Select
                        ariaLabel="Theme"
                        auto
                        value={theme}
                        onChange={(value) => setTheme(value as ThemePreference)}
                        options={[
                            { value: 'system', label: 'System' },
                            { value: 'light', label: 'Light' },
                            { value: 'midnight', label: 'Midnight' },
                        ]}
                    />
                    <button
                        className="theme-toggle"
                        onClick={toggleTheme}
                        title={effectiveTheme === 'dark' ? 'Switch to light theme' : 'Switch to midnight theme'}
                        aria-label="Toggle color theme"
                    >
                        <Icon name={effectiveTheme === 'dark' ? 'sun' : 'moon'} size={18} />
                    </button>
                </div>
            </header>

            <main className="content">
                <div className="page" key={`${location.pathname}#${reloadKey}`}>
                    <Outlet />
                </div>
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
        </div>
    );
}
