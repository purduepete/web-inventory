import Dexie, { type Table } from 'dexie';
import { api } from './api';
import type { Container, DetectedItem, SaveItemInput } from './types';

export type QueuedMutation =
    | { kind: 'addItem'; containerId: string; input: SaveItemInput }
    | { kind: 'updateItem'; itemId: string; input: SaveItemInput }
    | { kind: 'deleteItem'; itemId: string }
    | { kind: 'moveItem'; itemId: string; targetContainerId: string };

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

class InventoryDb extends Dexie {
    queue!: Table<QueueRow, number>;
    pendingPhotos!: Table<PendingPhoto, number>;
    containers!: Table<CachedContainer, string>;
    pendingSuggestions!: Table<PendingSuggestionRow, string>;

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
    }
}

export const db = new InventoryDb();

/** Let the UI (the topbar sync badge) react to queue changes without polling. */
function notifyPending(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('pending-changed'));
}

export async function enqueue(mutation: QueuedMutation): Promise<void> {
    await db.queue.add({ createdAt: Date.now(), mutation });
    notifyPending();
}

export async function enqueuePhoto(containerId: string, blob: Blob): Promise<void> {
    await db.pendingPhotos.add({ containerId, blob, createdAt: Date.now() });
    notifyPending();
}

export async function cacheContainers(containers: Container[]): Promise<void> {
    const now = Date.now();
    await db.containers.bulkPut(containers.map((c) => ({ ...c, cachedAt: now })));
}

/** Tell an open container page that AI suggestions arrived for it after a sync. */
function notifySuggestions(containerId: string): void {
    if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('suggestions-ready', { detail: { containerId } }));
}

export async function addPendingSuggestions(containerId: string, items: DetectedItem[]): Promise<void> {
    if (!items.length) return;
    const existing = await db.pendingSuggestions.get(containerId);
    const merged = existing ? [...existing.items, ...items] : items;
    await db.pendingSuggestions.put({ containerId, items: merged, createdAt: Date.now() });
    notifySuggestions(containerId);
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
            x.name === item.name &&
            (x.description ?? '') === (item.description ?? '') &&
            x.quantity === item.quantity,
    );
    if (idx < 0) return;
    const items = row.items.slice();
    items.splice(idx, 1);
    if (items.length) await db.pendingSuggestions.put({ ...row, items });
    else await db.pendingSuggestions.delete(containerId);
}

let syncing = false;

/** Replay queued mutations + photo uploads when connectivity returns. */
export async function syncNow(): Promise<{ synced: number; failed: number }> {
    if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
    syncing = true;
    let synced = 0;
    let failed = 0;
    try {
        const rows = await db.queue.orderBy('createdAt').toArray();
        for (const row of rows) {
            try {
                await applyMutation(row.mutation);
                if (row.id != null) await db.queue.delete(row.id);
                synced++;
            } catch {
                failed++;
                // Stop on first failure to preserve ordering; retry on next sync.
                break;
            }
        }
        const photos = await db.pendingPhotos.orderBy('createdAt').toArray();
        for (const p of photos) {
            try {
                // Photos captured offline still get AI detection on upload; stash the
                // suggestions so the container page can prompt the user to confirm them.
                const { detected } = await api.uploadPhoto(p.containerId, p.blob);
                if (p.id != null) await db.pendingPhotos.delete(p.id);
                if (detected.length) await addPendingSuggestions(p.containerId, detected);
                synced++;
            } catch {
                failed++;
                break;
            }
        }
    } finally {
        syncing = false;
        notifyPending();
    }
    return { synced, failed };
}

async function applyMutation(m: QueuedMutation): Promise<void> {
    switch (m.kind) {
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
    }
}

export async function pendingCount(): Promise<number> {
    return (await db.queue.count()) + (await db.pendingPhotos.count());
}
