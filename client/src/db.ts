import Dexie, { type Table } from 'dexie';
import { ApiError, api } from './api';
import type { Container, CreateContainerInput, DetectedItem, Lookup, LookupKind, SaveItemInput } from './types';

export type QueuedMutation =
    | { kind: 'createContainer'; tempId: string; input: CreateContainerInput }
    | { kind: 'addItem'; containerId: string; input: SaveItemInput }
    | { kind: 'updateItem'; itemId: string; input: SaveItemInput }
    | { kind: 'deleteItem'; itemId: string }
    | { kind: 'moveItem'; itemId: string; targetContainerId: string }
    | { kind: 'deletePhoto'; photoId: string }
    | { kind: 'movePhoto'; photoId: string; targetContainerId: string };

export interface QueueRow {
    id?: number;
    createdAt: number;
    mutation: QueuedMutation;
}

export interface PendingPhoto {
    id?: number;
    containerId: string;
    blob: Blob;
    createdAt: number;
    /** Whether to run AI detection on upload. Absent = legacy rows = true. */
    analyze?: boolean;
}

export interface CachedContainer extends Container {
    cachedAt: number;
}

/**
 * AI suggestions detected from a photo that was uploaded during sync (i.e. the
 * photo was attached while offline). The container page picks these up the next
 * time it is open so the user can still confirm the detected items.
 */
export interface PendingSuggestionRow {
    containerId: string;
    items: DetectedItem[];
    createdAt: number;
}

/** Cached lookup lists (owners / locations / categories), one row per kind. */
export interface CachedLookupRow {
    kind: LookupKind;
    items: Lookup[];
}

/** Cached tag list, stored as a single row. */
export interface CachedTagRow {
    id: string;
    items: string[];
}

class InventoryDb extends Dexie {
    queue!: Table<QueueRow, number>;
    pendingPhotos!: Table<PendingPhoto, number>;
    containers!: Table<CachedContainer, string>;
    pendingSuggestions!: Table<PendingSuggestionRow, string>;
    lookups!: Table<CachedLookupRow, string>;
    tags!: Table<CachedTagRow, string>;

    constructor() {
        super('webinventory');
        this.version(1).stores({
            queue: '++id, createdAt',
            pendingPhotos: '++id, containerId, createdAt',
            containers: 'id, number, updatedAt',
            items: 'id, containerId, updatedAt',
        });
        // v2: drop the never-used `items` cache and the bogus `updatedAt` index
        // (the model has no updatedAt field).
        this.version(2).stores({
            containers: 'id, number',
            items: null,
        });
        // v3: hold AI suggestions detected from photos that synced after being
        // captured offline, keyed by container.
        this.version(3).stores({
            pendingSuggestions: 'containerId, createdAt',
        });
        // v4: cache lookups + tags so they stay usable offline.
        this.version(4).stores({
            lookups: 'kind',
            tags: 'id',
        });
    }
}

export const db = new InventoryDb();

/** Let the UI (the topbar sync badge) react to queue changes without polling. */
function notifyPending(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('pending-changed'));
}

export async function enqueue(mutation: QueuedMutation): Promise<void> {
    // Stamp create mutations with a stable idempotency key so a lost response
    // can't duplicate the record when the mutation is replayed on the next sync
    // (the server dedupes on it — see B2).
    if (mutation.kind === 'createContainer' && !mutation.input.clientMutationId)
        mutation.input.clientMutationId = crypto.randomUUID();
    if (mutation.kind === 'addItem' && !mutation.input.clientMutationId)
        mutation.input.clientMutationId = crypto.randomUUID();
    await db.queue.add({ createdAt: Date.now(), mutation });
    notifyPending();
}

export async function enqueuePhoto(containerId: string, blob: Blob, analyze = true): Promise<void> {
    await db.pendingPhotos.add({ containerId, blob, createdAt: Date.now(), analyze });
    notifyPending();
}

export async function cacheContainers(containers: Container[]): Promise<void> {
    const now = Date.now();
    await db.containers.bulkPut(containers.map((c) => ({ ...c, cachedAt: now })));
}

/** Replace the cached container list wholesale (prunes stale/temp entries). */
export async function replaceCachedContainers(containers: Container[]): Promise<void> {
    const now = Date.now();
    await db.transaction('rw', db.containers, async () => {
        await db.containers.clear();
        await db.containers.bulkPut(containers.map((c) => ({ ...c, cachedAt: now })));
    });
}

export async function getCachedContainer(id: string): Promise<CachedContainer | undefined> {
    return db.containers.get(id);
}

/** Cache lookup lists + tags so they remain usable offline. */
export async function cacheLookups(kind: LookupKind, items: Lookup[]): Promise<void> {
    await db.lookups.put({ kind, items });
}

export async function getCachedLookups(kind: LookupKind): Promise<Lookup[] | undefined> {
    return (await db.lookups.get(kind))?.items;
}

export async function cacheTags(items: string[]): Promise<void> {
    await db.tags.put({ id: 'all', items });
}

export async function getCachedTags(): Promise<string[] | undefined> {
    return (await db.tags.get('all'))?.items;
}

/**
 * Create a container locally while offline: a temp id (so the user can keep
 * working), cached for the lists/detail page, plus a queued createContainer that
 * runs when connectivity returns. Returns the temp container.
 */
export async function createContainerOffline(input: CreateContainerInput): Promise<Container> {
    const tempId = `temp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const container: Container = {
        id: tempId,
        number: 0,
        name: input.name,
        locationId: input.locationId ?? null,
        ownerId: input.ownerId ?? null,
        notes: input.notes ?? null,
        qrToken: tempId,
        itemCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    await cacheContainers([container]);
    await enqueue({ kind: 'createContainer', tempId, input });
    return container;
}

/** Tell an open container page that AI suggestions arrived for it after a sync. */
function notifySuggestions(containerId: string): void {
    if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('suggestions-ready', { detail: { containerId } }));
}

export async function addPendingSuggestions(containerId: string, items: DetectedItem[]): Promise<void> {
    if (!items.length) return;
    // Read-modify-write in a transaction so concurrent photo syncs for the same
    // container can't clobber each other's suggestions (R6).
    await db.transaction('rw', db.pendingSuggestions, async () => {
        const existing = await db.pendingSuggestions.get(containerId);
        const merged = existing ? [...existing.items, ...items] : items;
        await db.pendingSuggestions.put({ containerId, items: merged, createdAt: Date.now() });
    });
    notifySuggestions(containerId);
    notifyPending();
}

export async function getPendingSuggestions(containerId: string): Promise<DetectedItem[]> {
    const row = await db.pendingSuggestions.get(containerId);
    return row?.items ?? [];
}

/** Drop a single suggestion once the user has confirmed or skipped it. */
export async function removePendingSuggestion(containerId: string, item: DetectedItem): Promise<void> {
    const row = await db.pendingSuggestions.get(containerId);
    if (!row) return;
    const idx = row.items.findIndex(
        (x) =>
            x.name === item.name && (x.description ?? '') === (item.description ?? '') && x.quantity === item.quantity,
    );
    if (idx < 0) return;
    const items = row.items.slice();
    items.splice(idx, 1);
    if (items.length) await db.pendingSuggestions.put({ ...row, items });
    else await db.pendingSuggestions.delete(containerId);
    notifyPending();
}

let syncing = false;

/** A 4xx (except auth + a few transient ones) is permanent — replaying it will
 * never succeed, so drop the offending item rather than letting it wedge the
 * whole queue forever. A network error, 5xx, or a transient 4xx (408 Request
 * Timeout, 409 Conflict, 425 Too Early, 429 Too Many Requests) is retryable:
 * stop and retry on the next sync. */
function isPermanent(e: unknown): boolean {
    if (!(e instanceof ApiError)) return false;
    const transient = e.status === 401 || e.status === 408 || e.status === 409 || e.status === 425 || e.status === 429;
    return e.status >= 400 && e.status < 500 && !transient;
}

/** Replay queued mutations + photo uploads when connectivity returns. */
export async function syncNow(): Promise<{ synced: number; failed: number; error?: string }> {
    if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
    syncing = true;
    let synced = 0;
    let failed = 0;
    let error: string | undefined;
    try {
        const rows = await db.queue.orderBy('createdAt').toArray();
        for (const row of rows) {
            try {
                await applyMutation(row.mutation);
                if (row.id != null) await db.queue.delete(row.id);
                synced++;
                notifyPending();
            } catch (e) {
                failed++;
                error = e instanceof Error ? e.message : String(e);
                if (isPermanent(e)) {
                    // Drop the poison row so it can't block everything behind it.
                    if (row.id != null) await db.queue.delete(row.id);
                    notifyPending();
                    continue;
                }
                // Transient: stop to preserve ordering; retry on next sync.
                break;
            }
        }
        const photos = await db.pendingPhotos.orderBy('createdAt').toArray();
        for (const p of photos) {
            try {
                // Photos captured offline still get AI detection on upload; stash the
                // suggestions so the container page can prompt the user to confirm them.
                // Honor 'add photo only' (analyze=false): don't detect on sync.
                const analyze = p.analyze !== false;
                const { detected } = await api.uploadPhoto(p.containerId, p.blob, analyze);
                if (p.id != null) await db.pendingPhotos.delete(p.id);
                if (detected?.length) await addPendingSuggestions(p.containerId, detected);
                synced++;
                notifyPending();
            } catch (e) {
                failed++;
                error = e instanceof Error ? e.message : String(e);
                if (isPermanent(e)) {
                    if (p.id != null) await db.pendingPhotos.delete(p.id);
                    notifyPending();
                    continue;
                }
                break;
            }
        }
    } finally {
        syncing = false;
        notifyPending();
    }
    return { synced, failed, error };
}

async function applyMutation(m: QueuedMutation): Promise<void> {
    switch (m.kind) {
        case 'createContainer': {
            const real = await api.createContainer(m.input);
            // Re-point any queued items/photos from the temp id to the real one,
            // and swap the cached temp container for the real record.
            await db.queue.toCollection().modify((row) => {
                const mut = row.mutation;
                if (mut.kind === 'addItem' && mut.containerId === m.tempId) mut.containerId = real.id;
                if (mut.kind === 'moveItem' && mut.targetContainerId === m.tempId) mut.targetContainerId = real.id;
            });
            await db.pendingPhotos.where('containerId').equals(m.tempId).modify({ containerId: real.id });
            await db.containers.delete(m.tempId);
            await cacheContainers([real]);
            break;
        }
        case 'addItem':
            await api.addItem(m.containerId, m.input);
            break;
        case 'updateItem':
            await api.updateItem(m.itemId, m.input);
            break;
        case 'deleteItem':
            await api.deleteItem(m.itemId);
            break;
        case 'moveItem':
            await api.moveItem(m.itemId, m.targetContainerId);
            break;
        case 'deletePhoto':
            await api.deletePhoto(m.photoId);
            break;
        case 'movePhoto':
            await api.movePhoto(m.photoId, m.targetContainerId);
            break;
    }
}

export async function pendingCount(): Promise<number> {
    return (await db.queue.count()) + (await db.pendingPhotos.count());
}

/** Count of queued work (items + photos) tied to a specific container. */
export async function pendingForContainer(containerId: string): Promise<number> {
    const photos = await db.pendingPhotos.where('containerId').equals(containerId).count();
    const items = (await db.queue.toArray()).filter((r) => {
        const m = r.mutation;
        return (
            (m.kind === 'addItem' && m.containerId === containerId) ||
            (m.kind === 'createContainer' && m.tempId === containerId) ||
            (m.kind === 'moveItem' && m.targetContainerId === containerId)
        );
    }).length;
    return photos + items;
}

/** Set of container ids that have queued offline work (for list badges). */
export async function pendingContainerIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const p of await db.pendingPhotos.toArray()) ids.add(p.containerId);
    for (const r of await db.queue.toArray()) {
        const m = r.mutation;
        if (m.kind === 'addItem') ids.add(m.containerId);
        else if (m.kind === 'createContainer') ids.add(m.tempId);
        else if (m.kind === 'moveItem') ids.add(m.targetContainerId);
    }
    return ids;
}

/** Set of container ids that have AI suggestions awaiting add/skip review. */
export async function suggestionContainerIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const row of await db.pendingSuggestions.toArray()) if (row.items.length) ids.add(row.containerId);
    return ids;
}
