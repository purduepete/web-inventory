import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { pendingCount, syncNow } from './db';
import { Icon } from './Icon';
import { HelpDialog } from './HelpDialog';
import { Spinner } from './Spinner';
import { getClientPrincipal, redirectToLogin } from './auth';

export default function App() {
    const [online, setOnline] = useState(navigator.onLine);
    const [pending, setPending] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    // 'checking' until we know whether there's a signed-in session; 'redirecting'
    // while we bounce to the AAD login; 'ok' once authenticated (or offline, where
    // we can't tell and let the cached/offline app run).
    const [authState, setAuthState] = useState<'checking' | 'ok' | 'redirecting'>('checking');
    const location = useLocation();
    const [reloadKey, setReloadKey] = useState(0);
    const [reloading, setReloading] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark' | null>(
        () => (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? null,
    );

    useEffect(() => {
        const root = document.documentElement;
        if (theme) root.setAttribute('data-theme', theme);
        else root.removeAttribute('data-theme');
        const effective = theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document
            .querySelector('meta[name="theme-color"]')
            ?.setAttribute('content', effective === 'light' ? '#f6f8fa' : '#1a1b26');
    }, [theme]);

    function toggleTheme() {
        const effective = theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = effective === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', next);
        setTheme(next);
    }

    function reloadData() {
        if (reloading) return;
        setReloading(true);
        // Remount the current route so its data-loading effects re-run.
        setReloadKey((k) => k + 1);
        setTimeout(() => setReloading(false), 1000);
    }

    const effectiveTheme =
        theme ??
        (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    useEffect(() => {
        let active = true;
        // Proactively confirm there's a signed-in session on startup. If the SWA
        // session has expired, bounce straight to the AAD login instead of
        // rendering an app whose every API call silently fails (empty pages).
        // When offline we can't tell, so we let the cached app run.
        if (!navigator.onLine) {
            setAuthState('ok');
        } else {
            void getClientPrincipal().then((principal) => {
                if (!active) return;
                if (principal === null) {
                    setAuthState('redirecting');
                    redirectToLogin();
                } else {
                    // Signed in, or status unknown (treat as ok so the app still loads).
                    setAuthState('ok');
                }
            });
        }
        return () => {
            active = false;
        };
    }, []);

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

    // Block the app shell until we know the auth state, and show a clear message
    // while bouncing to sign in — the user never lands on a broken/empty app.
    if (authState !== 'ok') {
        return (
            <div className="app">
                <main className="content">
                    <Spinner label={authState === 'redirecting' ? 'Redirecting to sign in…' : 'Loading…'} />
                </main>
            </div>
        );
    }

    return (
        <div className="app">
            <header className="topbar">
                <span className="brand">
                    <span className="brand-mark">
                        <Icon name="box" size={18} />
                    </span>
                    Inventory
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
                    <button
                        className="theme-toggle"
                        onClick={toggleTheme}
                        title={effectiveTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
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

            <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}
