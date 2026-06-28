import { api } from './api';
import { cacheLookups, cacheTags, getCachedLookups, getCachedTags } from './db';
import type { Lookup, LookupKind } from './types';

/**
 * Process-lifetime cache for the lookup lists (owners / locations / categories)
 * and the tag list. These are read on nearly every page; without a shared cache
 * each navigation refetches them. Mutations on the Tags page call
 * invalidateLookups() so consumer pages pick up fresh data on next read.
 * Each successful fetch is mirrored into IndexedDB so the lists (and existing
 * tags) stay usable offline; failures fall back to that cache.
 */
const lookupCache = new Map<LookupKind, Promise<Lookup[]>>();
let tagsCache: Promise<string[]> | null = null;

export function getLookup(kind: LookupKind): Promise<Lookup[]> {
    let p = lookupCache.get(kind);
    if (!p) {
        p = api
            .listLookup(kind)
            .then((items) => {
                void cacheLookups(kind, items);
                return items;
            })
            .catch(async (err) => {
                lookupCache.delete(kind); // never cache a failure
                const cached = await getCachedLookups(kind);
                if (cached) return cached;
                throw err;
            });
        lookupCache.set(kind, p);
    }
    return p;
}

export function getTags(): Promise<string[]> {
    if (!tagsCache) {
        tagsCache = api
            .listTags()
            .then((items) => {
                void cacheTags(items);
                return items;
            })
            .catch(async (err) => {
                tagsCache = null;
                const cached = await getCachedTags();
                if (cached) return cached;
                throw err;
            });
    }
    return tagsCache;
}

export function invalidateLookups(kind?: LookupKind): void {
    if (kind) lookupCache.delete(kind);
    else lookupCache.clear();
}
