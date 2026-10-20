import type {
    Container,
    ContainerWithContents,
    CreateContainerInput,
    DetectedItem,
    Facet,
    Item,
    Lookup,
    LookupKind,
    SaveItemInput,
} from './types';
import { invalidateContainers } from './containersCache';

// The local host serves the PWA and API at the same origin.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/api';
export const platformAuth = (import.meta.env.VITE_AUTH_MODE ?? 'access') === 'access';

// The access key gates every API call. It's stored in localStorage and sent as the
// `x-api-key` header; the API validates it (see api/Middleware/KeyAuthMiddleware).
const KEY_STORAGE = 'webinventory_key';
// Broadcast when the API rejects our key (missing/invalid/revoked) so the app can
// drop back to the key gate without a hard reload.
export const KEY_INVALID_EVENT = 'webinventory:key-invalid';

export function getKey(): string | null {
    return localStorage.getItem(KEY_STORAGE);
}

export function setKey(key: string): void {
    localStorage.setItem(KEY_STORAGE, key);
}

export function clearKey(): void {
    localStorage.removeItem(KEY_STORAGE);
}

/**
 * Verify a key with the server before we let it through the gate. Uses a cheap
 * authenticated GET and reports success purely from the status (no side effects,
 * so a bad candidate key doesn't clear the stored one). If we're offline and the
 * request can't complete, we optimistically accept — an offline PWA with a
 * previously-good key must still open, and a truly bad key gets bounced on the
 * next online call.
 */
export async function validateKey(key?: string): Promise<boolean> {
    const k = key ?? getKey();
    if (!platformAuth && !k) return false;
    try {
        // Hit a zero-work auth-check endpoint (204 on success) rather than a data
        // endpoint like /tags — the server still validates the key in middleware,
        // but skips an extra DB query + payload, so the gate check is much faster.
        const res = await fetch(`${BASE}/auth/check`, { headers: platformAuth ? {} : { 'x-api-key': k! } });
        return platformAuth ? res.status === 204 : res.status !== 401;
    } catch {
        return true;
    }
}

/** Called on a 401: forget the bad key and ask the app to show the gate again. */
function onUnauthorized(): void {
    clearKey();
    window.dispatchEvent(new Event(KEY_INVALID_EVENT));
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const key = getKey();
    if (key && !platformAuth) headers['x-api-key'] = key;
    return headers;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) }),
    });
    if (res.status === 401) onUnauthorized();
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ApiError(res.status, body || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const api = {
    listContainers: () => http<Container[]>('/containers'),

    getContainer: (id: string) => http<ContainerWithContents>(`/containers/${id}`),

    getContainerByToken: (token: string) => http<ContainerWithContents>(`/containers/by-token/${token}`),

    createContainer: async (input: CreateContainerInput) => {
        const r = await http<Container>('/containers', { method: 'POST', body: JSON.stringify(input) });
        invalidateContainers();
        return r;
    },

    updateContainer: async (id: string, input: CreateContainerInput) => {
        const r = await http<Container>(`/containers/${id}`, { method: 'PUT', body: JSON.stringify(input) });
        invalidateContainers();
        return r;
    },

    deleteContainer: async (id: string) => {
        await http<void>(`/containers/${id}`, { method: 'DELETE' });
        invalidateContainers();
    },

    addItem: async (containerId: string, input: SaveItemInput) => {
        const r = await http<Item>(`/containers/${containerId}/items`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        invalidateContainers();
        return r;
    },

    updateItem: (itemId: string, input: SaveItemInput) =>
        http<Item>(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify(input) }),

    moveItem: async (itemId: string, targetContainerId: string) => {
        const r = await http<Item>(`/items/${itemId}/move`, {
            method: 'POST',
            body: JSON.stringify({ targetContainerId }),
        });
        invalidateContainers();
        return r;
    },

    deleteItem: async (itemId: string) => {
        await http<void>(`/items/${itemId}`, { method: 'DELETE' });
        invalidateContainers();
    },

    deletePhoto: (photoId: string) => http<void>(`/photos/${photoId}`, { method: 'DELETE' }),

    rotatePhoto: (photoId: string, degrees = 90) =>
        http<void>(`/photos/${photoId}/rotate?degrees=${degrees}`, { method: 'POST' }),

    movePhoto: (photoId: string, targetContainerId: string) =>
        http<void>(`/photos/${photoId}/move`, {
            method: 'POST',
            body: JSON.stringify({ targetContainerId }),
        }),

    searchItems: (
        q: string,
        filters?: { tag?: string; locationId?: string; ownerId?: string; categoryId?: string },
        paging?: { skip?: number; take?: number }
    ) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (filters?.tag) params.set('tag', filters.tag);
        if (filters?.locationId) params.set('locationId', filters.locationId);
        if (filters?.ownerId) params.set('ownerId', filters.ownerId);
        if (filters?.categoryId) params.set('categoryId', filters.categoryId);
        if (paging?.skip) params.set('skip', String(paging.skip));
        if (paging?.take) params.set('take', String(paging.take));
        return http<{ items: Item[]; hasMore: boolean }>(`/search?${params.toString()}`);
    },

    listTags: () => http<string[]>('/tags'),

    listFacets: () => http<Facet[]>('/facets'),

    listLookup: (kind: LookupKind) => http<Lookup[]>(`/lookups/${kind}`),

    createLookup: (kind: LookupKind, name: string) =>
        http<Lookup>(`/lookups/${kind}`, { method: 'POST', body: JSON.stringify({ name }) }),

    renameLookup: (kind: LookupKind, id: string, name: string) =>
        http<Lookup>(`/lookups/${kind}/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),

    deleteLookup: (kind: LookupKind, id: string) => http<void>(`/lookups/${kind}/${id}`, { method: 'DELETE' }),

    // Posts the (already downscaled) JPEG as the raw request body; the API stores
    // it in Blob Storage and (unless analyze=false) runs AI detection, returning
    // suggested items.
    uploadPhoto: async (
        containerId: string,
        blob: Blob,
        analyze = true,
        clientMutationId?: string
    ): Promise<{ photoId: string; detected: DetectedItem[] }> => {
        const qs = analyze ? '' : '?analyze=false';
        const headers: Record<string, string> = { 'Content-Type': 'image/jpeg' };
        // Stable id lets the server dedupe a retried/replayed upload (#10).
        if (clientMutationId) headers['X-Client-Mutation-Id'] = clientMutationId;
        const res = await fetch(`${BASE}/containers/${containerId}/photos${qs}`, {
            method: 'POST',
            headers: authHeaders(headers),
            body: blob,
        });
        if (res.status === 401) onUnauthorized();
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new ApiError(res.status, body || res.statusText);
        }
        return res.json();
    },
};
