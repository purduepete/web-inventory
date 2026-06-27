import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function NewContainerPage() {
    const nav = useNavigate();
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save() {
        if (!name.trim()) {
            setError('Give the container a name.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const c = await api.createContainer({ name: name.trim(), location: location.trim(), notes: notes.trim() });
            nav(`/containers/${c.id}`);
        } catch {
            setError('Could not create container. You may be offline.');
            setSaving(false);
        }
    }

    return (
        <div>
            <h1>New container</h1>
            <label>
                Name
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Garage shelf bin"
                    autoFocus
                />
            </label>
            <label>
                Location (optional)
                <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Garage, top shelf"
                />
            </label>
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
