using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;
using WebInventory.Api.Services;

namespace WebInventory.Api.Functions;

public class PhotoFunctions
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
    [Function("UploadPhoto")]
    public async Task<HttpResponseData> Upload(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "containers/{containerId:guid}/photos")] HttpRequestData req,
        Guid containerId, CancellationToken ct)
    {
        if (!await _repo.ContainerExistsAsync(containerId, ct)) return req.Status(HttpStatusCode.NotFound);

        // Without storage there is nowhere to put the image, and storing the row anyway
        // leaves a photo that can never load. Fail instead of faking success.
        if (!_blob.Enabled)
            return await req.Text("Photo storage is not configured.", HttpStatusCode.ServiceUnavailable);

        // Reject early when the client declares an oversize body.
        if (req.Headers.TryGetValues("Content-Length", out var lenValues)
            && long.TryParse(lenValues.FirstOrDefault(), out var declaredLen)
            && declaredLen > MaxUploadBytes)
            return await req.Text("Image exceeds the maximum upload size.", HttpStatusCode.RequestEntityTooLarge);

        // Buffer with a hard cap so a chunked/unknown-length body can't exhaust memory.
        using var ms = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await req.Body.ReadAsync(buffer, ct)) > 0)
        {
            if (ms.Length + read > MaxUploadBytes)
                return await req.Text("Image exceeds the maximum upload size.", HttpStatusCode.RequestEntityTooLarge);
            await ms.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        var bytes = ms.ToArray();
        if (bytes.Length == 0)
            return await req.Text("Empty image body.", HttpStatusCode.BadRequest);

        // Idempotency (#10): a stable client mutation id lets a retried/replayed upload
        // (lost response, offline sync) resolve to the original photo instead of storing
        // a duplicate. Check first so a pure replay never re-uploads the blob or re-runs AI.
        Guid? clientMutationId = req.Headers.TryGetValues("X-Client-Mutation-Id", out var midValues)
            && Guid.TryParse(midValues.FirstOrDefault(), out var parsedMid)
                ? parsedMid : null;
        if (clientMutationId is Guid replayMid
            && await _repo.GetPhotoIdByMutationIdAsync(replayMid, ct) is Guid existingId)
            return await req.Json(new PhotoUploadResult(existingId, new List<DetectedItem>()), HttpStatusCode.OK);

        var photoId = Guid.NewGuid();
        var (blobUrl, thumbUrl) = await _blob.UploadAsync(containerId, photoId, bytes, ct);
        var storedId = await _repo.AddPhotoAsync(photoId, containerId, blobUrl, thumbUrl, clientMutationId, ct);
        if (storedId != photoId)
        {
            // A concurrent replay won the mutation-id race; the blob we just uploaded is
            // orphaned. Remove it best-effort and return the winning photo.
            await _blob.DeleteAsync(blobUrl, ct);
            if (thumbUrl != blobUrl) await _blob.DeleteAsync(thumbUrl, ct);
            return await req.Json(new PhotoUploadResult(storedId, new List<DetectedItem>()), HttpStatusCode.OK);
        }

        // Callers can skip AI detection (e.g. "Add photo only") with ?analyze=false.
        var analyze = !string.Equals(
            System.Web.HttpUtility.ParseQueryString(req.Url.Query)["analyze"],
            "false",
            StringComparison.OrdinalIgnoreCase);

        var detected = analyze
            ? await _vision.DetectAsync(bytes, ct)
            : new List<DetectedItem>();
        return await req.Json(new PhotoUploadResult(photoId, detected), HttpStatusCode.Created);
    }

    [Function("DeletePhoto")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "photos/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var deleted = await _repo.DeletePhotoAsync(id, ct);
        return req.Status(deleted ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }

    [Function("MovePhoto")]
    public async Task<HttpResponseData> Move(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "photos/{id:guid}/move")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var input = await req.ReadFromJsonAsync<MovePhotoInput>();
        if (input is null || input.TargetContainerId == Guid.Empty)
            return await req.Text("targetContainerId is required.", HttpStatusCode.BadRequest);
        var moved = await _repo.MovePhotoAsync(id, input.TargetContainerId, ct);
        return req.Status(moved ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }

    [Function("RotatePhoto")]
    public async Task<HttpResponseData> Rotate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "photos/{id:guid}/rotate")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var raw = System.Web.HttpUtility.ParseQueryString(req.Url.Query)["degrees"];
        var degrees = int.TryParse(raw, out var d) ? ((d % 360) + 360) % 360 : 90;
        if (degrees is not (90 or 180 or 270))
            return await req.Text("degrees must be 90, 180, or 270.", HttpStatusCode.BadRequest);
        var rotated = await _repo.RotatePhotoAsync(id, degrees, ct);
        return req.Status(rotated ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }

    /// <summary>
    /// One-time backfill: regenerates small thumbnails for photos uploaded before
    /// thumbnails existed (where ThumbUrl still equals the full BlobUrl). Idempotent —
    /// already-processed photos are skipped on subsequent runs.
    /// </summary>
    [Function("BackfillThumbnails")]
    public async Task<HttpResponseData> BackfillThumbnails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "admin/backfill-thumbnails")] HttpRequestData req,
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
        return await req.Json(new { total = photos.Count, updated, failed });
    }
}
