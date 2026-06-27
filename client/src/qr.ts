import QRCode from 'qrcode';

/** Returns a PNG data URL encoding the deep link to a container. */
export async function makeQrDataUrl(qrToken: string, origin = window.location.origin): Promise<string> {
    const url = `${origin}/c/${qrToken}`;
    return QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
}

/** Opens a printable window for a container label (QR + number + name). */
export function printLabel(opts: { number: number; name: string; qrDataUrl: string }): void {
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Container ${opts.number}</title>
    <style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:24px;margin:0}
      .num{font-size:48px;font-weight:700;margin:8px 0}
      .name{font-size:20px;color:#333;margin-bottom:12px}
      img{width:300px;height:300px}
      @media print{button{display:none}}
    </style></head><body>
    <div class="num">#${opts.number}</div>
    <div class="name">${escapeHtml(opts.name)}</div>
    <img src="${opts.qrDataUrl}" alt="QR for container ${opts.number}" />
    <div><button onclick="window.print()">Print</button></div>
    </body></html>`);
    w.document.close();
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
