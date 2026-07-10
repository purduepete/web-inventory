import { useState } from 'react';
import { Icon } from './Icon';
import { setKey } from './api';

/**
 * Access-key gate. Shown when there's no stored key (or the API rejected the
 * current one). The key is saved to localStorage and validated on the next API
 * call — an invalid key simply bounces back here.
 */
export function KeyGate({ onSaved }: { onSaved: () => void }) {
    const [value, setValue] = useState('');

    function save() {
        const key = value.trim();
        if (!key) return;
        setKey(key);
        onSaved();
    }

    return (
        <div className="app">
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
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && save()}
                        aria-label="Access key"
                    />
                    <button type="button" onClick={save} disabled={!value.trim()}>
                        Continue
                    </button>
                </div>
            </main>
        </div>
    );
}
