import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Item } from '../types';

export default function HomePage() {
    const [q, setQ] = useState('');
    const [tag, setTag] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [results, setResults] = useState<Item[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    useEffect(() => {
        api.listTags()
            .then(setTags)
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (!q && !tag) {
            setResults([]);
            setSearched(false);
            return;
        }
        const t = setTimeout(() => {
            setLoading(true);
            api.searchItems(q, tag || undefined)
                .then((r) => {
                    setResults(r);
                    setSearched(true);
                })
                .catch(() => undefined)
                .finally(() => setLoading(false));
        }, 250);
        return () => clearTimeout(t);
    }, [q, tag]);

    return (
        <div>
            <h1>Find an item</h1>
            <input
                autoFocus
                placeholder="Search items by name or description…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
            />
            {tags.length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <span
                        className={`pill selectable${!tag ? ' active' : ''}`}
                        onClick={() => setTag('')}
                    >
                        All
                    </span>
                    {tags.map((t) => (
                        <span
                            key={t}
                            className={`pill selectable${tag === t ? ' active' : ''}`}
                            onClick={() => setTag(tag === t ? '' : t)}
                        >
                            {t}
                        </span>
                    ))}
                </div>
            )}

            <h2>
                {loading ? 'Searching…' : searched ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}
            </h2>
            <div className="stack card-grid">
                {results.map((it) => (
                    <Link key={it.id} to={`/containers/${it.containerId}`} className="card">
                        <div className="spread">
                            <strong>{it.name}</strong>
                            {it.quantity > 1 && <span className="muted">×{it.quantity}</span>}
                        </div>
                        {it.description && <div className="muted">{it.description}</div>}
                        {it.tags.map((t) => (
                            <span key={t} className="pill">
                                {t}
                            </span>
                        ))}
                    </Link>
                ))}
                {searched && !loading && results.length === 0 && (
                    <div className="center">No matches. Try a different term.</div>
                )}
                {!searched && (
                    <div className="center">
                        Search across every container, or{' '}
                        <Link to="/containers" className="link">
                            browse containers
                        </Link>
                        .
                    </div>
                )}
            </div>
        </div>
    );
}
