import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { pendingCount, syncNow } from './db';
import { Icon } from './Icon';

export default function App() {
    const [online, setOnline] = useState(navigator.onLine);
    const [pending, setPending] = useState(0);
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
            ?.setAttribute('content', effective === 'light' ? '#f6f8fa' : '#0a0e1a');
    }, [theme]);

    function toggleTheme() {
        const effective = theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = effective === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', next);
        setTheme(next);
    }

    const effectiveTheme =
        theme ??
        (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    useEffect(() => {
        const refresh = () => void pendingCount().then(setPending);
        refresh();
        const onOnline = () => {
            setOnline(true);
            void syncNow().then(refresh);
        };
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        const t = setInterval(refresh, 4000);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            clearInterval(t);
        };
    }, []);

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
                    {!online && <span className="badge offline">Offline</span>}
                    {pending > 0 && <span className="badge pending">{pending} to sync</span>}
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
                <Outlet />
            </main>

            <nav className="tabbar">
                <NavLink to="/" end className="tab">
                    <Icon name="search" />
                    Search
                </NavLink>
                <NavLink to="/containers" className="tab">
                    <Icon name="boxes" />
                    Containers
                </NavLink>
                <NavLink to="/scan" className="tab">
                    <Icon name="scan" />
                    Scan
                </NavLink>
                <NavLink to="/containers/new" className="tab">
                    <Icon name="plus" />
                    Add
                </NavLink>
            </nav>
        </div>
    );
}
