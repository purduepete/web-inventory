/** Returns a PNG data URL encoding the deep link to a container. */
export async function makeQrDataUrl(qrToken: string, origin = window.location.origin): Promise<string> {
    // Loaded on demand so the qrcode library isn't bundled into the container chunk.
    const { default: QRCode } = await import('qrcode');
    const url = `${origin}/c/${qrToken}`;
    return QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
}

/**
 * Prints a container label (QR + number + name) without leaving the app.
 * Uses a hidden same-page iframe instead of window.open, so it works inside a
 * home-screen PWA (iPad) where a new tab would strand the user in Safari.
 */
export function printLabel(opts: { number: number; name: string; qrDataUrl: string }): void {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
        document.body.removeChild(iframe);
        return;
    }

    doc.open();
    doc.write(`<!doctype html><html><head><title>Container ${opts.number}</title>
    <style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:24px;margin:0}
      .num{font-size:48px;font-weight:700;margin:8px 0}
      .name{font-size:20px;color:#333;margin-bottom:12px}
      img{width:300px;height:300px}
    </style></head><body>
    <div class="num">#${opts.number}</div>
    <div class="name">${escapeHtml(opts.name)}</div>
    <img src="${opts.qrDataUrl}" alt="QR for container ${opts.number}" />
    </body></html>`);
    doc.close();

    const win = iframe.contentWindow!;
    const cleanup = () => {
        // Remove the iframe after printing; small delay so the print dialog can settle.
        setTimeout(() => iframe.remove(), 1000);
    };
    win.addEventListener('afterprint', cleanup, { once: true });

    const fire = () => {
        win.focus();
        win.print();
    };
    // Wait for the QR image to load before printing.
    const img = doc.querySelector('img');
    if (img && !img.complete) {
        img.addEventListener('load', fire, { once: true });
        img.addEventListener('error', fire, { once: true });
    } else {
        fire();
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
