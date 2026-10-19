using System.Net;
using Microsoft.AspNetCore.Mvc;
using WebInventory.Api.Data;
using WebInventory.Api.Models;
using WebInventory.Api.Services;

namespace WebInventory.Api.Functions;

[ApiController]
public class PhotoFunctions : ControllerBase
{
    // Client downscales to <=1024px before upload, so a valid JPEG is well under this.
    // The cap bounds memory use and rejects malicious oversize payloads (DoS).
    private const long MaxUploadBytes = 15 * 1024 * 1024;

    private readonly InventoryRepository _repo;
    private readonly BlobService _blob;
    private readonly VisionService _vision;

    public PhotoFunctions(InventoryRepository repo, BlobService blob, VisionService vision)
    {
        _repo = repo;
        _blob = blob;
        _vision = vision;
    }

    /// <summary>
    /// Accepts a raw JPEG body, stores it in Blob Storage, runs AI item detection,
    /// and returns the suggested items for the user to confirm.
    /// </summary>
    [HttpPost("/api/containers/{containerId:guid}/photos")]
    public async Task<IActionResult> Upload(
        Guid containerId, CancellationToken ct)
    {
        if (!await _repo.ContainerExistsAsync(containerId, ct)) return Request.Status(HttpStatusCode.NotFound);

        // Without storage there is nowhere to put the image, and storing the row anyway
        // leaves a photo that can never load. Fail instead of faking success.
        if (!_blob.Enabled)
            return await Request.Text("Photo storage is not configured.", HttpStatusCode.ServiceUnavailable);

        // Reject early when the client declares an oversize body.
        if (Request.Headers.TryGetValue("Content-Length", out var lenValues)
            && long.TryParse(lenValues.FirstOrDefault(), out var declaredLen)
            && declaredLen > MaxUploadBytes)
            return await Request.Text("Image exceeds the maximum upload size.", HttpStatusCode.RequestEntityTooLarge);

        // Buffer with a hard cap so a chunked/unknown-length body can't exhaust memory.
        using var ms = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await Request.Body.ReadAsync(buffer, ct)) > 0)
        {
            if (ms.Length + read > MaxUploadBytes)
                return await Request.Text("Image exceeds the maximum upload size.", HttpStatusCode.RequestEntityTooLarge);
            await ms.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        var bytes = ms.ToArray();
        if (bytes.Length == 0)
            return await Request.Text("Empty image body.", HttpStatusCode.BadRequest);

        // Idempotency (#10): a stable client mutation id lets a retried/replayed upload
        // (lost response, offline sync) resolve to the original photo instead of storing
        // a duplicate. Check first so a pure replay never re-uploads the blob or re-runs AI.
        Guid? clientMutationId = Request.Headers.TryGetValue("X-Client-Mutation-Id", out var midValues)
            && Guid.TryParse(midValues.FirstOrDefault(), out var parsedMid)
                ? parsedMid : null;
        if (clientMutationId is Guid replayMid
            && await _repo.GetPhotoIdByMutationIdAsync(replayMid, ct) is Guid existingId)
            return await Request.Json(new PhotoUploadResult(existingId, new List<DetectedItem>()), HttpStatusCode.OK);

        var photoId = Guid.NewGuid();
        var (blobUrl, thumbUrl) = await _blob.UploadAsync(containerId, photoId, bytes, ct);
        var storedId = await _repo.AddPhotoAsync(photoId, containerId, blobUrl, thumbUrl, clientMutationId, ct);
        if (storedId != photoId)
        {
            // A concurrent replay won the mutation-id race; the blob we just uploaded is
            // orphaned. Remove it best-effort and return the winning photo.
            await _blob.DeleteAsync(blobUrl, ct);
            if (thumbUrl != blobUrl) await _blob.DeleteAsync(thumbUrl, ct);
            return await Request.Json(new PhotoUploadResult(storedId, new List<DetectedItem>()), HttpStatusCode.OK);
        }

        // Callers can skip AI detection (e.g. "Add photo only") with ?analyze=false.
        var analyze = !string.Equals(
            System.Web.HttpUtility.ParseQueryString(Request.QueryString.Value ?? "")["analyze"],
            "false",
            StringComparison.OrdinalIgnoreCase);

        var detected = analyze
            ? await _vision.DetectAsync(bytes, ct)
            : new List<DetectedItem>();
        return await Request.Json(new PhotoUploadResult(photoId, detected), HttpStatusCode.Created);
    }

    [HttpDelete("/api/photos/{id:guid}")]
    public async Task<IActionResult> Delete(
        Guid id, CancellationToken ct)
    {
        var deleted = await _repo.DeletePhotoAsync(id, ct);
        return Request.Status(deleted ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }

    [HttpPost("/api/photos/{id:guid}/move")]
    public async Task<IActionResult> Move(
        Guid id, CancellationToken ct)
    {
        var input = await Request.ReadFromJsonAsync<MovePhotoInput>();
        if (input is null || input.TargetContainerId == Guid.Empty)
            return await Request.Text("targetContainerId is required.", HttpStatusCode.BadRequest);
        var moved = await _repo.MovePhotoAsync(id, input.TargetContainerId, ct);
        return Request.Status(moved ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }

    [HttpPost("/api/photos/{id:guid}/rotate")]
    public async Task<IActionResult> Rotate(
        Guid id, CancellationToken ct)
    {
        var raw = System.Web.HttpUtility.ParseQueryString(Request.QueryString.Value ?? "")["degrees"];
        var degrees = int.TryParse(raw, out var d) ? ((d % 360) + 360) % 360 : 90;
        if (degrees is not (90 or 180 or 270))
            return await Request.Text("degrees must be 90, 180, or 270.", HttpStatusCode.BadRequest);
        var rotated = await _repo.RotatePhotoAsync(id, degrees, ct);
        return Request.Status(rotated ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }

    /// <summary>
    /// One-time backfill: regenerates small thumbnails for photos uploaded before
    /// thumbnails existed (where ThumbUrl still equals the full BlobUrl). Idempotent —
    /// already-processed photos are skipped on subsequent runs.
    /// </summary>
    [HttpPost("/api/admin/backfill-thumbnails")]
    public async Task<IActionResult> BackfillThumbnails(
        CancellationToken ct)
    {
        var photos = await _repo.ListPhotosNeedingThumbnailAsync(ct);
        int updated = 0, failed = 0;
        foreach (var p in photos)
        {
            var thumbUrl = await _blob.RegenerateThumbnailAsync(p.ContainerId, p.Id, p.BlobUrl, ct);
            if (thumbUrl is not null && thumbUrl != p.BlobUrl)
            {
                await _repo.SetPhotoThumbAsync(p.Id, thumbUrl, ct);
                updated++;
            }
            else
            {
                failed++;
            }
        }
        return await Request.Json(new { total = photos.Count, updated, failed });
    }
}
