import { api } from './api';
import type { Lookup, LookupKind } from './types';

/**
 * Process-lifetime cache for the lookup lists (owners / locations / categories)
 * and the tag list. These are read on nearly every page; without a shared cache
 * each navigation refetches them. Mutations on the Tags page call
 * invalidateLookups() so consumer pages pick up fresh data on next read.
 */
const lookupCache = new Map<LookupKind, Promise<Lookup[]>>();
let tagsCache: Promise<string[]> | null = null;

export function getLookup(kind: LookupKind): Promise<Lookup[]> {
    let p = lookupCache.get(kind);
    if (!p) {
        p = api.listLookup(kind).catch((err) => {
            lookupCache.delete(kind); // never cache a failure
            throw err;
        });
        lookupCache.set(kind, p);
    }
    return p;
}

export function getTags(): Promise<string[]> {
    if (!tagsCache) {
        tagsCache = api.listTags().catch((err) => {
            tagsCache = null;
            throw err;
        });
    }
    return tagsCache;
}

export function invalidateLookups(kind?: LookupKind): void {
    if (kind) lookupCache.delete(kind);
    else lookupCache.clear();
}
