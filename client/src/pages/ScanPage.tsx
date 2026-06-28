import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

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

        // Stop only when the camera is actually scanning/paused; stop() throws
        // synchronously otherwise (e.g. before start resolves on StrictMode unmount).
        const safeStop = async () => {
            try {
                const state = scanner.getState();
                if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
                    await scanner.stop();
                }
            } catch {
                /* already stopped or never started */
            }
        };

        const startPromise = scanner
            .start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 240, height: 240 } },
                (decoded) => {
                    if (stopped) return;
                    stopped = true;
                    void safeStop();
                    routeTo(decoded);
                },
                () => undefined,
            )
            .catch(() => setError('Camera unavailable. Grant camera permission and retry.'));

        return () => {
            stopped = true;
            // Wait for start to settle so we never stop a half-initialized scanner.
            void startPromise.then(safeStop);
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
            <h1>Scan a containers QR code</h1>
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
