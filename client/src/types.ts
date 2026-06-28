export interface Container {
    id: string;
    number: number;
    name: string;
    locationId?: string | null;
    location?: string | null;
    ownerId?: string | null;
    owner?: string | null;
    notes?: string | null;
    qrToken: string;
    itemCount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface Item {
    id: string;
    containerId: string;
    name: string;
    description?: string | null;
    quantity: number;
    source: 'ai' | 'manual';
    tags: string[];
    categoryId?: string | null;
    category?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface Lookup {
    id: string;
    name: string;
}

export type LookupKind = 'owners' | 'locations' | 'categories';

export interface Facet {
    ownerId?: string | null;
    locationId?: string | null;
    categoryId?: string | null;
}

export interface Photo {
    id: string;
    containerId: string;
    blobUrl: string;
    thumbUrl: string;
    takenAt: string;
    processedAt?: string | null;
}

export interface DetectedItem {
    name: string;
    description?: string;
    quantity: number;
}

export interface ContainerWithContents extends Container {
    items: Item[];
    photos: Photo[];
}

export interface CreateContainerInput {
    name: string;
    locationId?: string | null;
    ownerId?: string | null;
    notes?: string;
}

export interface SaveItemInput {
    name: string;
    description?: string;
    quantity: number;
    tags: string[];
    categoryId?: string | null;
}
