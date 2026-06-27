using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace WebInventory.Api.Services;

/// <summary>
/// Stores container photos (and a lightweight "thumb" reference) in Blob Storage
/// using managed identity / DefaultAzureCredential — no account keys.
/// </summary>
public sealed class BlobService
{
    private readonly BlobContainerClient _container;
    private readonly bool _enabled;

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
        var service = new BlobServiceClient(new Uri(accountUrl), new DefaultAzureCredential());
        _container = service.GetBlobContainerClient(containerName);
        _enabled = true;
    }

    public bool Enabled => _enabled;

    public async Task<(string blobUrl, string thumbUrl)> UploadAsync(
        Guid containerId, Guid photoId, Stream content, CancellationToken ct)
    {
        if (!_enabled)
            return ($"about:blank#{photoId}", $"about:blank#{photoId}");

        var blobName = $"{containerId}/{photoId}.jpg";
        var blob = _container.GetBlobClient(blobName);
        await blob.UploadAsync(content, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = "image/jpeg" },
        }, ct);
        // v1 uses the same image for full + thumbnail; resize is done client-side.
        var url = blob.Uri.ToString();
        return (url, url);
    }
}
