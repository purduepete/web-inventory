import Dexie, { type Table } from 'dexie';
import { api } from './api';
import type { Container, Item, SaveItemInput } from './types';

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

export interface CachedItem extends Item {
    cachedAt: number;
}

class InventoryDb extends Dexie {
    queue!: Table<QueueRow, number>;
    pendingPhotos!: Table<PendingPhoto, number>;
    containers!: Table<CachedContainer, string>;
    items!: Table<CachedItem, string>;

    constructor() {
        super('webinventory');
        this.version(1).stores({
            queue: '++id, createdAt',
            pendingPhotos: '++id, containerId, createdAt',
            containers: 'id, number, updatedAt',
            items: 'id, containerId, updatedAt',
        });
    }
}

export const db = new InventoryDb();

export async function enqueue(mutation: QueuedMutation): Promise<void> {
    await db.queue.add({ createdAt: Date.now(), mutation });
}

export async function enqueuePhoto(containerId: string, blob: Blob): Promise<void> {
    await db.pendingPhotos.add({ containerId, blob, createdAt: Date.now() });
}

export async function cacheContainers(containers: Container[]): Promise<void> {
    const now = Date.now();
    await db.containers.bulkPut(containers.map((c) => ({ ...c, cachedAt: now })));
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
                await api.uploadPhoto(p.containerId, p.blob);
                if (p.id != null) await db.pendingPhotos.delete(p.id);
                synced++;
            } catch {
                failed++;
                break;
            }
        }
    } finally {
        syncing = false;
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

// Trigger a sync whenever the browser regains connectivity.
window.addEventListener('online', () => {
    void syncNow();
});
