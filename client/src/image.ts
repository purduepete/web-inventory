/**
 * Downscale a captured image to keep upload + AI-vision token costs low.
 * Returns a JPEG blob no larger than maxEdge on its longest side.
 */
export async function downscaleImage(file: Blob, maxEdge = 1024, quality = 0.8): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality);
    });
}
