using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;

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
