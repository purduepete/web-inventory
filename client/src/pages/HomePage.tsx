import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../Icon';
import { Select } from '../Select';
import { Spinner } from '../Spinner';
import { getLookup, getTags } from '../lookups';
import type { Item, Lookup } from '../types';

const FILTER_KEY = 'webinv.search.filters';

type Filters = { locationId: string; ownerId: string; categoryId: string };

function loadFilters(): Filters {
    try {
        const raw = localStorage.getItem(FILTER_KEY);
        if (raw) {
            const f = JSON.parse(raw) as Partial<Filters>;
            return { locationId: f.locationId ?? '', ownerId: f.ownerId ?? '', categoryId: f.categoryId ?? '' };
        }
    } catch {
        /* ignore */
    }
    return { locationId: '', ownerId: '', categoryId: '' };
}

export default function HomePage() {
    const [q, setQ] = useState('');
    const [tag, setTag] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [locations, setLocations] = useState<Lookup[]>([]);
    const [owners, setOwners] = useState<Lookup[]>([]);
    const [categories, setCategories] = useState<Lookup[]>([]);
    const [filters, setFilters] = useState<Filters>(loadFilters);
    const [results, setResults] = useState<Item[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        Promise.allSettled([
            getTags().then(setTags),
            getLookup('locations').then(setLocations),
            getLookup('owners').then(setOwners),
            getLookup('categories').then(setCategories),
        ]).finally(() => setReady(true));
    }, []);

    useEffect(() => {
        localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    }, [filters]);

    const hasFilter = !!(filters.locationId || filters.ownerId || filters.categoryId);

    useEffect(() => {
        if (!q && !tag && !hasFilter) {
            setResults([]);
            setSearched(false);
            return;
        }
        const t = setTimeout(() => {
            setLoading(true);
            api.searchItems(q, {
                tag: tag || undefined,
                locationId: filters.locationId || undefined,
                ownerId: filters.ownerId || undefined,
                categoryId: filters.categoryId || undefined,
            })
                .then((r) => {
                    setResults(r);
                    setSearched(true);
                })
                .catch(() => undefined)
                .finally(() => setLoading(false));
        }, 250);
        return () => clearTimeout(t);
    }, [q, tag, filters, hasFilter]);

    if (!ready) return <Spinner />;

    return (
        <div>
            <h1>Find an item</h1>
            <div className="filter-row">
                <Select
                    value={filters.ownerId}
                    onChange={(v) => setFilters((f) => ({ ...f, ownerId: v }))}
                    ariaLabel="Filter by owner"
                    options={[
                        { value: '', label: 'All owners' },
                        ...owners.map((o) => ({ value: o.id, label: o.name })),
                    ]}
                />
                <Select
                    value={filters.locationId}
                    onChange={(v) => setFilters((f) => ({ ...f, locationId: v }))}
                    ariaLabel="Filter by location"
                    options={[
                        { value: '', label: 'All locations' },
                        ...locations.map((l) => ({ value: l.id, label: l.name })),
                    ]}
                />
                <Select
                    value={filters.categoryId}
                    onChange={(v) => setFilters((f) => ({ ...f, categoryId: v }))}
                    ariaLabel="Filter by category"
                    options={[
                        { value: '', label: 'All categories' },
                        ...categories.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                />
            </div>
            <div className="search-input">
                <input
                    autoFocus
                    placeholder="Search items by name or description…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                    <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                        <Icon name="close" size={16} />
                    </button>
                )}
            </div>
            {tags.length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <span className={`pill selectable${!tag ? ' active' : ''}`} onClick={() => setTag('')}>
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
