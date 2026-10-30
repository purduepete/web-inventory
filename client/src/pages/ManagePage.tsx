import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import { useConfirm, usePrompt } from '../Dialog';
import { invalidateLookups } from '../lookups';
import { invalidateContainers } from '../containersCache';
import { usePersistentToggle } from '../usePersistentToggle';
import type { Lookup, LookupKind } from '../types';

const SECTIONS: { kind: LookupKind; title: string; icon: 'pin' | 'user' | 'tag'; placeholder: string }[] = [
    { kind: 'owners', title: 'Owners', icon: 'user', placeholder: 'e.g. Fat Bob' },
    { kind: 'locations', title: 'Locations', icon: 'pin', placeholder: 'e.g. Garage' },
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
                    .catch(() => ({ kind: s.kind, items: [] as Lookup[] }))
            )
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

    if (!ready) return <Spinner page label="Loading tags" />;

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
    // Tag sections are collapsed by default to keep the page compact; the
    // open/closed choice is remembered per section across reloads.
    const [open, setOpen] = usePersistentToggle(`webinv.tags.${kind}.open`, false);
    const confirm = useConfirm();
    const prompt = usePrompt();

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
        const name = (
            await prompt({
                title: `Rename ${title.replace(/ies$/, 'y').replace(/s$/, '').toLowerCase()}`,
                label: `Rename “${item.name}” to:`,
                defaultValue: item.name,
                confirmLabel: 'Rename',
            })
        )?.trim();
        if (!name || name === item.name) return;
        try {
            await api.renameLookup(kind, item.id, name);
            invalidateLookups(kind);
            // The container list shows denormalized owner/location names (D1).
            if (kind === 'owners' || kind === 'locations') invalidateContainers();
            await load();
        } catch {
            setError('Could not rename.');
        }
    }

    async function remove(item: Lookup) {
        const ok = await confirm({
            title: 'Delete',
            message: `Delete “${item.name}”? It will be removed from anything using it.`,
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await api.deleteLookup(kind, item.id);
            invalidateLookups(kind);
            if (kind === 'owners' || kind === 'locations') invalidateContainers();
            await load();
        } catch {
            setError('Could not delete.');
        }
    }

    return (
        <section className="owner-group">
            <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                <Icon name="chevron" size={18} className={`group-chevron${open ? ' open' : ''}`} />
                <Icon name={icon} size={16} />
                <span className="group-name">{title}</span>
                <span className="muted group-count">{items.length}</span>
            </button>
            {open && (
                <>
                    <div className="tag-add">
                        <div className="input-clear grow">
                            <input
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && add()}
                                placeholder={placeholder}
                            />
                            {draft && (
                                <button
                                    type="button"
                                    className="input-clear-btn"
                                    onClick={() => setDraft('')}
                                    data-tip="Clear"
                                    aria-label="Clear"
                                >
                                    <Icon name="close" size={16} />
                                </button>
                            )}
                        </div>
                        <span
                            className="tooltip-trigger"
                            role="group"
                            aria-label={busy || !draft.trim() ? 'Add' : undefined}
                            data-tip={busy || !draft.trim() ? 'Add' : undefined}
                            tabIndex={busy || !draft.trim() ? 0 : undefined}
                        >
                            <button
                                className="small icon-btn"
                                onClick={add}
                                disabled={busy || !draft.trim()}
                                data-tip="Add"
                                aria-label="Add"
                            >
                                <Icon name="plus" size={16} />
                            </button>
                        </span>
                    </div>
                    {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
                    {items.length === 0 ? (
                        <div className="muted">Nothing yet.</div>
                    ) : (
                        <div className="stack tag-list" style={{ gap: 0 }}>
                            {items.map((item) => (
                                <div key={item.id} className="item-row">
                                    <div className="grow">
                                        <strong>{item.name}</strong>
                                    </div>
                                    <button
                                        className="danger small icon-btn"
                                        onClick={() => remove(item)}
                                        data-tip="Delete"
                                        aria-label="Delete"
                                    >
                                        <Icon name="trash" size={15} />
                                    </button>
                                    <button
                                        className="small ghost icon-btn"
                                        onClick={() => rename(item)}
                                        data-tip="Rename"
                                        aria-label="Rename"
                                    >
                                        <Icon name="pencil" size={15} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
