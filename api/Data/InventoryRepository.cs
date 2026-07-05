using System.Data;
using System.Data.Common;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using WebInventory.Api.Models;
using WebInventory.Api.Services;

namespace WebInventory.Api.Data;

public sealed class InventoryRepository
{
    private readonly Database _db;
    private readonly BlobService _blob;

    public InventoryRepository(Database db, BlobService blob)
    {
        _db = db;
        _blob = blob;
    }

    // SQL Server error numbers we retry on: unique-constraint (2627), unique-index (2601)
    // and deadlock victim (1205).
    private static bool IsRetryable(SqlException ex) => ex.Number is 2627 or 2601 or 1205;

    private const string ContainerSelect =
        @"SELECT c.Id, c.Number, c.Name, c.LocationId, l.Name AS Location, c.OwnerId, o.Name AS Owner,
                 c.Notes, c.QrToken, c.CreatedAt, c.UpdatedAt
          FROM inv.Container c
          LEFT JOIN inv.Location l ON l.Id = c.LocationId
          LEFT JOIN inv.Owner o ON o.Id = c.OwnerId";

    public async Task<IReadOnlyList<Container>> ListContainersAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var rows = await conn.QueryAsync<Container>(
            @"SELECT c.Id, c.Number, c.Name, c.LocationId, l.Name AS Location, c.OwnerId, o.Name AS Owner,
                     c.Notes, c.QrToken, c.CreatedAt, c.UpdatedAt,
                     (SELECT COUNT(*) FROM inv.Item i WHERE i.ContainerId = c.Id) AS ItemCount
              FROM inv.Container c
              LEFT JOIN inv.Location l ON l.Id = c.LocationId
              LEFT JOIN inv.Owner o ON o.Id = c.OwnerId
              ORDER BY c.Number;");
        return rows.AsList();
    }

    public async Task<Container?> CreateContainerAsync(CreateContainerInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var token = Guid.NewGuid();
        // Assign the smallest unused positive number so deleted slots get reused
        // (e.g. with 1-3 present, deleting 2 makes the next container 2, then 4).
        // The gap scan + insert run in a SERIALIZABLE transaction so concurrent creates
        // can't compute the same number; the UNIQUE constraint on Number (migration 007)
        // is a hard backstop and any loser/deadlock victim simply retries.
        for (var attempt = 0; ; attempt++)
        {
            // Idempotency (B2): if this create was already applied under the same
            // client mutation id (an offline-sync replay after a lost response),
            // return the existing container instead of creating a duplicate.
            if (input.ClientMutationId is Guid mid)
            {
                var existing = await conn.QuerySingleOrDefaultAsync<Container>(
                    $"{ContainerSelect} WHERE c.ClientMutationId = @mid;", new { mid });
                if (existing is not null) return existing;
            }

            var id = Guid.NewGuid();
            await using var tx = await conn.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            try
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    @"INSERT INTO inv.Container (Id, Number, Name, LocationId, OwnerId, Notes, QrToken, ClientMutationId)
                      SELECT @id,
                             (SELECT MIN(t.n)
                              FROM (SELECT 1 AS n
                                    UNION ALL
                                    SELECT Number + 1 FROM inv.Container) t
                              WHERE NOT EXISTS (SELECT 1 FROM inv.Container c WHERE c.Number = t.n)),
                             @Name, @LocationId, @OwnerId, @Notes, @token, @ClientMutationId;",
                    new { id, input.Name, input.LocationId, input.OwnerId, input.Notes, token, input.ClientMutationId },
                    transaction: tx, cancellationToken: ct));
                await tx.CommitAsync(ct);
                return await conn.QuerySingleOrDefaultAsync<Container>(
                    $"{ContainerSelect} WHERE c.Id = @id;", new { id });
            }
            catch (SqlException ex) when (IsRetryable(ex) && attempt < 5)
            {
                // A deadlock victim (1205) is already rolled back, so guard the rollback.
                // A unique violation on the mutation-id index means a concurrent replay
                // won the race; the next loop's idempotency check returns that row.
                try { await tx.RollbackAsync(ct); } catch { /* already rolled back */ }
                await Task.Delay(20 * (attempt + 1), ct);
            }
        }
    }

    public async Task<ContainerWithContents?> GetContainerAsync(Guid id, CancellationToken ct)
        => await GetContainerCoreAsync("c.Id = @id", new { id }, ct);

    // Lightweight existence check (P2): the photo-upload path only needs to know the
    // container exists, so avoid GetContainerAsync loading items/photos and signing SAS URLs.
    public async Task<bool> ContainerExistsAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
            "SELECT 1 FROM inv.Container WHERE Id = @id;", new { id }, cancellationToken: ct)) is not null;
    }

    public async Task<ContainerWithContents?> GetContainerByTokenAsync(Guid token, CancellationToken ct)
        => await GetContainerCoreAsync("c.QrToken = @token", new { token }, ct);

    private async Task<ContainerWithContents?> GetContainerCoreAsync(string where, object args, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var container = await conn.QuerySingleOrDefaultAsync<Container>(
            $"{ContainerSelect} WHERE {where};", args);
        if (container is null) return null;

        var items = (await conn.QueryAsync<Item>(
            @"SELECT i.Id, i.ContainerId, i.Name, i.Description, i.Quantity, i.Source, i.CreatedAt, i.UpdatedAt,
                     i.CategoryId, cat.Name AS Category
              FROM inv.Item i
              LEFT JOIN inv.Category cat ON cat.Id = i.CategoryId
              WHERE i.ContainerId = @id ORDER BY i.Name;",
            new { id = container.Id })).AsList();

        var tagRows = await conn.QueryAsync<(Guid ItemId, string Name)>(
            @"SELECT it.ItemId, t.Name
              FROM inv.ItemTag it
              JOIN inv.Tag t ON t.Id = it.TagId
              JOIN inv.Item i ON i.Id = it.ItemId
              WHERE i.ContainerId = @id;",
            new { id = container.Id });
        var tagsByItem = tagRows.GroupBy(r => r.ItemId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Name).ToList());
        foreach (var item in items)
            if (tagsByItem.TryGetValue(item.Id, out var tags)) item.Tags = tags;

        var photos = (await conn.QueryAsync<Photo>(
            @"SELECT Id, ContainerId, BlobUrl, ThumbUrl, TakenAt, ProcessedAt
              FROM inv.Photo WHERE ContainerId = @id ORDER BY TakenAt DESC;",
            new { id = container.Id })).AsList();

        // Hand the browser short-lived SAS URLs so the (private) blobs can render.
        for (var i = 0; i < photos.Count; i++)
            photos[i] = photos[i] with
            {
                BlobUrl = await _blob.SignReadUrlAsync(photos[i].BlobUrl, ct),
                ThumbUrl = await _blob.SignReadUrlAsync(photos[i].ThumbUrl, ct),
            };

        return new ContainerWithContents(container.Id, container.Number, container.Name,
            container.LocationId, container.Location, container.OwnerId, container.Owner,
            container.Notes, container.QrToken, container.CreatedAt,
            container.UpdatedAt, items, photos);
    }

    public async Task<Container?> UpdateContainerAsync(Guid id, CreateContainerInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var affected = await conn.ExecuteAsync(
            @"UPDATE inv.Container
              SET Name = @Name, LocationId = @LocationId, OwnerId = @OwnerId, Notes = @Notes, UpdatedAt = SYSUTCDATETIME()
              WHERE Id = @id;",
            new { id, input.Name, input.LocationId, input.OwnerId, input.Notes });
        if (affected == 0) return null;
        return await conn.QuerySingleOrDefaultAsync<Container>(
            $"{ContainerSelect} WHERE c.Id = @id;", new { id });
    }

    public async Task DeleteContainerAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);

        // Capture blob URLs before the rows are gone so storage can be cleaned up after commit.
        var photoUrls = (await conn.QueryAsync<(string BlobUrl, string ThumbUrl)>(
            "SELECT BlobUrl, ThumbUrl FROM inv.Photo WHERE ContainerId = @id;", new { id })).AsList();

        await using (var tx = await conn.BeginTransactionAsync(ct))
        {
            await conn.ExecuteAsync(new CommandDefinition(
                @"DELETE FROM inv.ItemTag WHERE ItemId IN (SELECT Id FROM inv.Item WHERE ContainerId = @id);
                  DELETE FROM inv.Item WHERE ContainerId = @id;
                  DELETE FROM inv.Photo WHERE ContainerId = @id;
                  DELETE FROM inv.Container WHERE Id = @id;",
                new { id }, transaction: tx, cancellationToken: ct));
            await tx.CommitAsync(ct);
        }

        // DB is now consistent; best-effort remove the orphaned blobs.
        await DeleteBlobsBestEffortAsync(photoUrls, ct);
    }

    // Best-effort blob cleanup used after the DB rows are already gone. Dedupes blob/thumb
    // pairs and never throws — a failed delete just leaves a recoverable orphan.
    private async Task DeleteBlobsBestEffortAsync(IEnumerable<(string BlobUrl, string ThumbUrl)> photos, CancellationToken ct)
    {
        var urls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (blobUrl, thumbUrl) in photos)
        {
            if (!string.IsNullOrWhiteSpace(blobUrl)) urls.Add(blobUrl);
            if (!string.IsNullOrWhiteSpace(thumbUrl)) urls.Add(thumbUrl);
        }
        foreach (var url in urls)
        {
            try { await _blob.DeleteAsync(url, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { /* leave orphan for later cleanup */ }
        }
    }

    public async Task<Item?> AddItemAsync(Guid containerId, SaveItemInput input, string source, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);

        // Idempotency (B2): a replayed offline-sync create returns the item that was
        // already inserted under the same client mutation id rather than duplicating it.
        if (input.ClientMutationId is Guid mid)
        {
            var existing = await LoadItemByMutationIdAsync(conn, null, mid, ct);
            if (existing is not null) return existing;
        }

        await using var tx = await conn.BeginTransactionAsync(ct);
        var id = Guid.NewGuid();
        Item? item;
        try
        {
            item = await conn.QuerySingleOrDefaultAsync<Item>(new CommandDefinition(
                @"INSERT INTO inv.Item (Id, ContainerId, Name, Description, Quantity, Source, CategoryId, ClientMutationId)
                  OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                         inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt, inserted.CategoryId
                  VALUES (@id, @containerId, @Name, @Description, @Quantity, @source, @CategoryId, @ClientMutationId);",
                new { id, containerId, input.Name, input.Description, Quantity = Math.Max(1, input.Quantity), source, input.CategoryId, input.ClientMutationId },
                transaction: tx, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601 && input.ClientMutationId is Guid raceMid)
        {
            // A concurrent replay won the mutation-id race; roll back and return its row.
            try { await tx.RollbackAsync(ct); } catch { /* already rolled back */ }
            return await LoadItemByMutationIdAsync(conn, null, raceMid, ct);
        }
        if (item is null)
        {
            await tx.RollbackAsync(ct);
            return null;
        }
        await SetTagsAsync(conn, tx, item.Id, input.Tags ?? new(), ct);
        item.Category = await CategoryNameAsync(conn, tx, item.CategoryId, ct);
        await tx.CommitAsync(ct);
        item.Tags = input.Tags ?? new();
        return item;
    }

    // Loads an item (with its tags) by the client mutation id used to create it, for B2
    // idempotent-replay handling. Returns null when no item carries that id.
    private static async Task<Item?> LoadItemByMutationIdAsync(SqlConnection conn, DbTransaction? tx, Guid mid, CancellationToken ct)
    {
        var item = await conn.QuerySingleOrDefaultAsync<Item>(new CommandDefinition(
            @"SELECT i.Id, i.ContainerId, i.Name, i.Description, i.Quantity, i.Source, i.CreatedAt, i.UpdatedAt,
                     i.CategoryId, cat.Name AS Category
              FROM inv.Item i
              LEFT JOIN inv.Category cat ON cat.Id = i.CategoryId
              WHERE i.ClientMutationId = @mid;",
            new { mid }, transaction: tx, cancellationToken: ct));
        if (item is null) return null;
        item.Tags = (await conn.QueryAsync<string>(new CommandDefinition(
            @"SELECT t.Name FROM inv.ItemTag it
              JOIN inv.Tag t ON t.Id = it.TagId
              WHERE it.ItemId = @id ORDER BY t.Name;",
            new { id = item.Id }, transaction: tx, cancellationToken: ct))).AsList();
        return item;
    }

    public async Task<Item?> UpdateItemAsync(Guid itemId, SaveItemInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var item = await conn.QuerySingleOrDefaultAsync<Item>(new CommandDefinition(
            @"UPDATE inv.Item SET Name = @Name, Description = @Description, Quantity = @Quantity,
                     CategoryId = @CategoryId, UpdatedAt = SYSUTCDATETIME()
              OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                     inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt, inserted.CategoryId
              WHERE Id = @itemId;",
            new { itemId, input.Name, input.Description, Quantity = Math.Max(1, input.Quantity), input.CategoryId },
            transaction: tx, cancellationToken: ct));
        if (item is null)
        {
            await tx.RollbackAsync(ct);
            return null;
        }
        await SetTagsAsync(conn, tx, itemId, input.Tags ?? new(), ct);
        item.Category = await CategoryNameAsync(conn, tx, item.CategoryId, ct);
        await tx.CommitAsync(ct);
        item.Tags = input.Tags ?? new();
        return item;
    }

    private static async Task<string?> CategoryNameAsync(SqlConnection conn, DbTransaction? tx, Guid? categoryId, CancellationToken ct)
        => categoryId is null
            ? null
            : await conn.QuerySingleOrDefaultAsync<string?>(new CommandDefinition(
                "SELECT Name FROM inv.Category WHERE Id = @categoryId;", new { categoryId },
                transaction: tx, cancellationToken: ct));

    public async Task<Item?> MoveItemAsync(Guid itemId, Guid targetContainerId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<Item>(
            @"UPDATE inv.Item SET ContainerId = @targetContainerId, UpdatedAt = SYSUTCDATETIME()
              OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                     inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt
              WHERE Id = @itemId AND EXISTS (SELECT 1 FROM inv.Container WHERE Id = @targetContainerId);",
            new { itemId, targetContainerId });
    }

    public async Task DeleteItemAsync(Guid itemId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            @"DELETE FROM inv.ItemTag WHERE ItemId = @itemId;
              DELETE FROM inv.Item WHERE Id = @itemId;", new { itemId },
            transaction: tx, cancellationToken: ct));
        await tx.CommitAsync(ct);
    }

    // Escape LIKE metacharacters so a user's literal text (%, _, [, \) doesn't act as
    // a wildcard. Pairs with the ESCAPE '\' clause in SearchAsync.
    private static string EscapeLike(string? value)
        => (value ?? string.Empty)
            .Replace("\\", "\\\\")
            .Replace("%", "\\%")
            .Replace("_", "\\_")
            .Replace("[", "\\[");

    // Search is paged (P1): an unbounded LIKE '%term%' over a growing item table
    // could return thousands of rows plus a tag fetch. Callers pass skip/take; we
    // read one extra row to report HasMore without a second COUNT query. The tag
    // filter uses EXISTS (not a join) so no DISTINCT is needed and OFFSET/FETCH
    // pages deterministically (ORDER BY Name, Id).
    public const int DefaultSearchTake = 100;
    public const int MaxSearchTake = 200;

    public async Task<SearchResult> SearchAsync(
        string? q, string? tag, Guid? locationId, Guid? ownerId, Guid? categoryId,
        int skip, int take, CancellationToken ct)
    {
        if (skip < 0) skip = 0;
        take = Math.Clamp(take, 1, MaxSearchTake);

        await using var conn = await _db.OpenAsync(ct);
        var rows = (await conn.QueryAsync<Item>(
            @"SELECT i.Id, i.ContainerId, i.Name, i.Description, i.Quantity, i.Source, i.CreatedAt, i.UpdatedAt,
                     i.CategoryId, cat.Name AS Category
              FROM inv.Item i
              JOIN inv.Container c ON c.Id = i.ContainerId
              LEFT JOIN inv.Category cat ON cat.Id = i.CategoryId
              WHERE (@q IS NULL OR i.Name LIKE @like ESCAPE '\' OR i.Description LIKE @like ESCAPE '\')
                AND (@tag IS NULL OR EXISTS (
                        SELECT 1 FROM inv.ItemTag it JOIN inv.Tag t ON t.Id = it.TagId
                        WHERE it.ItemId = i.Id AND t.Name = @tag))
                AND (@locationId IS NULL OR c.LocationId = @locationId)
                AND (@ownerId IS NULL OR c.OwnerId = @ownerId)
                AND (@categoryId IS NULL OR i.CategoryId = @categoryId)
              ORDER BY i.Name, i.Id
              OFFSET @skip ROWS FETCH NEXT @takePlusOne ROWS ONLY;",
            new
            {
                q = string.IsNullOrWhiteSpace(q) ? null : q,
                like = $"%{EscapeLike(q)}%",
                tag = string.IsNullOrWhiteSpace(tag) ? null : tag,
                locationId,
                ownerId,
                categoryId,
                skip,
                takePlusOne = take + 1,
            }))
            .AsList();

        var hasMore = rows.Count > take;
        var items = hasMore ? rows.GetRange(0, take) : rows;

        if (items.Count > 0)
        {
            var ids = items.Select(i => i.Id).ToArray();
            var tagRows = await conn.QueryAsync<(Guid ItemId, string Name)>(
                @"SELECT it.ItemId, t.Name FROM inv.ItemTag it JOIN inv.Tag t ON t.Id = it.TagId
                  WHERE it.ItemId IN @ids;", new { ids });
            var map = tagRows.GroupBy(r => r.ItemId).ToDictionary(g => g.Key, g => g.Select(x => x.Name).ToList());
            foreach (var item in items)
                if (map.TryGetValue(item.Id, out var tg)) item.Tags = tg;
        }
        return new SearchResult(items, hasMore);
    }

    public async Task<IReadOnlyList<string>> ListTagsAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return (await conn.QueryAsync<string>(
            @"SELECT t.Name FROM inv.Tag t
              JOIN inv.ItemTag it ON it.TagId = t.Id
              GROUP BY t.Name ORDER BY t.Name;")).AsList();
    }

    /// <summary>
    /// Distinct owner/location/category combinations that actually have an item, so the
    /// search filters can cascade (picking an owner narrows the available locations, etc.).
    /// </summary>
    public async Task<IReadOnlyList<FacetRow>> ListFacetsAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return (await conn.QueryAsync<FacetRow>(
            @"SELECT DISTINCT c.OwnerId, c.LocationId, i.CategoryId
              FROM inv.Container c
              JOIN inv.Item i ON i.ContainerId = c.Id;")).AsList();
    }

    public async Task<Guid> AddPhotoAsync(Guid photoId, Guid containerId, string blobUrl, string thumbUrl, Guid? clientMutationId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);

        // Idempotency (#10): a replayed offline-sync upload returns the photo already
        // stored under the same client mutation id rather than inserting a duplicate.
        if (clientMutationId is Guid mid)
        {
            var existing = await PhotoIdByMutationIdAsync(conn, mid, ct);
            if (existing is Guid e) return e;
        }

        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                @"INSERT INTO inv.Photo (Id, ContainerId, BlobUrl, ThumbUrl, ProcessedAt, ClientMutationId)
                  VALUES (@photoId, @containerId, @blobUrl, @thumbUrl, SYSUTCDATETIME(), @clientMutationId);",
                new { photoId, containerId, blobUrl, thumbUrl, clientMutationId }, cancellationToken: ct));
            return photoId;
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601 && clientMutationId is Guid raceMid)
        {
            // A concurrent replay won the mutation-id race; return its row. The caller's
            // just-uploaded blob is now an orphan and is cleaned up best-effort there.
            var existing = await PhotoIdByMutationIdAsync(conn, raceMid, ct);
            return existing ?? photoId;
        }
    }

    /// <summary>
    /// Returns the id of the photo stored under a given client mutation id, for #10
    /// idempotent-replay handling; null when no photo carries that id.
    /// </summary>
    public async Task<Guid?> GetPhotoIdByMutationIdAsync(Guid clientMutationId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return await PhotoIdByMutationIdAsync(conn, clientMutationId, ct);
    }

    private static async Task<Guid?> PhotoIdByMutationIdAsync(SqlConnection conn, Guid mid, CancellationToken ct)
        => await conn.QuerySingleOrDefaultAsync<Guid?>(new CommandDefinition(
            "SELECT Id FROM inv.Photo WHERE ClientMutationId = @mid;",
            new { mid }, cancellationToken: ct));

    public async Task<bool> MovePhotoAsync(Guid photoId, Guid targetContainerId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var rows = await conn.ExecuteAsync(
            @"UPDATE inv.Photo SET ContainerId = @targetContainerId
              WHERE Id = @photoId AND EXISTS (SELECT 1 FROM inv.Container WHERE Id = @targetContainerId);",
            new { photoId, targetContainerId });
        return rows > 0;
    }

    /// <summary>Photos whose thumbnail still points at the full image (pre-thumbnail uploads).</summary>
    public async Task<IReadOnlyList<PhotoBackfillRow>> ListPhotosNeedingThumbnailAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return (await conn.QueryAsync<PhotoBackfillRow>(
            @"SELECT Id, ContainerId, BlobUrl FROM inv.Photo
              WHERE ThumbUrl = BlobUrl AND BlobUrl LIKE 'http%';")).AsList();
    }

    public async Task SetPhotoThumbAsync(Guid photoId, string thumbUrl, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE inv.Photo SET ThumbUrl = @thumbUrl WHERE Id = @photoId;",
            new { photoId, thumbUrl });
    }

    /// <summary>Rotates a stored photo 90/180/270 degrees, regenerating its thumbnail.</summary>
    public async Task<bool> RotatePhotoAsync(Guid photoId, int degrees, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<(Guid ContainerId, string BlobUrl)?>(
            "SELECT ContainerId, BlobUrl FROM inv.Photo WHERE Id = @photoId;", new { photoId });
        if (row is null) return false;
        var thumbUrl = await _blob.RotateAsync(row.Value.ContainerId, photoId, row.Value.BlobUrl, degrees, ct);
        if (thumbUrl is null) return false;
        await conn.ExecuteAsync(
            "UPDATE inv.Photo SET ThumbUrl = @thumbUrl WHERE Id = @photoId;", new { photoId, thumbUrl });
        return true;
    }

    public async Task<bool> DeletePhotoAsync(Guid photoId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var urls = await conn.QuerySingleOrDefaultAsync<(string BlobUrl, string ThumbUrl)?>(
            "SELECT BlobUrl, ThumbUrl FROM inv.Photo WHERE Id = @photoId;", new { photoId });
        if (urls is null) return false;

        // Remove the DB row FIRST: an orphaned blob is recoverable, but a row pointing at a
        // deleted blob breaks reads. Blob cleanup is best-effort afterwards.
        var deleted = await conn.ExecuteAsync("DELETE FROM inv.Photo WHERE Id = @photoId;", new { photoId });
        if (deleted == 0) return false;

        await DeleteBlobsBestEffortAsync(new[] { (urls.Value.BlobUrl, urls.Value.ThumbUrl) }, ct);
        return true;
    }

    // Replaces an item's tags in one set-based, transactional round trip. The MERGE ... WITH
    // (HOLDLOCK) upsert is race-safe: concurrent requests creating the same new tag serialize
    // instead of colliding on UQ_inv_Tag_Name.
    private static async Task SetTagsAsync(SqlConnection conn, DbTransaction tx, Guid itemId, List<string> tags, CancellationToken ct)
    {
        var names = tags.Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var namesJson = JsonSerializer.Serialize(names);

        await conn.ExecuteAsync(new CommandDefinition(
            @"DELETE FROM inv.ItemTag WHERE ItemId = @itemId;

              IF @namesJson <> '[]'
              BEGIN
                  MERGE inv.Tag WITH (UPDLOCK, HOLDLOCK) AS tgt
                  USING (SELECT DISTINCT LTRIM(RTRIM(value)) AS Name FROM OPENJSON(@namesJson)) AS src
                        ON tgt.Name = src.Name
                  WHEN NOT MATCHED THEN INSERT (Id, Name) VALUES (NEWID(), src.Name);

                  INSERT INTO inv.ItemTag (ItemId, TagId)
                  SELECT @itemId, t.Id
                  FROM inv.Tag t
                  WHERE t.Name IN (SELECT DISTINCT LTRIM(RTRIM(value)) FROM OPENJSON(@namesJson));
              END",
            new { itemId, namesJson }, transaction: tx, cancellationToken: ct));
    }

    // ---- Managed lookup lists (owners / locations / categories) ----

    private static string LookupTable(string kind) => kind switch
    {
        "owners" => "inv.Owner",
        "locations" => "inv.Location",
        "categories" => "inv.Category",
        _ => throw new ArgumentException($"Unknown lookup kind '{kind}'.", nameof(kind)),
    };

    public async Task<IReadOnlyList<Lookup>> ListLookupAsync(string kind, CancellationToken ct)
    {
        var table = LookupTable(kind);
        await using var conn = await _db.OpenAsync(ct);
        return (await conn.QueryAsync<Lookup>(
            $"SELECT Id, Name FROM {table} ORDER BY Name;")).AsList();
    }

    public async Task<Lookup?> CreateLookupAsync(string kind, string name, CancellationToken ct)
    {
        var table = LookupTable(kind);
        name = name.Trim();
        if (name.Length == 0) return null;
        await using var conn = await _db.OpenAsync(ct);
        var existing = await conn.QuerySingleOrDefaultAsync<Lookup>(
            $"SELECT Id, Name FROM {table} WHERE Name = @name;", new { name });
        if (existing is not null) return existing;
        var id = Guid.NewGuid();
        await conn.ExecuteAsync($"INSERT INTO {table} (Id, Name) VALUES (@id, @name);", new { id, name });
        return new Lookup(id, name);
    }

    public async Task<Lookup?> RenameLookupAsync(string kind, Guid id, string name, CancellationToken ct)
    {
        var table = LookupTable(kind);
        name = name.Trim();
        if (name.Length == 0) return null;
        await using var conn = await _db.OpenAsync(ct);
        var affected = await conn.ExecuteAsync(
            $"UPDATE {table} SET Name = @name WHERE Id = @id;", new { id, name });
        return affected == 0 ? null : new Lookup(id, name);
    }

    public async Task<bool> DeleteLookupAsync(string kind, Guid id, CancellationToken ct)
    {
        var table = LookupTable(kind);
        await using var conn = await _db.OpenAsync(ct);
        // Null out references first so the foreign keys don't block the delete.
        var detach = kind switch
        {
            "owners" => "UPDATE inv.Container SET OwnerId = NULL WHERE OwnerId = @id;",
            "locations" => "UPDATE inv.Container SET LocationId = NULL WHERE LocationId = @id;",
            "categories" => "UPDATE inv.Item SET CategoryId = NULL WHERE CategoryId = @id;",
            _ => throw new ArgumentException($"Unknown lookup kind '{kind}'.", nameof(kind)),
        };
        var affected = await conn.ExecuteAsync(
            $"{detach} DELETE FROM {table} WHERE Id = @id;", new { id });
        return affected > 0;
    }
}
