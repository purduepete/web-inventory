import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { pendingCount, syncNow } from './db';

export default function App() {
    const [online, setOnline] = useState(navigator.onLine);
    const [pending, setPending] = useState(0);

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
                <span className="brand">📦 Inventory</span>
                {!online && <span className="badge offline">Offline</span>}
                {pending > 0 && <span className="badge pending">{pending} to sync</span>}
            </header>

            <main className="content">
                <Outlet />
            </main>

            <nav className="tabbar">
                <NavLink to="/" end className="tab">
                    <span>🔎</span>Search
                </NavLink>
                <NavLink to="/containers" className="tab">
                    <span>📦</span>Containers
                </NavLink>
                <NavLink to="/scan" className="tab">
                    <span>📷</span>Scan
                </NavLink>
                <NavLink to="/containers/new" className="tab">
                    <span>➕</span>Add
                </NavLink>
            </nav>
        </div>
    );
}
