import { useEffect, useState } from 'react';

// Persist a boolean (e.g. a collapse open/closed state) in localStorage under
// `key`, falling back to `defaultValue` when nothing is stored yet.
export function usePersistentToggle(
    key: string,
    defaultValue: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
    const [value, setValue] = useState<boolean>(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) return raw === 'true';
        } catch {
            /* ignore */
        }
        return defaultValue;
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, String(value));
        } catch {
            /* ignore */
        }
    }, [key, value]);

    return [value, setValue];
}
