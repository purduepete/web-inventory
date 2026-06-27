import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { enqueue, enqueuePhoto, syncNow } from '../db';
import { downscaleImage } from '../image';
import { makeQrDataUrl, printLabel } from '../qr';
import type { Container, ContainerWithContents, DetectedItem, Item } from '../types';

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

    if (loading) return <div className="center">Loading…</div>;
    if (!container) return <div className="center">Container not found.</div>;

    return (
        <div>
            <div className="spread">
                <h1>
                    #{container.number} · {container.name}
                </h1>
            </div>
            {container.location && <div className="muted">{container.location}</div>}

            {/* AI suggestion review */}
            {suggestions && suggestions.length > 0 && (
                <div className="card" style={{ marginTop: 14 }}>
                    <h2 style={{ marginTop: 0 }}>Detected items — confirm to add</h2>
                    {suggestions.map((s, i) => (
                        <div key={i} className="item-row">
                            <div className="grow">
                                <strong>{s.name}</strong>
                                {s.description && <div className="muted">{s.description}</div>}
                            </div>
                            <button className="small" onClick={() => confirmSuggestion(s, true)}>
                                Add
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
                    {busy ? 'Analyzing…' : '📷 Photo → detect items'}
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

            <ItemsEditor container={container} onChange={load} flash={flash} />

            {container.photos.length > 0 && (
                <>
                    <h2>Photos</h2>
                    <div className="thumbs">
                        {container.photos.map((p) => (
                            <a key={p.id} href={p.blobUrl} target="_blank" rel="noreferrer">
                                <img src={p.thumbUrl} alt="container contents" />
                            </a>
                        ))}
                    </div>
                </>
            )}

            <h2>Label</h2>
            <div className="row">
                {qr && <img className="qr-img" src={qr} alt="container QR" />}
                <div className="stack">
                    <button
                        className="small"
                        onClick={() => printLabel({ number: container.number, name: container.name, qrDataUrl: qr })}
                    >
                        🖨️ Print label
                    </button>
                    <span className="muted">Scan to open this container.</span>
                </div>
            </div>

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
                    Delete container
                </button>
                <button className="ghost small" onClick={() => void syncNow().then(() => flash('Synced.'))}>
                    Sync now
                </button>
            </div>

            {toast && <div className="toast">{toast}</div>}
        </div>
    );
}

function ItemsEditor({
    container,
    onChange,
    flash,
}: {
    container: ContainerWithContents;
    onChange: () => Promise<void>;
    flash: (m: string) => void;
}) {
    const [newName, setNewName] = useState('');
    const [others, setOthers] = useState<Container[]>([]);

    useEffect(() => {
        api.listContainers()
            .then((cs) => setOthers(cs.filter((c) => c.id !== container.id)))
            .catch(() => undefined);
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
                    <ItemRow key={it.id} item={it} others={others} onChange={onChange} flash={flash} />
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
    onChange,
    flash,
}: {
    item: Item;
    others: Container[];
    onChange: () => Promise<void>;
    flash: (m: string) => void;
}) {
    const [qty, setQty] = useState(item.quantity);

    async function save(next: Partial<{ quantity: number }>) {
        const input = {
            name: item.name,
            description: item.description ?? '',
            quantity: next.quantity ?? qty,
            tags: item.tags,
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
            <div className="grow">
                <strong>{item.name}</strong>
                {item.description && <div className="muted">{item.description}</div>}
            </div>
            <input
                className="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                onBlur={() => qty !== item.quantity && save({ quantity: qty })}
            />
            <select defaultValue="" onChange={(e) => move(e.target.value)} title="Move to…" style={{ width: 'auto' }}>
                <option value="" disabled>
                    Move…
                </option>
                {others.map((c) => (
                    <option key={c.id} value={c.id}>
                        #{c.number} {c.name}
                    </option>
                ))}
            </select>
            <button className="danger small" onClick={remove}>
                ✕
            </button>
        </div>
    );
}
