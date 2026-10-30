import { useDelayedLoading } from './useDelayedLoading';

interface SpinnerProps {
    /** Names what is loading for screen readers. */
    label?: string;
    /** `md` is the 40px page/panel ring; `sm` is the 18px inline ring. */
    size?: 'md' | 'sm';
    /** Cover the content area with a fixed overlay in the page background. */
    page?: boolean;
}

/** The shared loading ring. It appears once it has stayed mounted for the standard 250ms delay. */
export function Spinner({ label = 'Loading', size = 'md', page = false }: SpinnerProps) {
    const show = useDelayedLoading(true);
    if (!show && !page) return null;
    return (
        <span className={page ? 'page-loading' : 'spinner-inline'}>
            {show && (
                <span className="spinner-wrap" role="status">
                    <span className={`spinner${size === 'sm' ? ' spinner-sm' : ''}`} aria-hidden="true" />
                    <span className="sr-only">{label}</span>
                </span>
            )}
        </span>
    );
}
