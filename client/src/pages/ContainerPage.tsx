import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { getContainersCached } from '../containersCache';
import {
    enqueue,
    enqueuePhoto,
    syncNow,
    getPendingSuggestions,
    removePendingSuggestion,
    getCachedContainer,
    pendingForContainer,
} from '../db';
import { downscaleImage } from '../image';
import { makeQrDataUrl, printLabel } from '../qr';
import { Icon } from '../Icon';
import { ClearableInput } from '../ClearableInput';
import { Select } from '../Select';
import { Menu } from '../Menu';
import { Spinner } from '../Spinner';
import { useConfirm, usePrompt } from '../Dialog';
import { getLookup, invalidateLookups } from '../lookups';
import { usePersistentToggle } from '../usePersistentToggle';
import type { Container, ContainerWithContents, DetectedItem, Item, Lookup } from '../types';

// Normalize an item name/description: trim and uppercase the very first letter.
function capitalizeFirst(s: string): string {
    const t = s.trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function fmtDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// Standard option list for a category <Select>: none, the categories, and a
// "+ New category…" sentinel.
function categoryOptions(categories: Lookup[]) {
    return [
        { value: '', label: 'No category' },
        ...categories.map((c) => ({ value: c.id, label: c.name })),
        { value: '__new__', label: '+ New category…' },
    ];
}

// Inline "type a new category name" row (text input + confirm/cancel), shared by
// the add-item modal and an item's edit row.
function NewCategoryInput({ onConfirm, onCancel }: { onConfirm: (name: string) => void; onCancel: () => void }) {
    const [value, setValue] = useState('');
    return (
        <span className="new-cat-row">
            <input
                className="new-cat-input"
                value={value}
                autoFocus
                placeholder="New category"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        onConfirm(value);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onCancel();
                    }
                }}
            />
            <button type="button" className="small icon-btn" onClick={() => onConfirm(value)} title="Add category">
                <Icon name="check" size={16} />
            </button>
            <button type="button" className="ghost small icon-btn" onClick={onCancel} title="Cancel">
                <Icon name="close" size={16} />
            </button>
        </span>
    );
}

export default function ContainerPage({ byToken = false }: { byToken?: boolean }) {
    const params = useParams();
    const nav = useNavigate();
    const key = byToken ? params.token! : params.id!;

    const [container, setContainer] = useState<ContainerWithContents | null>(null);
    const [loading, setLoading] = useState(true);
    const [qr, setQr] = useState<string>('');
    const [toast, setToast] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<DetectedItem[] | null>(null);
    // Category chosen (in the detection review list) for each detected item,
    // keyed by the suggestion's object reference.
    const [suggestionCats, setSuggestionCats] = useState<Map<DetectedItem, string>>(new Map());
    // In-place edits to a detected item's name/description before it's added,
    // keyed by the suggestion's object reference.
    const [suggestionEdits, setSuggestionEdits] = useState<Map<DetectedItem, { name?: string; description?: string }>>(
        new Map()
    );
    const [busy, setBusy] = useState(false);
    const [pendingWork, setPendingWork] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);
    // Remembers whether the next picked photo should be AI-analyzed; set by the
    // button that opens the file picker.
    const analyzeOnUpload = useRef(true);
    const [editing, setEditing] = useState(false);
    const [photosEditing, setPhotosEditing] = useState(false);
    // Staged photo edits while editing; applied only when the check is pressed.
    const [photoMoves, setPhotoMoves] = useState<Map<string, string>>(new Map());
    const [photoDeletes, setPhotoDeletes] = useState<Set<string>>(new Set());
    // Staged rotation per photo, in degrees (cumulative, mod 360).
    const [photoRotations, setPhotoRotations] = useState<Map<string, number>>(new Map());
    const [locations, setLocations] = useState<Lookup[]>([]);
    const [owners, setOwners] = useState<Lookup[]>([]);
    const [categories, setCategories] = useState<Lookup[]>([]);
    // Other containers, fetched lazily so photos can be moved between them.
    const [otherContainers, setOtherContainers] = useState<Container[]>([]);
    const otherContainersLoaded = useRef(false);
    // Previous/next container for the same owner (by number), for quick nav.
    const [siblings, setSiblings] = useState<{ prev: Container | null; next: Container | null }>({
        prev: null,
        next: null,
    });
    const confirm = useConfirm();
    const prompt = usePrompt();

    // `silent` refreshes (after add/edit/skip) keep the current view rendered
    // instead of swapping to the full-page spinner, which looked like a reload.
    const load = useCallback(
        async (silent = false) => {
            if (!silent) setLoading(true);
            try {
                const c = byToken ? await api.getContainerByToken(key) : await api.getContainer(key);
                setContainer(c);
                setQr(await makeQrDataUrl(c.qrToken));
            } catch {
                // Offline fallback: show the cached container (e.g. one just created
                // offline) with whatever it has so far; items/photos sync later.
                const cached = byToken ? undefined : await getCachedContainer(key);
                if (cached) {
                    setContainer({ ...cached, items: [], photos: [] });
                    setQr(await makeQrDataUrl(cached.qrToken));
                } else if (!silent) setContainer(null);
            } finally {
                if (!silent) setLoading(false);
            }
        },
        [byToken, key]
    );

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

    // Fetch the list of other containers once (for the "Move photo to…" picker)
    // when the container has photos.
    useEffect(() => {
        if (!container || container.photos.length === 0 || otherContainersLoaded.current) return;
        otherContainersLoaded.current = true;
        void getContainersCached()
            .then((cs) => setOtherContainers(cs.filter((c) => c.id !== container.id)))
            .catch(() => {
                otherContainersLoaded.current = false;
            });
    }, [container]);

    function flash(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2200);
    }

    // Find the previous/next container for the same owner (ordered by number)
    // so the header can offer quick sequential navigation.
    useEffect(() => {
        if (!container || byToken) return;
        let cancelled = false;
        void getContainersCached()
            .then((cs) => {
                if (cancelled) return;
                const sameOwner = cs
                    .filter((c) => (c.ownerId ?? '') === (container.ownerId ?? ''))
                    .sort((a, b) => a.number - b.number);
                const i = sameOwner.findIndex((c) => c.id === container.id);
                setSiblings({
                    prev: i > 0 ? sameOwner[i - 1] : null,
                    next: i >= 0 && i < sameOwner.length - 1 ? sameOwner[i + 1] : null,
                });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [container, byToken]);

    // Merge in any AI suggestions that were detected from photos uploaded during
    // sync (i.e. attached while offline). They live in IndexedDB until the user
    // confirms or skips each one, so they survive navigating away and back.
    const loadPendingSuggestions = useCallback(async (containerId: string, announce = false) => {
        const pending = await getPendingSuggestions(containerId);
        if (!pending.length) return;
        let added = 0;
        setSuggestions((prev) => {
            const existing = prev ?? [];
            const keyOf = (s: DetectedItem) => `${s.name}|${s.description ?? ''}|${s.quantity}`;
            const have = new Set(existing.map(keyOf));
            const additions = pending.filter((s) => !have.has(keyOf(s)));
            added = additions.length;
            return additions.length ? [...existing, ...additions] : existing;
        });
        if (announce && added) flash('AI found items in a synced photo — review below.');
    }, []);

    // Pull stored suggestions once the container id is known, and react to fresh
    // ones arriving from a sync while this page is open.
    useEffect(() => {
        const id = container?.id;
        if (!id) return;
        void loadPendingSuggestions(id);
        const onReady = (e: Event) => {
            const detail = (e as CustomEvent).detail as { containerId?: string } | undefined;
            if (detail?.containerId === id) void loadPendingSuggestions(id, true);
        };
        window.addEventListener('suggestions-ready', onReady);
        return () => window.removeEventListener('suggestions-ready', onReady);
    }, [container?.id, loadPendingSuggestions]);

    // Track queued offline work for this container (e.g. a photo awaiting upload/
    // detection) so we can show a clear "pending" badge until it syncs.
    useEffect(() => {
        const id = container?.id;
        if (!id) return;
        const isTemp = key.startsWith('temp-');
        const onChange = () => {
            void pendingForContainer(id).then(setPendingWork);
            // A container created offline lives under a temp id; once it syncs the
            // temp record is replaced by the real one, so this page can no longer
            // resolve. Bounce back to the list rather than stranding a 404.
            if (isTemp)
                void getCachedContainer(key).then((c) => {
                    if (!c) nav('/containers', { replace: true });
                });
        };
        onChange();
        window.addEventListener('pending-changed', onChange);
        return () => window.removeEventListener('pending-changed', onChange);
    }, [container?.id, key, nav]);

    // Create a category inline (from an item's category picker) and refresh the list.
    const addCategory = useCallback(async (name: string): Promise<Lookup | null> => {
        try {
            const created = await api.createLookup('categories', name);
            invalidateLookups('categories');
            const cats = await getLookup('categories').catch(() => null);
            setCategories(cats ?? ((prev) => prev));
            return created;
        } catch {
            return null;
        }
    }, []);

    async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !container) return;
        const analyze = analyzeOnUpload.current;
        analyzeOnUpload.current = true; // reset to default for next time
        setBusy(true);
        // One stable idempotency key per photo action, reused across the online attempt
        // and any offline enqueue, so a retried/replayed upload can't duplicate (#10).
        const photoMutationId = crypto.randomUUID();
        try {
            const small = await downscaleImage(file);
            if (!navigator.onLine) {
                await enqueuePhoto(container.id, small, analyze, photoMutationId);
                flash(
                    analyze
                        ? 'Photo saved — will analyze when back online.'
                        : 'Photo saved — will upload when back online.'
                );
                return;
            }
            if (analyze) {
                const { detected } = await api.uploadPhoto(container.id, small, true, photoMutationId);
                setSuggestions(detected.length ? detected : []);
                if (!detected.length) flash('No items detected — add them manually.');
            } else {
                await api.uploadPhoto(container.id, small, false, photoMutationId);
                flash('Photo added.');
            }
            await load(true);
        } catch (e) {
            // Network died mid-upload: queue it under the same id so a partially-applied
            // online attempt is deduped on replay.
            const small = await downscaleImage(file);
            await enqueuePhoto(container.id, small, analyze, photoMutationId);
            // A server that answered with an error is not an offline situation, so name
            // the failure instead of implying the photo is only waiting on connectivity.
            flash(
                e instanceof ApiError
                    ? `Upload failed (${e.status}). Photo saved and will retry.`
                    : 'Photo queued for upload.'
            );
        } finally {
            setBusy(false);
        }
    }

    async function confirmSuggestion(s: DetectedItem, accept: boolean) {
        if (!container) return;
        const categoryId = suggestionCats.get(s) || null;
        const edit = suggestionEdits.get(s);
        setSuggestions((prev) => prev?.filter((x) => x !== s) ?? null);
        setSuggestionCats((m) => {
            if (!m.has(s)) return m;
            const next = new Map(m);
            next.delete(s);
            return next;
        });
        setSuggestionEdits((m) => {
            if (!m.has(s)) return m;
            const next = new Map(m);
            next.delete(s);
            return next;
        });
        // Drop it from the durable offline store too (no-op for online suggestions).
        void removePendingSuggestion(container.id, s);
        if (!accept) return;
        const input = {
            name: capitalizeFirst(edit?.name ?? s.name) || s.name,
            description: capitalizeFirst(edit?.description ?? s.description ?? ''),
            quantity: s.quantity || 1,
            tags: [],
            categoryId,
        };
        try {
            if (!navigator.onLine) {
                await enqueue({ kind: 'addItem', containerId: container.id, input });
            } else {
                await api.addItem(container.id, input);
            }
            await load(true);
        } catch {
            await enqueue({ kind: 'addItem', containerId: container.id, input });
            flash('Saved offline.');
        }
    }

    async function pickSuggestionCategory(s: DetectedItem, v: string) {
        if (v === '__new__') {
            const name = (await prompt({ title: 'New category', label: 'Category name', confirmLabel: 'Add' }))?.trim();
            if (!name) return;
            const created = await addCategory(name);
            if (created) setSuggestionCats((m) => new Map(m).set(s, created.id));
            return;
        }
        setSuggestionCats((m) => {
            const next = new Map(m);
            if (v) next.set(s, v);
            else next.delete(s);
            return next;
        });
    }

    function editSuggestion(s: DetectedItem, patch: { name?: string; description?: string }) {
        setSuggestionEdits((m) => {
            const next = new Map(m);
            next.set(s, { ...(next.get(s) ?? {}), ...patch });
            return next;
        });
    }

    // Clear all staged photo edits (rotations, moves, deletes).
    function resetPhotoEdits() {
        setPhotoMoves(new Map());
        setPhotoDeletes(new Set());
        setPhotoRotations(new Map());
    }

    function stageRotate(photoId: string) {
        setPhotoRotations((cur) => {
            const next = new Map(cur);
            next.set(photoId, ((next.get(photoId) ?? 0) + 90) % 360);
            return next;
        });
    }

    // Begin a photo edit session: changes (rotates + moves + deletes) are staged
    // and only sent when the check is pressed.
    function startPhotosEditing() {
        resetPhotoEdits();
        setPhotosEditing(true);
    }

    function toggleDelete(photoId: string) {
        setPhotoDeletes((cur) => {
            const next = new Set(cur);
            if (next.has(photoId)) next.delete(photoId);
            else next.add(photoId);
            return next;
        });
    }

    function stageMove(photoId: string, targetContainerId: string) {
        setPhotoMoves((cur) => {
            const next = new Map(cur);
            if (targetContainerId) next.set(photoId, targetContainerId);
            else next.delete(photoId);
            return next;
        });
    }

    async function savePhotoEdits() {
        const deletes = [...photoDeletes];
        const moves = [...photoMoves].filter(([id]) => !photoDeletes.has(id));
        const rotations = [...photoRotations].filter(([id, deg]) => deg > 0 && !photoDeletes.has(id));
        if (deletes.length === 0 && moves.length === 0 && rotations.length === 0) {
            setPhotosEditing(false);
            return;
        }
        try {
            for (const [id, deg] of rotations) await api.rotatePhoto(id, deg);
            for (const id of deletes) await api.deletePhoto(id);
            for (const [id, target] of moves) await api.movePhoto(id, target);
            await load(true);
            flash('Photo changes saved.');
        } catch {
            for (const [id, deg] of rotations) await enqueue({ kind: 'rotatePhoto', photoId: id, degrees: deg });
            for (const id of deletes) await enqueue({ kind: 'deletePhoto', photoId: id });
            for (const [id, target] of moves)
                await enqueue({ kind: 'movePhoto', photoId: id, targetContainerId: target });
            flash('Changes queued — will apply when online.');
        }
        resetPhotoEdits();
        setPhotosEditing(false);
    }

    function cancelPhotoEdits() {
        resetPhotoEdits();
        setPhotosEditing(false);
    }

    if (loading) return <Spinner />;
    if (!container) return <div className="center">Container not found.</div>;

    return (
        <div>
            {pendingWork > 0 && (
                <span className="card-pill sync pending-pill">
                    <Icon name="cloud" size={13} /> {pendingWork} change{pendingWork === 1 ? '' : 's'} pending sync
                </span>
            )}
            <div className="spread container-head">
                {editing ? (
                    <HeaderEditor
                        container={container}
                        locations={locations}
                        owners={owners}
                        flash={flash}
                        onDone={async (saved) => {
                            setEditing(false);
                            if (saved) await load(true);
                        }}
                    />
                ) : (
                    <div className="head-grid">
                        <div className="title-row">
                            <h1>
                                #{container.number} · {container.name}
                            </h1>
                            <div className="title-nav">
                                <button
                                    className="ghost small icon-btn nav-arrow"
                                    onClick={() => siblings.prev && nav(`/containers/${siblings.prev.id}`)}
                                    disabled={!siblings.prev}
                                    title={
                                        siblings.prev
                                            ? `#${siblings.prev.number} ${siblings.prev.name}`
                                            : 'No earlier container'
                                    }
                                    aria-label="Previous container"
                                >
                                    <Icon name="arrow-left" size={16} />
                                </button>
                                <button className="ghost small icon-btn" onClick={() => setEditing(true)} title="Edit">
                                    <Icon name="pencil" size={16} />
                                </button>
                                <button
                                    className="ghost small icon-btn nav-arrow"
                                    onClick={() => siblings.next && nav(`/containers/${siblings.next.id}`)}
                                    disabled={!siblings.next}
                                    title={
                                        siblings.next
                                            ? `#${siblings.next.number} ${siblings.next.name}`
                                            : 'No later container'
                                    }
                                    aria-label="Next container"
                                >
                                    <Icon name="arrow-right" size={16} />
                                </button>
                            </div>
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
                        <div className="row container-actions">
                            <Menu
                                icon="camera"
                                label={busy ? 'Working…' : 'Photos'}
                                disabled={busy}
                                items={[
                                    {
                                        title: 'Detect Items',
                                        description: 'Photo → AI finds items',
                                        icon: 'sparkles',
                                        onSelect: () => {
                                            analyzeOnUpload.current = true;
                                            fileRef.current?.click();
                                        },
                                    },
                                    {
                                        title: 'Photo Only',
                                        description: 'Attach without detection',
                                        icon: 'camera',
                                        onSelect: () => {
                                            analyzeOnUpload.current = false;
                                            fileRef.current?.click();
                                        },
                                    },
                                ]}
                            />
                            <input
                                ref={fileRef}
                                className="fab-input"
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={onPhoto}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* AI suggestion review */}
            {suggestions && suggestions.length > 0 && (
                <div className="card sug-card">
                    <h2 className="sug-card-title">
                        <Icon name="sparkles" size={18} /> Detected items — confirm to add
                    </h2>
                    {suggestions.map((s, i) => (
                        <div key={i} className="item-row sug-row">
                            <div className="grow">
                                <input
                                    className="item-name"
                                    value={suggestionEdits.get(s)?.name ?? s.name}
                                    onChange={(e) => editSuggestion(s, { name: e.target.value })}
                                    placeholder="Item name"
                                    aria-label="Item name"
                                />
                                <input
                                    className="item-desc"
                                    value={suggestionEdits.get(s)?.description ?? s.description ?? ''}
                                    onChange={(e) => editSuggestion(s, { description: e.target.value })}
                                    placeholder="Description (optional)"
                                    aria-label="Item description"
                                />
                            </div>
                            <div className="sug-actions">
                                <Select
                                    value={suggestionCats.get(s) ?? ''}
                                    onChange={(v) => void pickSuggestionCategory(s, v)}
                                    ariaLabel="Category"
                                    auto
                                    options={categoryOptions(categories)}
                                />
                                <button className="small" onClick={() => confirmSuggestion(s, true)}>
                                    <Icon name="check" size={16} /> Add
                                </button>
                                <button className="small ghost" onClick={() => confirmSuggestion(s, false)}>
                                    Skip
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ItemsEditor
                container={container}
                categories={categories}
                onChange={() => load(true)}
                onAddCategory={addCategory}
                flash={flash}
            />

            {container.photos.length > 0 && (
                <>
                    <hr className="qr-divider" />
                    <div className="section-head">
                        <h2>Photos</h2>
                        <span className="item-actions">
                            {photosEditing && (
                                <button
                                    className="ghost small icon-btn"
                                    onClick={cancelPhotoEdits}
                                    title="Cancel"
                                    aria-label="Cancel"
                                >
                                    <Icon name="close" size={14} />
                                </button>
                            )}
                            <button
                                className={`ghost small icon-btn${photosEditing ? ' ok' : ''}`}
                                onClick={() => (photosEditing ? void savePhotoEdits() : startPhotosEditing())}
                                title={photosEditing ? 'Done' : 'Edit photos'}
                            >
                                <Icon name={photosEditing ? 'check' : 'pencil'} size={14} />
                            </button>
                        </span>
                    </div>
                    <div className="thumbs">
                        {container.photos.map((p) => (
                            <div key={p.id} className={`thumb${photoDeletes.has(p.id) ? ' staged-del' : ''}`}>
                                <a href={p.blobUrl} target="_blank" rel="noreferrer">
                                    <img
                                        src={p.thumbUrl}
                                        alt="container contents"
                                        decoding="async"
                                        style={{ transform: `rotate(${photoRotations.get(p.id) ?? 0}deg)` }}
                                        ref={(el) => {
                                            if (el?.complete) el.classList.add('loaded');
                                        }}
                                        onLoad={(e) => e.currentTarget.classList.add('loaded')}
                                    />
                                </a>
                                {photosEditing && (
                                    <>
                                        <button
                                            className="ghost small thumb-rotate"
                                            onClick={() => stageRotate(p.id)}
                                            title="Rotate 90°"
                                            aria-label="Rotate photo 90 degrees"
                                        >
                                            <Icon name="rotate-cw" size={15} />
                                        </button>
                                        <Select
                                            className="thumb-move"
                                            value={photoMoves.get(p.id) ?? ''}
                                            onChange={(v) => stageMove(p.id, v)}
                                            ariaLabel="Move photo to…"
                                            options={[
                                                { value: '', label: 'Move…', disabled: true },
                                                ...otherContainers.map((c) => ({
                                                    value: c.id,
                                                    label: `#${c.number} ${c.name}`,
                                                })),
                                            ]}
                                        />
                                        <button
                                            className="danger small thumb-del"
                                            onClick={() => toggleDelete(p.id)}
                                            title={photoDeletes.has(p.id) ? 'Undo delete' : 'Delete photo'}
                                            aria-label={photoDeletes.has(p.id) ? 'Undo delete' : 'Delete photo'}
                                        >
                                            <Icon name={photoDeletes.has(p.id) ? 'rotate-cw' : 'trash'} size={15} />
                                            <span className="thumb-del-label">
                                                {photoDeletes.has(p.id) ? 'Undo' : 'Delete'}
                                            </span>
                                        </button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            <hr className="qr-divider" />
            <div className="section-head">
                <h2>Manage</h2>
            </div>
            <div className="row">
                <button
                    className="danger small"
                    onClick={async () => {
                        const ok = await confirm({
                            title: 'Delete container',
                            message: `Delete container #${container.number} and all its items?`,
                            confirmLabel: 'Delete',
                            danger: true,
                        });
                        if (!ok) return;
                        await api.deleteContainer(container.id);
                        nav('/containers');
                    }}
                >
                    <Icon name="trash" size={16} /> Delete container
                </button>
                {pendingWork > 0 && (
                    <button
                        className="ghost small"
                        onClick={() =>
                            void syncNow().then((r) =>
                                flash(r.failed > 0 ? 'Sync incomplete — will retry.' : 'Synced.')
                            )
                        }
                    >
                        <Icon name="sync" size={16} /> Sync now
                    </button>
                )}
            </div>

            {qr && (
                <>
                    <hr className="qr-divider" />
                    <div className="section-head">
                        <h2>QR Code</h2>
                    </div>
                    <div className="stack qr-foot-block">
                        <img className="qr-img qr-foot" src={qr} alt="container QR" />
                        <button
                            className="small ghost"
                            onClick={() =>
                                printLabel({ number: container.number, name: container.name, qrDataUrl: qr })
                            }
                        >
                            <Icon name="printer" size={16} /> Print label
                        </button>
                    </div>
                </>
            )}

            {toast && <div className="toast">{toast}</div>}
        </div>
    );
}

function ItemsEditor({
    container,
    categories,
    onChange,
    onAddCategory,
    flash,
}: {
    container: ContainerWithContents;
    categories: Lookup[];
    onChange: () => Promise<void>;
    onAddCategory: (name: string) => Promise<Lookup | null>;
    flash: (m: string) => void;
}) {
    const [adding, setAdding] = useState(false);
    const [others, setOthers] = useState<Container[]>([]);
    const othersLoaded = useRef(false);
    // Contents are collapsed by default to keep the container page compact;
    // the open/closed choice is remembered per container across reloads.
    const [contentsOpen, setContentsOpen] = usePersistentToggle(`webinv.container.${container.id}.contentsOpen`, false);

    // The move-target list is only needed once the user edits an item, so defer
    // the (full) container-list fetch until then instead of on every page open.
    const ensureOthers = useCallback(() => {
        if (othersLoaded.current) return;
        othersLoaded.current = true;
        getContainersCached()
            .then((cs) => setOthers(cs.filter((c) => c.id !== container.id)))
            .catch(() => {
                othersLoaded.current = false;
            });
    }, [container.id]);

    return (
        <>
            <button
                type="button"
                className="collapse-toggle contents-toggle"
                aria-expanded={contentsOpen}
                onClick={() => setContentsOpen((v) => !v)}
            >
                <span>Contents ({container.items.length})</span>
                <Icon name="chevron" size={16} className={`collapse-chevron${contentsOpen ? ' open' : ''}`} />
            </button>
            {contentsOpen && (
                <>
                    <div className="stack contents-list">
                        {container.items.map((it) => (
                            <ItemRow
                                key={it.id}
                                item={it}
                                others={others}
                                categories={categories}
                                onChange={onChange}
                                onEdit={ensureOthers}
                                onAddCategory={onAddCategory}
                                flash={flash}
                            />
                        ))}
                    </div>
                    <div className="row contents-add">
                        <button className="small" onClick={() => setAdding(true)}>
                            <Icon name="plus" size={16} /> Add an item
                        </button>
                    </div>
                </>
            )}
            {adding && (
                <AddItemModal
                    container={container}
                    categories={categories}
                    onAddCategory={onAddCategory}
                    flash={flash}
                    onClose={async (saved) => {
                        setAdding(false);
                        if (saved) await onChange();
                    }}
                />
            )}
        </>
    );
}

function AddItemModal({
    container,
    categories,
    onAddCategory,
    flash,
    onClose,
}: {
    container: ContainerWithContents;
    categories: Lookup[];
    onAddCategory: (name: string) => Promise<Lookup | null>;
    flash: (m: string) => void;
    onClose: (saved: boolean) => void;
}) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [categoryId, setCategoryId] = useState('');
    const [addingCat, setAddingCat] = useState(false);
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoUrl, setPhotoUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        nameRef.current?.focus();
    }, []);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            // Open dropdowns consume Escape first; only an unhandled Escape closes the modal.
            if (e.key === 'Escape' && !e.defaultPrevented) onClose(false);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Free the preview object URL when it changes / on unmount.
    useEffect(
        () => () => {
            if (photoUrl) URL.revokeObjectURL(photoUrl);
        },
        [photoUrl]
    );

    function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        setPhoto(file);
        setPhotoUrl(URL.createObjectURL(file));
    }

    function clearPhoto() {
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        setPhoto(null);
        setPhotoUrl('');
    }

    async function confirmNewCategory(name: string) {
        const n = name.trim();
        if (!n) {
            setAddingCat(false);
            return;
        }
        const created = await onAddCategory(n);
        if (created) {
            setCategoryId(created.id);
            setAddingCat(false);
        } else {
            flash('Could not add category.');
        }
    }

    async function submit() {
        if (!name.trim() || saving) return;
        setSaving(true);
        const input = {
            name: capitalizeFirst(name) || name.trim(),
            description: capitalizeFirst(description),
            quantity: quantity || 1,
            tags: [],
            categoryId: categoryId || null,
        };
        try {
            if (!navigator.onLine) await enqueue({ kind: 'addItem', containerId: container.id, input });
            else await api.addItem(container.id, input);
        } catch {
            await enqueue({ kind: 'addItem', containerId: container.id, input });
            flash('Saved offline.');
        }
        // The optional photo is attached to the container (no AI analysis — the
        // user is entering the item by hand).
        if (photo) {
            // Stable idempotency key shared by the online attempt and offline fallback (#10).
            const photoMutationId = crypto.randomUUID();
            try {
                const small = await downscaleImage(photo);
                if (!navigator.onLine) await enqueuePhoto(container.id, small, true, photoMutationId);
                else await api.uploadPhoto(container.id, small, false, photoMutationId);
            } catch {
                try {
                    const small = await downscaleImage(photo);
                    await enqueuePhoto(container.id, small, true, photoMutationId);
                    flash('Photo queued for upload.');
                } catch {
                    flash('Could not attach photo.');
                }
            }
        }
        setSaving(false);
        onClose(true);
    }

    return (
        <div className="modal-backdrop add-item-backdrop" onMouseDown={() => onClose(false)}>
            <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label="Add item"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="modal-head">
                    <h2 className="modal-title">Add item</h2>
                    <button
                        type="button"
                        className="ghost small icon-btn"
                        aria-label="Close"
                        onClick={() => onClose(false)}
                    >
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="modal-body">
                    <form
                        className="stack"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void submit();
                        }}
                    >
                        <div>
                            <label className="modal-label" htmlFor="add-item-name">
                                Name
                            </label>
                            <ClearableInput
                                id="add-item-name"
                                ref={nameRef}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onClear={() => setName('')}
                                placeholder="Item name"
                            />
                        </div>

                        <div>
                            <label className="modal-label" htmlFor="add-item-desc">
                                Description
                            </label>
                            <textarea
                                id="add-item-desc"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Optional details"
                                rows={2}
                            />
                        </div>

                        <div className="add-item-grid">
                            <div className="add-item-qty">
                                <label className="modal-label" htmlFor="add-item-qty">
                                    Qty
                                </label>
                                <input
                                    id="add-item-qty"
                                    className="qty"
                                    type="number"
                                    min={1}
                                    value={quantity}
                                    onChange={(e) => setQuantity(Number(e.target.value))}
                                />
                            </div>
                            <div className="grow">
                                <label className="modal-label">Category</label>
                                {addingCat ? (
                                    <NewCategoryInput
                                        onConfirm={(n) => void confirmNewCategory(n)}
                                        onCancel={() => setAddingCat(false)}
                                    />
                                ) : (
                                    <Select
                                        value={categoryId}
                                        onChange={(v) => {
                                            if (v === '__new__') setAddingCat(true);
                                            else setCategoryId(v);
                                        }}
                                        ariaLabel="Category"
                                        options={categoryOptions(categories)}
                                    />
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="modal-label">Photo</label>
                            {photoUrl ? (
                                <div className="add-item-photo">
                                    <img src={photoUrl} alt="item" />
                                    <div className="row">
                                        <button
                                            type="button"
                                            className="ghost small"
                                            onClick={() => fileRef.current?.click()}
                                        >
                                            <Icon name="camera" size={16} /> Retake
                                        </button>
                                        <button type="button" className="ghost small" onClick={clearPhoto}>
                                            <Icon name="close" size={16} /> Remove
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                                    <Icon name="camera" size={18} /> Take a picture
                                </button>
                            )}
                            <input
                                ref={fileRef}
                                className="fab-input"
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={pickPhoto}
                            />
                        </div>
                    </form>
                </div>

                <div className="modal-actions">
                    <button type="button" className="ghost" onClick={() => onClose(false)}>
                        Cancel
                    </button>
                    <button type="button" onClick={() => void submit()} disabled={!name.trim() || saving}>
                        {saving ? 'Saving…' : 'Add item'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ItemRow({
    item,
    others,
    categories,
    onChange,
    onEdit,
    onAddCategory,
    flash,
}: {
    item: Item;
    others: Container[];
    categories: Lookup[];
    onChange: () => Promise<void>;
    onEdit: () => void;
    onAddCategory: (name: string) => Promise<Lookup | null>;
    flash: (m: string) => void;
}) {
    const [qty, setQty] = useState(item.quantity);
    const [name, setName] = useState(item.name);
    const [description, setDescription] = useState(item.description ?? '');
    const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
    const [editing, setEditing] = useState(false);
    const [addingCat, setAddingCat] = useState(false);
    const [pendingMove, setPendingMove] = useState('');
    const confirm = useConfirm();

    function resetEdits() {
        setQty(item.quantity);
        setName(item.name);
        setDescription(item.description ?? '');
        setCategoryId(item.categoryId ?? '');
        setPendingMove('');
        setAddingCat(false);
    }

    async function commitEdits() {
        const input = {
            name: capitalizeFirst(name) || item.name,
            description: capitalizeFirst(description),
            quantity: Math.max(1, qty),
            tags: item.tags,
            categoryId: categoryId || null,
        };
        try {
            if (!navigator.onLine) await enqueue({ kind: 'updateItem', itemId: item.id, input });
            else await api.updateItem(item.id, input);
        } catch {
            await enqueue({ kind: 'updateItem', itemId: item.id, input });
            flash('Saved offline.');
        }
        if (pendingMove) await move(pendingMove);
        else await onChange();
    }

    async function remove() {
        const ok = await confirm({
            title: 'Delete item',
            message: `Delete "${item.name}"? This can't be undone.`,
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;
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

    async function confirmNewCategory(name: string) {
        const n = name.trim();
        setAddingCat(false);
        if (!n) return;
        const created = await onAddCategory(n);
        if (created) setCategoryId(created.id);
        else flash('Could not add category.');
    }

    return (
        <div className={`item-row${editing ? ' editing' : ''}`}>
            {editing ? (
                <input
                    className="qty"
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                />
            ) : (
                <span className="qty-view muted">×{item.quantity}</span>
            )}
            <div className="grow">
                {editing ? (
                    <>
                        <ClearableInput
                            className="item-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onClear={() => setName('')}
                            placeholder="Item name"
                        />
                        <input
                            className="item-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Description"
                        />
                    </>
                ) : (
                    <>
                        <strong>{item.name}</strong>
                        {item.description && <div className="muted">{item.description}</div>}
                        <div className="item-dates muted">
                            Added {fmtDate(item.createdAt)}
                            {item.updatedAt && item.updatedAt !== item.createdAt && (
                                <> · Edited {fmtDate(item.updatedAt)}</>
                            )}
                        </div>
                    </>
                )}
            </div>
            {editing ? (
                <>
                    {addingCat ? (
                        <NewCategoryInput
                            onConfirm={(n) => void confirmNewCategory(n)}
                            onCancel={() => setAddingCat(false)}
                        />
                    ) : (
                        <Select
                            value={categoryId}
                            onChange={(v) => {
                                if (v === '__new__') setAddingCat(true);
                                else setCategoryId(v);
                            }}
                            ariaLabel="Category"
                            auto
                            options={categoryOptions(categories)}
                        />
                    )}
                    <Select
                        value={pendingMove}
                        onChange={(v) => setPendingMove(v)}
                        ariaLabel="Move to…"
                        auto
                        options={[
                            { value: '', label: 'Move…' },
                            ...others.map((c) => ({ value: c.id, label: `#${c.number} ${c.name}` })),
                        ]}
                    />
                </>
            ) : (
                <span className="cat-col">{item.category && <span className="cat-pill">{item.category}</span>}</span>
            )}
            <span className="item-actions">
                {editing && (
                    <button className="danger small icon-btn" onClick={remove} title="Delete" aria-label="Delete">
                        <Icon name="trash" size={16} />
                    </button>
                )}
                {editing && (
                    <button
                        className="ghost small icon-btn"
                        onClick={() => {
                            resetEdits();
                            setEditing(false);
                        }}
                        title="Cancel"
                        aria-label="Cancel"
                    >
                        <Icon name="close" size={16} />
                    </button>
                )}
                <button
                    className={`ghost small icon-btn${editing ? ' ok' : ''}`}
                    onClick={() => {
                        if (editing) {
                            void commitEdits();
                            setEditing(false);
                        } else {
                            setEditing(true);
                            onEdit();
                        }
                    }}
                    title={editing ? 'Done' : 'Edit'}
                >
                    <Icon name={editing ? 'check' : 'pencil'} size={16} />
                </button>
            </span>
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
    const [notes, setNotes] = useState(container.notes ?? '');
    const [saving, setSaving] = useState(false);

    async function save() {
        if (!name.trim() || saving) return;
        setSaving(true);
        try {
            await api.updateContainer(container.id, {
                name: name.trim(),
                locationId: locationId || null,
                ownerId: ownerId || null,
                notes: notes.trim(),
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
                <ClearableInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onClear={() => setName('')}
                    autoFocus
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
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>
            <div className="row header-editor-actions">
                <button
                    className="ghost small icon-btn"
                    onClick={() => void onDone(false)}
                    disabled={saving}
                    title="Cancel"
                    aria-label="Cancel"
                >
                    <Icon name="close" size={16} />
                </button>
                <button
                    className="ghost small icon-btn ok"
                    onClick={save}
                    disabled={saving || !name.trim()}
                    title={saving ? 'Saving…' : 'Save'}
                    aria-label="Save"
                >
                    <Icon name="check" size={16} />
                </button>
            </div>
        </div>
    );
}
