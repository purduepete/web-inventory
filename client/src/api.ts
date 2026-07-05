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
import { getClientPrincipal, redirectToLogin } from './auth';
import { invalidateContainers } from './containersCache';

const BASE = '/api';

/**
 * Detects an expired/absent auth session after an API call has already failed.
 * When the SWA `member` gate rejects a request it answers with a 302 to
 * `/.auth/login/aad`; a cross-origin redirect makes `fetch` throw
 * `TypeError: Failed to fetch` (or, occasionally, surfaces a 401). Confirm via
 * `/.auth/me` and, if there is no signed-in principal, send the user to sign in.
 * (The app also checks auth proactively on startup — see auth.ts / App.tsx —
 * so this is the mid-session safety net.)
 */
async function redirectToLoginIfSignedOut(): Promise<void> {
    const principal = await getClientPrincipal();
    if (principal === null) redirectToLogin();
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...init,
        });
    } catch (err) {
        // A failed fetch is often the cross-origin auth redirect, not a real outage.
        await redirectToLoginIfSignedOut();
        throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
    }
    if (res.status === 401) await redirectToLoginIfSignedOut();
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
        message: string,
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
        paging?: { skip?: number; take?: number },
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
    ): Promise<{ photoId: string; detected: DetectedItem[] }> => {
        const qs = analyze ? '' : '?analyze=false';
        let res: Response;
        try {
            res = await fetch(`${BASE}/containers/${containerId}/photos${qs}`, {
                method: 'POST',
                headers: { 'Content-Type': 'image/jpeg' },
                body: blob,
            });
        } catch (err) {
            await redirectToLoginIfSignedOut();
            throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
        }
        if (res.status === 401) await redirectToLoginIfSignedOut();
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new ApiError(res.status, body || res.statusText);
        }
        return res.json();
    },
};
