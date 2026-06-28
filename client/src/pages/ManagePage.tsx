import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import { invalidateLookups } from '../lookups';
import type { Lookup, LookupKind } from '../types';

const SECTIONS: { kind: LookupKind; title: string; icon: 'pin' | 'user' | 'tag'; placeholder: string }[] = [
    { kind: 'owners', title: 'Owners', icon: 'user', placeholder: 'e.g. Alex' },
    { kind: 'locations', title: 'Locations', icon: 'pin', placeholder: 'e.g. Garage, top shelf' },
    { kind: 'categories', title: 'Categories', icon: 'tag', placeholder: 'e.g. Electronics' },
];

export default function ManagePage() {
    const [ready, setReady] = useState(false);
    const [initial, setInitial] = useState<Record<LookupKind, Lookup[]>>({
        locations: [],
        owners: [],
        categories: [],
    });

    useEffect(() => {
        let active = true;
        Promise.all(
            SECTIONS.map((s) =>
                api
                    .listLookup(s.kind)
                    .then((items) => ({ kind: s.kind, items }))
                    .catch(() => ({ kind: s.kind, items: [] as Lookup[] })),
            ),
        ).then((res) => {
            if (!active) return;
            const next: Record<LookupKind, Lookup[]> = { locations: [], owners: [], categories: [] };
            for (const r of res) next[r.kind] = r.items;
            setInitial(next);
            setReady(true);
        });
        return () => {
            active = false;
        };
    }, []);

    if (!ready) return <Spinner />;

    return (
        <div>
            <h1>Tags</h1>
            <p className="muted" style={{ marginTop: -6 }}>
                Lists used when tagging containers and items.
            </p>
            <div className="stack" style={{ gap: 18 }}>
                {SECTIONS.map((s) => (
                    <LookupSection key={s.kind} {...s} initial={initial[s.kind]} />
                ))}
            </div>
        </div>
    );
}

function LookupSection({
    kind,
    title,
    icon,
    placeholder,
    initial,
}: {
    kind: LookupKind;
    title: string;
    icon: 'pin' | 'user' | 'tag';
    placeholder: string;
    initial: Lookup[];
}) {
    const [items, setItems] = useState<Lookup[]>(initial);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        try {
            setItems(await api.listLookup(kind));
        } catch {
            setError('Could not load list.');
        }
    }

    async function add() {
        const name = draft.trim();
        if (!name || busy) return;
        setBusy(true);
        setError(null);
        try {
            await api.createLookup(kind, name);
            invalidateLookups(kind);
            setDraft('');
            await load();
        } catch {
            setError('Could not add.');
        } finally {
            setBusy(false);
        }
    }

    async function rename(item: Lookup) {
        const name = window.prompt(`Rename "${item.name}" to:`, item.name)?.trim();
        if (!name || name === item.name) return;
        try {
            await api.renameLookup(kind, item.id, name);
            invalidateLookups(kind);
            await load();
        } catch {
            setError('Could not rename.');
        }
    }

    async function remove(item: Lookup) {
        if (!window.confirm(`Delete "${item.name}"? It will be removed from anything using it.`)) return;
        try {
            await api.deleteLookup(kind, item.id);
            invalidateLookups(kind);
            await load();
        } catch {
            setError('Could not delete.');
        }
    }

    return (
        <div className="card">
            <h2 style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name={icon} size={18} /> {title}
            </h2>
            <div className="row" style={{ marginBottom: 10 }}>
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && add()}
                    placeholder={placeholder}
                />
                <button className="small" onClick={add} disabled={busy || !draft.trim()}>
                    <Icon name="plus" size={16} /> Add
                </button>
            </div>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            {items.length === 0 ? (
                <div className="muted">Nothing yet.</div>
            ) : (
                <div className="stack" style={{ gap: 6 }}>
                    {items.map((item) => (
                        <div key={item.id} className="item-row">
                            <div className="grow">
                                <strong>{item.name}</strong>
                            </div>
                            <button
                                className="small ghost icon-btn"
                                onClick={() => rename(item)}
                                title="Rename"
                                aria-label="Rename"
                            >
                                <Icon name="pencil" size={15} />
                            </button>
                            <button
                                className="danger small icon-btn"
                                onClick={() => remove(item)}
                                title="Delete"
                                aria-label="Delete"
                            >
                                <Icon name="trash" size={15} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
