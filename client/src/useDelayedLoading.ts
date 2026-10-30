import { useEffect, useState } from 'react';

export const LOADING_DELAY_MS = 250;

/** True only after `isLoading` has stayed true for `delayMs`, so fast loads never flash a spinner. */
export function useDelayedLoading(isLoading: boolean, delayMs = LOADING_DELAY_MS): boolean {
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            setShow(false);
            return;
        }
        const timer = setTimeout(() => setShow(true), delayMs);
        return () => clearTimeout(timer);
    }, [isLoading, delayMs]);

    return show;
}
