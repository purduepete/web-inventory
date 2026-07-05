using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace WebInventory.Api.Services;

/// <summary>
/// Stores container photos (and a lightweight "thumb" reference) in Blob Storage
/// using managed identity / DefaultAzureCredential — no account keys.
/// </summary>
public sealed class BlobService
{
    private readonly BlobServiceClient? _service;
    private readonly BlobContainerClient _container;
    private readonly bool _enabled;

    private readonly SemaphoreSlim _udkLock = new(1, 1);
    private UserDelegationKey? _udk;
    private DateTimeOffset _udkExpiry;

    public BlobService()
    {
        var accountUrl = Environment.GetEnvironmentVariable("BlobAccountUrl");
        var containerName = Environment.GetEnvironmentVariable("BlobContainerName") ?? "photos";
        if (string.IsNullOrWhiteSpace(accountUrl) || accountUrl.Contains("<your-"))
        {
            _enabled = false;
            _container = null!;
            return;
        }
        _service = new BlobServiceClient(new Uri(accountUrl), new DefaultAzureCredential());
        _container = _service.GetBlobContainerClient(containerName);
        _enabled = true;
    }

    public bool Enabled => _enabled;

    public async Task<(string blobUrl, string thumbUrl)> UploadAsync(
        Guid containerId, Guid photoId, byte[] bytes, CancellationToken ct)
    {
        if (!_enabled)
            return ($"about:blank#{photoId}", $"about:blank#{photoId}");

        var blob = _container.GetBlobClient($"{containerId}/{photoId}.jpg");
        await blob.UploadAsync(new MemoryStream(bytes), new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = "image/jpeg" },
        }, ct);
        var fullUrl = blob.Uri.ToString();

        // Store a small thumbnail separately so the photo grid loads quickly instead
        // of downloading every full-size image. Falls back to the full image if the
        // bytes can't be decoded.
        var thumbUrl = await TryCreateThumbnailAsync(containerId, photoId, bytes, ct);
        return (fullUrl, thumbUrl ?? fullUrl);
    }

    /// <summary>
    /// Regenerates the small thumbnail for an already-stored full image (used by the
    /// one-time backfill of photos uploaded before thumbnails existed). Returns the
    /// new thumbnail URL, or null if the source can't be read or decoded.
    /// </summary>
    public async Task<string?> RegenerateThumbnailAsync(
        Guid containerId, Guid photoId, string fullBlobUrl, CancellationToken ct)
    {
        if (!_enabled || _service is null || string.IsNullOrWhiteSpace(fullBlobUrl)
            || !Uri.TryCreate(fullBlobUrl, UriKind.Absolute, out var uri)
            || !uri.Host.StartsWith(_service.AccountName + ".", StringComparison.OrdinalIgnoreCase))
            return null;

        var src = _container.GetBlobClient(new BlobUriBuilder(uri).BlobName);
        if (!await src.ExistsAsync(ct)) return null;

        var resp = await src.DownloadContentAsync(ct);
        return await TryCreateThumbnailAsync(containerId, photoId, resp.Value.Content.ToArray(), ct);
    }

    /// <summary>
    /// Rotates an already-stored full image by the given degrees (90/180/270),
    /// overwrites the full blob, and regenerates its thumbnail. Returns the (new)
    /// thumbnail URL, or null if the source can't be read or decoded.
    /// </summary>
    public async Task<string?> RotateAsync(
        Guid containerId, Guid photoId, string fullBlobUrl, int degrees, CancellationToken ct)
    {
        if (!_enabled || _service is null || string.IsNullOrWhiteSpace(fullBlobUrl)
            || !Uri.TryCreate(fullBlobUrl, UriKind.Absolute, out var uri)
            || !uri.Host.StartsWith(_service.AccountName + ".", StringComparison.OrdinalIgnoreCase))
            return null;

        var blob = _container.GetBlobClient(new BlobUriBuilder(uri).BlobName);
        if (!await blob.ExistsAsync(ct)) return null;

        byte[] rotated;
        try
        {
            // Stream the source blob straight into the decoder (P4) rather than
            // materializing the whole image as a byte[] (LOH pressure).
            await using var source = await blob.OpenReadAsync(new BlobOpenReadOptions(false), ct);
            using var image = await Image.LoadAsync(source, ct);
            image.Mutate(x => x.Rotate(degrees));
            using var ms = new MemoryStream();
            await image.SaveAsJpegAsync(ms, new JpegEncoder { Quality = 85 }, ct);
            rotated = ms.ToArray();
        }
        catch
        {
            return null;
        }

        await blob.UploadAsync(new MemoryStream(rotated), new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = "image/jpeg" },
        }, ct);
        return await TryCreateThumbnailAsync(containerId, photoId, rotated, ct);
    }

    /// <summary>
    /// Builds a ~320px JPEG thumbnail from the given image bytes and uploads it as a
    /// separate blob. Returns the thumbnail URL, or null if the bytes can't be decoded.
    /// </summary>
    private async Task<string?> TryCreateThumbnailAsync(
        Guid containerId, Guid photoId, byte[] bytes, CancellationToken ct)
    {
        try
        {
            using var image = Image.Load(bytes);
            image.Mutate(x => x.Resize(new ResizeOptions
            {
                Mode = ResizeMode.Max,
                Size = new Size(320, 320),
            }));
            using var thumbMs = new MemoryStream();
            await image.SaveAsJpegAsync(thumbMs, new JpegEncoder { Quality = 70 }, ct);
            thumbMs.Position = 0;

            var thumbBlob = _container.GetBlobClient($"{containerId}/{photoId}_thumb.jpg");
            await thumbBlob.UploadAsync(thumbMs, new BlobUploadOptions
            {
                HttpHeaders = new BlobHttpHeaders { ContentType = "image/jpeg" },
            }, ct);
            return thumbBlob.Uri.ToString();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Deletes the stored blob for a given blob URL. No-ops when storage is disabled
    /// or the URL doesn't belong to this account (e.g. the local "about:blank" stub).
    /// </summary>
    public async Task DeleteAsync(string blobUrl, CancellationToken ct)
    {
        if (!_enabled || _service is null || string.IsNullOrWhiteSpace(blobUrl)
            || !Uri.TryCreate(blobUrl, UriKind.Absolute, out var uri)
            || !uri.Host.StartsWith(_service.AccountName + ".", StringComparison.OrdinalIgnoreCase))
            return;

        var builder = new BlobUriBuilder(uri);
        var blob = _container.GetBlobClient(builder.BlobName);
        await blob.DeleteIfExistsAsync(DeleteSnapshotsOption.IncludeSnapshots, cancellationToken: ct);
    }

    /// <summary>
    /// Returns a read-only, short-lived user-delegation SAS URL for a stored blob so
    /// the browser can load it without the container being publicly accessible.
    /// Non-account URLs (or when disabled) are returned unchanged.
    /// </summary>
    public async Task<string> SignReadUrlAsync(string blobUrl, CancellationToken ct)
    {
        if (!_enabled || _service is null || string.IsNullOrWhiteSpace(blobUrl)
            || !Uri.TryCreate(blobUrl, UriKind.Absolute, out var uri)
            || !uri.Host.StartsWith(_service.AccountName + ".", StringComparison.OrdinalIgnoreCase))
            return blobUrl;

        var key = await GetDelegationKeyAsync(ct);
        var builder = new BlobUriBuilder(uri);
        var sas = new BlobSasBuilder
        {
            BlobContainerName = builder.BlobContainerName,
            BlobName = builder.BlobName,
            Resource = "b",
            StartsOn = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresOn = DateTimeOffset.UtcNow.AddHours(1),
        };
        sas.SetPermissions(BlobSasPermissions.Read);
        builder.Sas = sas.ToSasQueryParameters(key, _service.AccountName);
        return builder.ToUri().ToString();
    }

    private async Task<UserDelegationKey> GetDelegationKeyAsync(CancellationToken ct)
    {
        if (_udk is not null && _udkExpiry > DateTimeOffset.UtcNow.AddMinutes(5))
            return _udk;
        await _udkLock.WaitAsync(ct);
        try
        {
            if (_udk is null || _udkExpiry <= DateTimeOffset.UtcNow.AddMinutes(5))
            {
                var expiry = DateTimeOffset.UtcNow.AddHours(6);
                _udk = (await _service!.GetUserDelegationKeyAsync(
                    DateTimeOffset.UtcNow.AddMinutes(-5), expiry, ct)).Value;
                _udkExpiry = expiry;
            }
            return _udk;
        }
        finally { _udkLock.Release(); }
    }
}
