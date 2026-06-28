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

const BASE = '/api';

// True once we've started a login redirect, so we don't fire it repeatedly.
let redirectingToLogin = false;

/**
 * Detects an expired/absent auth session. When the SWA `member` gate rejects an
 * API call it answers with a 302 to `/.auth/login/aad`; a cross-origin redirect
 * makes `fetch` throw `TypeError: Failed to fetch` (or, occasionally, surfaces a
 * 401). Without this check the failure is swallowed and pages render as empty
 * even though the data exists — so confirm via `/.auth/me` and, if there is no
 * signed-in principal, send the user to sign in (preserving the current route).
 */
async function redirectToLoginIfSignedOut(): Promise<void> {
    if (redirectingToLogin) return;
    try {
        const me = await fetch('/.auth/me', { headers: { Accept: 'application/json' } });
        if (!me.ok) return;
        const data = (await me.json()) as { clientPrincipal?: unknown };
        if (data?.clientPrincipal) return; // still signed in — a genuine API error
    } catch {
        return; // can't reach /.auth/me; treat as a normal network error
    }
    redirectingToLogin = true;
    const target = window.location.pathname + window.location.search;
    window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(target)}`;
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

    createContainer: (input: CreateContainerInput) =>
        http<Container>('/containers', { method: 'POST', body: JSON.stringify(input) }),

    updateContainer: (id: string, input: CreateContainerInput) =>
        http<Container>(`/containers/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

    deleteContainer: (id: string) => http<void>(`/containers/${id}`, { method: 'DELETE' }),

    addItem: (containerId: string, input: SaveItemInput) =>
        http<Item>(`/containers/${containerId}/items`, {
            method: 'POST',
            body: JSON.stringify(input),
        }),

    updateItem: (itemId: string, input: SaveItemInput) =>
        http<Item>(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify(input) }),

    moveItem: (itemId: string, targetContainerId: string) =>
        http<Item>(`/items/${itemId}/move`, {
            method: 'POST',
            body: JSON.stringify({ targetContainerId }),
        }),

    deleteItem: (itemId: string) => http<void>(`/items/${itemId}`, { method: 'DELETE' }),

    deletePhoto: (photoId: string) => http<void>(`/photos/${photoId}`, { method: 'DELETE' }),

    movePhoto: (photoId: string, targetContainerId: string) =>
        http<void>(`/photos/${photoId}/move`, {
            method: 'POST',
            body: JSON.stringify({ targetContainerId }),
        }),

    searchItems: (
        q: string,
        filters?: { tag?: string; locationId?: string; ownerId?: string; categoryId?: string },
    ) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (filters?.tag) params.set('tag', filters.tag);
        if (filters?.locationId) params.set('locationId', filters.locationId);
        if (filters?.ownerId) params.set('ownerId', filters.ownerId);
        if (filters?.categoryId) params.set('categoryId', filters.categoryId);
        return http<Item[]>(`/search?${params.toString()}`);
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
