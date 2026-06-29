import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { createContainerOffline } from '../db';
import { Select } from '../Select';
import { usePrompt } from '../Dialog';
import { getLookup, invalidateLookups } from '../lookups';
import type { Lookup } from '../types';

export default function NewContainerPage() {
    const nav = useNavigate();
    const prompt = usePrompt();
    const [name, setName] = useState('');
    const [locationId, setLocationId] = useState('');
    const [ownerId, setOwnerId] = useState('');
    const [notes, setNotes] = useState('');
    const [locations, setLocations] = useState<Lookup[]>([]);
    const [owners, setOwners] = useState<Lookup[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Autofocus the name field only with a fine pointer (desktop). On touch
    // devices (iPad/iPhone) autofocus pops the on-screen keyboard the moment you
    // navigate here, which is jarring.
    const autoFocusName = typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches;

    // Create a new location ("room") inline without leaving the page.
    async function addLocation() {
        const room = (await prompt({ title: 'New location', label: 'Location name', confirmLabel: 'Add' }))?.trim();
        if (!room) return;
        try {
            const created = await api.createLookup('locations', room);
            invalidateLookups('locations');
            const locs = await getLookup('locations').catch(() => null);
            if (locs) setLocations(locs);
            setLocationId(created.id);
        } catch {
            setError('Could not add location. You may be offline.');
        }
    }

    useEffect(() => {
        void getLookup('locations')
            .then(setLocations)
            .catch(() => {});
        void getLookup('owners')
            .then(setOwners)
            .catch(() => {});
    }, []);

    async function save() {
        if (!name.trim()) {
            setError('Give the container a name.');
            return;
        }
        setSaving(true);
        setError(null);
        const input = {
            name: name.trim(),
            locationId: locationId || null,
            ownerId: ownerId || null,
            notes: notes.trim(),
        };
        try {
            const c = navigator.onLine ? await api.createContainer(input) : await createContainerOffline(input);
            nav(`/containers/${c.id}`);
        } catch {
            // Network died: create it offline so it syncs later.
            try {
                const c = await createContainerOffline(input);
                nav(`/containers/${c.id}`);
            } catch {
                setError('Could not create container.');
                setSaving(false);
            }
        }
    }

    return (
        <div>
            <h1>New container</h1>
            <label>
                Name
                <input
                    className="glow-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Garage shelf bin"
                    autoFocus={autoFocusName}
                />
            </label>
            <label>
                Owner (optional)
                <Select
                    value={ownerId}
                    onChange={setOwnerId}
                    ariaLabel="Owner"
                    options={[{ value: '', label: '— none —' }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
                />
            </label>
            <label>
                Location (optional)
                <Select
                    value={locationId}
                    onChange={(v) => {
                        if (v === '__new__') void addLocation();
                        else setLocationId(v);
                    }}
                    ariaLabel="Location"
                    options={[
                        { value: '', label: '— none —' },
                        ...locations.map((l) => ({ value: l.id, label: l.name })),
                        { value: '__new__', label: '+ New location…' },
                    ]}
                />
            </label>
            <p className="muted" style={{ marginTop: -2 }}>
                Add locations and owners on the <Link to="/manage">Tags</Link> page.
            </p>
            <label>
                Notes (optional)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="row" style={{ marginTop: 18 }}>
                <button onClick={save} disabled={saving}>
                    {saving ? 'Creating…' : 'Create container'}
                </button>
                <button className="ghost" onClick={() => nav(-1)}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
