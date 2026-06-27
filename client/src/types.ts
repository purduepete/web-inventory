export interface Container {
    id: string;
    number: number;
    name: string;
    location?: string | null;
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
    createdAt: string;
    updatedAt: string;
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
    location?: string;
    notes?: string;
}

export interface SaveItemInput {
    name: string;
    description?: string;
    quantity: number;
    tags: string[];
}

export type Role = 'member' | 'admin';

export interface AppUser {
    id: string;
    email: string;
    role: Role;
    displayName?: string | null;
    invitedBy?: string | null;
    createdAt: string;
    lastLoginAt?: string | null;
}

export interface AuthInfo {
    email: string | null;
    roles: string[];
    isAdmin: boolean;
}
