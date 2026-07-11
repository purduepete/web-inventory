import { useState } from 'react';
import { Icon } from './Icon';
import { setKey, validateKey } from './api';

/**
 * Access-key gate. Shown when there's no stored key (or the API rejected the
 * current one). The entered key is validated against the server before we let
 * it through, so an invalid key shows an error here instead of briefly flashing
 * the app.
 */
export function KeyGate({ onSaved }: { onSaved: () => void }) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save() {
        const key = value.trim();
        if (!key || busy) return;
        setBusy(true);
        setError(null);
        const ok = await validateKey(key);
        if (!ok) {
            setError('That access key was not accepted.');
            setBusy(false);
            return;
        }
        setKey(key);
        onSaved();
    }

    return (
        <div className="app app-gate">
            <main className="content gate">
                <div className="gate-card">
                    <span className="brand-mark gate-mark">
                        <Icon name="lock" size={22} />
                    </span>
                    <h1 className="gate-title">Web Inventory</h1>
                    <p className="muted gate-sub">Enter your access key to continue.</p>
                    <input
                        type="password"
                        autoFocus
                        placeholder="Access key"
                        value={value}
                        onChange={(e) => {
                            setValue(e.target.value);
                            if (error) setError(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && save()}
                        aria-label="Access key"
                        disabled={busy}
                    />
                    {error && (
                        <p className="gate-error" role="alert">
                            {error}
                        </p>
                    )}
                    <button type="button" onClick={save} disabled={!value.trim() || busy}>
                        {busy ? 'Checking…' : 'Continue'}
                    </button>
                </div>
            </main>
        </div>
    );
}
