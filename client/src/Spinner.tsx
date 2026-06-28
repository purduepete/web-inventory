interface SpinnerProps {
    label?: string;
}

export function Spinner({ label = 'Loading…' }: SpinnerProps) {
    return (
        <div className="spinner-wrap" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {label && <span className="spinner-label">{label}</span>}
        </div>
    );
}
