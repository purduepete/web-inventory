import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Spinner } from './Spinner';

const ReadyContext = createContext<(failed: boolean) => void>(() => {});

export function FirstLoad({ children }: { children: ReactNode }) {
    const [state, setState] = useState('pending');
    useEffect(() => {
        if (state !== 'ready') return;
        const timer = setTimeout(() => setState('visible'), 600);
        return () => clearTimeout(timer);
    }, [state]);
    return (
        <ReadyContext.Provider
            value={(failed) => setState((old) => (old === 'pending' ? (failed ? 'failed' : 'ready') : old))}
        >
            <div className="app first-load" data-first-load={state}>
                {children}
            </div>
            {state === 'pending' && <Spinner page label="Loading inventory" />}
        </ReadyContext.Provider>
    );
}

export function PageLoad({ children, onReady }: { children: ReactNode; onReady: () => void }) {
    const reveal = useContext(ReadyContext);
    const ready = useCallback(
        (failed: boolean) => {
            reveal(failed);
            onReady();
        },
        [reveal, onReady]
    );
    return <ReadyContext.Provider value={ready}>{children}</ReadyContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Readiness hook shares the shell context.
export function useFirstLoad(ready: boolean, failed = false) {
    const reveal = useContext(ReadyContext);
    useLayoutEffect(() => {
        if (ready || failed) reveal(failed);
    }, [ready, failed, reveal]);
}
