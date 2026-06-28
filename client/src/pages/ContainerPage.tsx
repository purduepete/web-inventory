import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { enqueue, enqueuePhoto, syncNow } from '../db';
import { downscaleImage } from '../image';
import { makeQrDataUrl, printLabel } from '../qr';
import { Icon } from '../Icon';
import { Select } from '../Select';
import { Spinner } from '../Spinner';
import { getLookup } from '../lookups';
import type { Container, ContainerWithContents, DetectedItem, Item, Lookup } from '../types';

export default function ContainerPage({ byToken = false }: { byToken?: boolean }) {
    const params = useParams();
    const nav = useNavigate();
    const key = byToken ? params.token! : params.id!;

    const [container, setContainer] = useState<ContainerWithContents | null>(null);
    const [loading, setLoading] = useState(true);
    const [qr, setQr] = useState<string>('');
    const [toast, setToast] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<DetectedItem[] | null>(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(false);
    const [locations, setLocations] = useState<Lookup[]>([]);
    const [owners, setOwners] = useState<Lookup[]>([]);
    const [categories, setCategories] = useState<Lookup[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const c = byToken ? await api.getContainerByToken(key) : await api.getContainer(key);
            setContainer(c);
            setQr(await makeQrDataUrl(c.qrToken));
        } catch {
            setContainer(null);
        } finally {
            setLoading(false);
        }
    }, [byToken, key]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        void getLookup('locations')
            .then(setLocations)
            .catch(() => {});
        void getLookup('owners')
            .then(setOwners)
            .catch(() => {});
        void getLookup('categories')
            .then(setCategories)
            .catch(() => {});
    }, []);

    function flash(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2200);
    }

    async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !container) return;
        setBusy(true);
        try {
            const small = await downscaleImage(file);
            if (!navigator.onLine) {
                await enqueuePhoto(container.id, small);
                flash('Photo saved — will analyze when back online.');
                return;
            }
            const { detected } = await api.uploadPhoto(container.id, small);
            setSuggestions(detected.length ? detected : []);
            if (!detected.length) flash('No items detected — add them manually.');
            await load();
        } catch {
            // Network died mid-upload: queue it.
            const small = await downscaleImage(file);
            await enqueuePhoto(container.id, small);
            flash('Photo queued for upload.');
        } finally {
            setBusy(false);
        }
    }

    async function confirmSuggestion(s: DetectedItem, accept: boolean) {
        if (!container) return;
        setSuggestions((prev) => prev?.filter((x) => x !== s) ?? null);
        if (!accept) return;
        const input = { name: s.name, description: s.description ?? '', quantity: s.quantity || 1, tags: [] };
        try {
            if (!navigator.onLine) {
                await enqueue({ kind: 'addItem', containerId: container.id, input });
            } else {
                await api.addItem(container.id, input);
            }
            await load();
        } catch {
            await enqueue({ kind: 'addItem', containerId: container.id, input });
            flash('Saved offline.');
        }
    }

    async function removePhoto(photoId: string) {
        if (!window.confirm('Delete this photo?')) return;
        try {
            await api.deletePhoto(photoId);
            await load();
        } catch {
            flash('Could not delete photo — try again when online.');
        }
    }

    if (loading) return <Spinner />;
    if (!container) return <div className="center">Container not found.</div>;

    return (
        <div>
            <div className="spread container-head">
                {editing ? (
                    <HeaderEditor
                        container={container}
                        locations={locations}
                        owners={owners}
                        flash={flash}
                        onDone={async (saved) => {
                            setEditing(false);
                            if (saved) await load();
                        }}
                    />
                ) : (
                    <>
                        <div>
                            <div className="title-row">
                                <h1>
                                    #{container.number} · {container.name}
                                </h1>
                                <button className="ghost small icon-btn" onClick={() => setEditing(true)} title="Edit">
                                    <Icon name="pencil" size={16} />
                                </button>
                            </div>
                            {(container.location || container.owner) && (
                                <div className="muted meta-line">
                                    {container.owner && (
                                        <span>
                                            <Icon name="user" size={14} /> {container.owner}
                                        </span>
                                    )}
                                    {container.location && (
                                        <span>
                                            <Icon name="pin" size={14} /> {container.location}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                        {qr && (
                            <div className="stack qr-head-block">
                                <img className="qr-img qr-head" src={qr} alt="container QR" />
                                <button
                                    className="small ghost"
                                    onClick={() =>
                                        printLabel({ number: container.number, name: container.name, qrDataUrl: qr })
                                    }
                                >
                                    <Icon name="printer" size={16} /> Print label
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* AI suggestion review */}
            {suggestions && suggestions.length > 0 && (
                <div className="card" style={{ marginTop: 14 }}>
                    <h2 style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="sparkles" size={18} /> Detected items — confirm to add
                    </h2>
                    {suggestions.map((s, i) => (
                        <div key={i} className="item-row">
                            <div className="grow">
                                <strong>{s.name}</strong>
                                {s.description && <div className="muted">{s.description}</div>}
                            </div>
                            <button className="small" onClick={() => confirmSuggestion(s, true)}>
                                <Icon name="check" size={16} /> Add
                            </button>
                            <button className="small ghost" onClick={() => confirmSuggestion(s, false)}>
                                Skip
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="row" style={{ marginTop: 14 }}>
                <button onClick={() => fileRef.current?.click()} disabled={busy}>
                    <Icon name="camera" size={18} />
                    {busy ? 'Analyzing…' : 'Photo → detect items'}
                </button>
                <input
                    ref={fileRef}
                    className="fab-input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={onPhoto}
                />
            </div>

            <ItemsEditor container={container} categories={categories} onChange={load} flash={flash} />

            {container.photos.length > 0 && (
                <>
                    <h2>Photos</h2>
                    <div className="thumbs">
                        {container.photos.map((p) => (
                            <div key={p.id} className="thumb">
                                <a href={p.blobUrl} target="_blank" rel="noreferrer">
                                    <img src={p.thumbUrl} alt="container contents" />
                                </a>
                                <button
                                    className="danger small icon-btn thumb-del"
                                    onClick={() => removePhoto(p.id)}
                                    title="Delete photo"
                                    aria-label="Delete photo"
                                >
                                    <Icon name="trash" size={15} />
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            <h2>Manage</h2>
            <div className="row">
                <button
                    className="danger small"
                    onClick={async () => {
                        if (!confirm(`Delete container #${container.number} and all its items?`)) return;
                        await api.deleteContainer(container.id);
                        nav('/containers');
                    }}
                >
                    <Icon name="trash" size={16} /> Delete container
                </button>
                <button className="ghost small" onClick={() => void syncNow().then(() => flash('Synced.'))}>
                    <Icon name="sync" size={16} /> Sync now
                </button>
            </div>

            {toast && <div className="toast">{toast}</div>}
        </div>
    );
}

function ItemsEditor({
    container,
    categories,
    onChange,
    flash,
}: {
    container: ContainerWithContents;
    categories: Lookup[];
    onChange: () => Promise<void>;
    flash: (m: string) => void;
}) {
    const [newName, setNewName] = useState('');
    const [others, setOthers] = useState<Container[]>([]);
    const othersLoaded = useRef(false);

    // The move-target list is only needed once the user edits an item, so defer
    // the (full) container-list fetch until then instead of on every page open.
    const ensureOthers = useCallback(() => {
        if (othersLoaded.current) return;
        othersLoaded.current = true;
        api.listContainers()
            .then((cs) => setOthers(cs.filter((c) => c.id !== container.id)))
            .catch(() => {
                othersLoaded.current = false;
            });
    }, [container.id]);

    async function add() {
        if (!newName.trim()) return;
        const input = { name: newName.trim(), description: '', quantity: 1, tags: [] };
        setNewName('');
        try {
            if (!navigator.onLine) await enqueue({ kind: 'addItem', containerId: container.id, input });
            else await api.addItem(container.id, input);
            await onChange();
        } catch {
            await enqueue({ kind: 'addItem', containerId: container.id, input });
            flash('Saved offline.');
        }
    }

    return (
        <>
            <h2>Contents ({container.items.length})</h2>
            <div className="stack">
                {container.items.map((it) => (
                    <ItemRow
                        key={it.id}
                        item={it}
                        others={others}
                        categories={categories}
                        onChange={onChange}
                        onEdit={ensureOthers}
                        flash={flash}
                    />
                ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
                <input
                    placeholder="Add an item…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && add()}
                />
                <button className="small" onClick={add}>
                    Add
                </button>
            </div>
        </>
    );
}

function ItemRow({
    item,
    others,
    categories,
    onChange,
    onEdit,
    flash,
}: {
    item: Item;
    others: Container[];
    categories: Lookup[];
    onChange: () => Promise<void>;
    onEdit: () => void;
    flash: (m: string) => void;
}) {
    const [qty, setQty] = useState(item.quantity);
    const [name, setName] = useState(item.name);
    const [description, setDescription] = useState(item.description ?? '');
    const [editing, setEditing] = useState(false);

    async function save(
        next: Partial<{ quantity: number; name: string; description: string; categoryId: string | null }>,
    ) {
        const input = {
            name: (next.name ?? name).trim() || item.name,
            description: next.description !== undefined ? next.description : (item.description ?? ''),
            quantity: next.quantity ?? qty,
            tags: item.tags,
            categoryId: next.categoryId !== undefined ? next.categoryId : (item.categoryId ?? null),
        };
        try {
            if (!navigator.onLine) await enqueue({ kind: 'updateItem', itemId: item.id, input });
            else await api.updateItem(item.id, input);
            await onChange();
        } catch {
            await enqueue({ kind: 'updateItem', itemId: item.id, input });
            flash('Saved offline.');
        }
    }

    async function remove() {
        try {
            if (!navigator.onLine) await enqueue({ kind: 'deleteItem', itemId: item.id });
            else await api.deleteItem(item.id);
            await onChange();
        } catch {
            await enqueue({ kind: 'deleteItem', itemId: item.id });
            flash('Removed offline.');
        }
    }

    async function move(targetContainerId: string) {
        if (!targetContainerId) return;
        try {
            if (!navigator.onLine) await enqueue({ kind: 'moveItem', itemId: item.id, targetContainerId });
            else await api.moveItem(item.id, targetContainerId);
            await onChange();
        } catch {
            await enqueue({ kind: 'moveItem', itemId: item.id, targetContainerId });
            flash('Moved offline.');
        }
    }

    return (
        <div className="item-row">
            {editing ? (
                <input
                    className="qty"
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    onBlur={() => qty !== item.quantity && save({ quantity: qty })}
                />
            ) : (
                <span className="qty-view muted">×{item.quantity}</span>
            )}
            <div className="grow">
                {editing ? (
                    <>
                        <input
                            className="item-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onBlur={() => name.trim() && name.trim() !== item.name && save({ name: name.trim() })}
                            placeholder="Item name"
                        />
                        <input
                            className="item-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            onBlur={() => description !== (item.description ?? '') && save({ description })}
                            placeholder="Description"
                        />
                    </>
                ) : (
                    <>
                        <strong>{item.name}</strong>
                        {item.description && <div className="muted">{item.description}</div>}
                    </>
                )}
            </div>
            {editing ? (
                <>
                    <Select
                        value={item.categoryId ?? ''}
                        onChange={(v) => save({ categoryId: v || null })}
                        ariaLabel="Category"
                        auto
                        options={[
                            { value: '', label: 'No category' },
                            ...categories.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                    />
                    <Select
                        value=""
                        onChange={(v) => move(v)}
                        ariaLabel="Move to…"
                        auto
                        options={[
                            { value: '', label: 'Move…', disabled: true },
                            ...others.map((c) => ({ value: c.id, label: `#${c.number} ${c.name}` })),
                        ]}
                    />
                </>
            ) : (
                <span className="cat-col">{item.category && <span className="cat-pill">{item.category}</span>}</span>
            )}
            {editing && (
                <button className="danger small icon-btn" onClick={remove} title="Remove">
                    <Icon name="close" size={16} />
                </button>
            )}
            <button
                className="ghost small icon-btn"
                onClick={() => {
                    const next = !editing;
                    setEditing(next);
                    if (next) onEdit();
                }}
                title={editing ? 'Done' : 'Edit'}
            >
                <Icon name={editing ? 'check' : 'pencil'} size={16} />
            </button>
        </div>
    );
}

function HeaderEditor({
    container,
    locations,
    owners,
    flash,
    onDone,
}: {
    container: ContainerWithContents;
    locations: Lookup[];
    owners: Lookup[];
    flash: (m: string) => void;
    onDone: (saved: boolean) => Promise<void>;
}) {
    const [name, setName] = useState(container.name);
    const [locationId, setLocationId] = useState(container.locationId ?? '');
    const [ownerId, setOwnerId] = useState(container.ownerId ?? '');
    const [saving, setSaving] = useState(false);

    async function save() {
        if (!name.trim() || saving) return;
        setSaving(true);
        try {
            await api.updateContainer(container.id, {
                name: name.trim(),
                locationId: locationId || null,
                ownerId: ownerId || null,
                notes: container.notes ?? '',
            });
            await onDone(true);
        } catch {
            flash('Could not save — are you online?');
            setSaving(false);
        }
    }

    return (
        <div className="grow stack header-editor">
            <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label>
                Location
                <Select
                    value={locationId}
                    onChange={setLocationId}
                    ariaLabel="Location"
                    options={[
                        { value: '', label: '— none —' },
                        ...locations.map((l) => ({ value: l.id, label: l.name })),
                    ]}
                />
            </label>
            <label>
                Owner
                <Select
                    value={ownerId}
                    onChange={setOwnerId}
                    ariaLabel="Owner"
                    options={[{ value: '', label: '— none —' }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
                />
            </label>
            <div className="row">
                <button className="small" onClick={save} disabled={saving || !name.trim()}>
                    <Icon name="check" size={16} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="small ghost" onClick={() => void onDone(false)} disabled={saving}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
