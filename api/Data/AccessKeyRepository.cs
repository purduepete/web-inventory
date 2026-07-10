using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Extensions.Caching.Memory;

namespace WebInventory.Api.Data;

/// <summary>
/// Validates access keys against <c>inv.AccessKey</c>. Only the SHA-256 hash of a
/// key is stored; callers present the raw key (see <see cref="Hash"/>). Any active
/// (not disabled) key grants full access — there are no scopes.
///
/// A short-lived <see cref="IMemoryCache"/> fronts the DB so a now-public endpoint
/// can't be used to hammer the shared Azure SQL database: both positive and
/// negative results are cached, absorbing brute-force / spam.
/// </summary>
public sealed class AccessKeyRepository
{
    private readonly Database _db;
    private readonly IMemoryCache _cache;

    // Cache validation results (valid AND invalid) briefly to blunt abuse.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(3);
    // Don't rewrite LastUsedAt on every request — at most once per hour per key.
    private static readonly TimeSpan UsageUpdateInterval = TimeSpan.FromHours(1);

    public AccessKeyRepository(Database db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    /// <summary>SHA-256 hex digest (64 lowercase chars) of a raw key.</summary>
    public static string Hash(string rawKey)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawKey));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>
    /// True if the raw key matches an active key. Cached for a few minutes; the
    /// (throttled) LastUsedAt touch happens only on a cache miss that hits the DB.
    /// </summary>
    public async Task<bool> IsValidAsync(string rawKey, CancellationToken ct)
    {
        var hash = Hash(rawKey);
        if (_cache.TryGetValue(CacheKey(hash), out bool cached))
            return cached;

        var valid = await LookupAndTouchAsync(hash, ct);
        _cache.Set(CacheKey(hash), valid, CacheTtl);
        return valid;
    }

    private async Task<bool> LookupAndTouchAsync(string hash, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<(Guid Id, DateTime? LastUsedAt)?>(
            @"SELECT Id, LastUsedAt FROM inv.AccessKey
              WHERE KeyHash = @hash AND Disabled = 0;",
            new { hash = new DbString { Value = hash, IsAnsi = true, IsFixedLength = true, Length = 64 } });

        if (row is null)
            return false;

        var now = DateTime.UtcNow;
        if (row.Value.LastUsedAt is null || (now - row.Value.LastUsedAt.Value) >= UsageUpdateInterval)
        {
            await conn.ExecuteAsync(
                "UPDATE inv.AccessKey SET LastUsedAt = @now WHERE Id = @id;",
                new { now, id = row.Value.Id });
        }
        return true;
    }

    private static string CacheKey(string hash) => "accesskey:" + hash;
}
