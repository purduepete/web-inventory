import { api } from './api';
import type { Container } from './types';

// D1: the container detail page fetched the full container list up to 3x per
// visit (move-photo picker, sibling nav, move-item picker). This memoizes a
// single in-flight/last-resolved list and shares it across those callers.
// It is invalidated whenever a mutation changes the set or item counts (see
// invalidateContainers() calls in api.ts), so it never serves stale data past
// a write.
let cached: Promise<Container[]> | null = null;

export function getContainersCached(): Promise<Container[]> {
    if (!cached) {
        cached = api.listContainers().catch((err) => {
            // Don't cache a failure — let the next caller retry.
            cached = null;
            throw err;
        });
    }
    return cached;
}

export function invalidateContainers(): void {
    cached = null;
}
