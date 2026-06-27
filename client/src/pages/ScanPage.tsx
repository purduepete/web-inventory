import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

export default function ScanPage() {
    const nav = useNavigate();
    const ref = useRef<HTMLDivElement>(null);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let stopped = false;
        const elId = 'qr-reader';
        const scanner = new Html5Qrcode(elId);
        scannerRef.current = scanner;

        scanner
            .start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 240, height: 240 } },
                (decoded) => {
                    if (stopped) return;
                    stopped = true;
                    void scanner.stop().catch(() => undefined);
                    routeTo(decoded);
                },
                () => undefined,
            )
            .catch(() => setError('Camera unavailable. Grant camera permission and retry.'));

        return () => {
            stopped = true;
            scanner.stop().catch(() => undefined);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function routeTo(decoded: string) {
        try {
            // Accept both full URLs (.../c/<token>) and bare tokens.
            const m = decoded.match(/\/c\/([^/?#]+)/);
            const token = m ? m[1] : decoded.trim();
            nav(`/c/${token}`);
        } catch {
            setError('Unrecognized QR code.');
        }
    }

    return (
        <div>
            <h1>Scan a container</h1>
            <div id="qr-reader" ref={ref} style={{ width: '100%', overflow: 'hidden' }} />
            {error && (
                <div className="center" style={{ color: 'var(--danger)' }}>
                    {error}
                </div>
            )}
            <p className="muted" style={{ marginTop: 12 }}>
                Point your camera at a container's printed QR label.
            </p>
        </div>
    );
}
