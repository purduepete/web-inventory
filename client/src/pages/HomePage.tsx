import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../Icon';
import { Select } from '../Select';
import { Spinner } from '../Spinner';
import { getCachedLookupFast, getCachedTagsFast, getLookup, getTags } from '../lookups';
import { usePersistentToggle } from '../usePersistentToggle';
import type { Facet, Item, Lookup } from '../types';
import { useFirstLoad } from '../FirstLoad';

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
    const [facets, setFacets] = useState<Facet[]>([]);
    const [filters, setFilters] = useState<Filters>(loadFilters);
    const [results, setResults] = useState<Item[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [ready, setReady] = useState(false);
    const [loadSettled, setLoadSettled] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const filtersReady = (!filters.locationId && !filters.ownerId && !filters.categoryId) || searched;
    useFirstLoad(ready && filtersReady, Boolean(error), loadSettled && filtersReady);
    // Filters start expanded on tablets and larger (iPad and up); on phones
    // (iPhone) they stay collapsed behind the toggle to save vertical space.
    // The chosen state is then persisted so it sticks across navigation/reloads.
    const [filtersOpen, setFiltersOpen] = usePersistentToggle(
        'webinv.search.filtersOpen',
        typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    );

    useEffect(() => {
        let active = true;
        let cachedFacets: Facet[] | undefined;
        try {
            const cached: unknown = JSON.parse(localStorage.getItem('webinv.search.facets') ?? 'null');
            if (Array.isArray(cached)) cachedFacets = cached as Facet[];
        } catch {
            /* Storage may be unavailable. */
        }
        void Promise.all([
            getCachedTagsFast(),
            getCachedLookupFast('locations'),
            getCachedLookupFast('owners'),
            getCachedLookupFast('categories'),
        ])
            .then(([tags, locations, owners, categories]) => {
                if (!active || !tags || !locations || !owners || !categories || !cachedFacets) return;
                setTags(tags);
                setLocations(locations);
                setOwners(owners);
                setCategories(categories);
                setFacets(cachedFacets);
                setReady(true);
            })
            .catch(() => {});
        Promise.allSettled([
            getTags().then(setTags),
            getLookup('locations').then(setLocations),
            getLookup('owners').then(setOwners),
            getLookup('categories').then(setCategories),
            api
                .listFacets()
                .then((facets) => {
                    if (!active) return;
                    setFacets(facets);
                    try {
                        localStorage.setItem('webinv.search.facets', JSON.stringify(facets));
                    } catch {
                        /* Storage may be unavailable. */
                    }
                })
                .catch((error: unknown) => {
                    if (!cachedFacets) throw error;
                }),
        ]).then((responses) => {
            if (!active) return;
            if (responses.some((r) => r.status === 'rejected')) setError('Unable to load search filters.');
            setReady(true);
            setLoadSettled(true);
        });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    }, [filters]);

    // Cascading filters: picking an owner narrows the available locations to those
    // that own an item, which in turn narrows the categories. If no facet data is
    // available we fall back to showing every lookup so search still works.
    const cascade = facets.length > 0;

    const allowedLocationIds = useMemo(() => {
        const set = new Set<string>();
        for (const f of facets) {
            if (filters.ownerId && (f.ownerId ?? '') !== filters.ownerId) continue;
            if (f.locationId) set.add(f.locationId);
        }
        return set;
    }, [facets, filters.ownerId]);

    const allowedCategoryIds = useMemo(() => {
        const set = new Set<string>();
        for (const f of facets) {
            if (filters.ownerId && (f.ownerId ?? '') !== filters.ownerId) continue;
            if (filters.locationId && (f.locationId ?? '') !== filters.locationId) continue;
            if (f.categoryId) set.add(f.categoryId);
        }
        return set;
    }, [facets, filters.ownerId, filters.locationId]);

    const locationOptions = cascade ? locations.filter((l) => allowedLocationIds.has(l.id)) : locations;
    const categoryOptions = cascade ? categories.filter((c) => allowedCategoryIds.has(c.id)) : categories;

    // Drop any downstream selection that the current upstream choice no longer allows.
    useEffect(() => {
        if (!cascade) return;
        setFilters((f) => {
            let next = f;
            if (f.locationId && !allowedLocationIds.has(f.locationId)) next = { ...next, locationId: '' };
            if (f.categoryId && !allowedCategoryIds.has(f.categoryId)) next = { ...next, categoryId: '' };
            return next === f ? f : next;
        });
    }, [cascade, allowedLocationIds, allowedCategoryIds]);

    const hasFilter = !!(filters.locationId || filters.ownerId || filters.categoryId);
    const activeFilterCount = (filters.ownerId ? 1 : 0) + (filters.locationId ? 1 : 0) + (filters.categoryId ? 1 : 0);

    useEffect(() => {
        if (!q && !tag && !hasFilter) {
            setResults([]);
            setHasMore(false);
            setSearched(false);
            return;
        }
        let cancelled = false;
        const t = setTimeout(() => {
            setLoading(true);
            api.searchItems(q, {
                tag: tag || undefined,
                locationId: filters.locationId || undefined,
                ownerId: filters.ownerId || undefined,
                categoryId: filters.categoryId || undefined,
            })
                .then((r) => {
                    // Ignore a slow older response that resolved after a newer query (B5).
                    if (cancelled) return;
                    setResults(r.items);
                    setHasMore(r.hasMore);
                    setSearched(true);
                })
                .catch(() => setError('Unable to load search results.'))
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [q, tag, filters, hasFilter]);

    if (error) return <p role="alert">{error}</p>;
    if (!ready) return <Spinner page label="Loading search" />;

    return (
        <div>
            <h1>Find an item</h1>
            <div className="collapse-filter">
                <button
                    type="button"
                    className="collapse-toggle"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen((o) => !o)}
                >
                    <Icon name="sliders" size={15} />
                    <span>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</span>
                    <Icon name="chevron" size={15} className={`collapse-chevron${filtersOpen ? ' open' : ''}`} />
                </button>
                {filtersOpen && (
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
                                ...locationOptions.map((l) => ({ value: l.id, label: l.name })),
                            ]}
                        />
                        <Select
                            value={filters.categoryId}
                            onChange={(v) => setFilters((f) => ({ ...f, categoryId: v }))}
                            ariaLabel="Filter by category"
                            options={[
                                { value: '', label: 'All categories' },
                                ...categoryOptions.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                        />
                        {(hasFilter || tag) && (
                            <button
                                type="button"
                                className="ghost small filter-clear"
                                onClick={() => {
                                    setFilters({ locationId: '', ownerId: '', categoryId: '' });
                                    setTag('');
                                }}
                            >
                                <Icon name="close" size={15} />
                                Clear filters
                            </button>
                        )}
                    </div>
                )}
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
                {loading ? (
                    <Spinner size="sm" label="Searching" />
                ) : searched ? (
                    `${results.length}${hasMore ? '+' : ''} result${results.length === 1 ? '' : 's'}`
                ) : (
                    ''
                )}
            </h2>
            {searched && !loading && hasMore && (
                <div className="muted" style={{ marginBottom: 8 }}>
                    Showing the first {results.length}. Refine your search or add filters to narrow it down.
                </div>
            )}
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
