import type {
    Container,
    ContainerWithContents,
    CreateContainerInput,
    DetectedItem,
    Item,
    SaveItemInput,
} from './types';

const BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
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

    searchItems: (q: string, tag?: string) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (tag) params.set('tag', tag);
        return http<Item[]>(`/search?${params.toString()}`);
    },

    listTags: () => http<string[]>('/tags'),

    // Posts the (already downscaled) JPEG as the raw request body; the API stores
    // it in Blob Storage and runs AI detection, returning suggested items.
    uploadPhoto: async (containerId: string, blob: Blob): Promise<{ photoId: string; detected: DetectedItem[] }> => {
        const res = await fetch(`${BASE}/containers/${containerId}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new ApiError(res.status, body || res.statusText);
        }
        return res.json();
    },
};
