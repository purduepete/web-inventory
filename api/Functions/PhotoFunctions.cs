using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;
using WebInventory.Api.Services;

namespace WebInventory.Api.Functions;

public class PhotoFunctions
{
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
        var container = await _repo.GetContainerAsync(containerId, ct);
        if (container is null) return req.Status(HttpStatusCode.NotFound);

        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        if (bytes.Length == 0)
            return await req.Text("Empty image body.", HttpStatusCode.BadRequest);

        var photoId = Guid.NewGuid();
        var (blobUrl, thumbUrl) = await _blob.UploadAsync(containerId, photoId, bytes, ct);
        await _repo.AddPhotoAsync(photoId, containerId, blobUrl, thumbUrl, ct);

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
}
