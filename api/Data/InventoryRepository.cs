using Dapper;
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
        var id = Guid.NewGuid();
        var token = Guid.NewGuid();
        // Assign the smallest unused positive number so deleted slots get reused
        // (e.g. with 1-3 present, deleting 2 makes the next container 2, then 4).
        await conn.ExecuteAsync(
            @"INSERT INTO inv.Container (Id, Number, Name, LocationId, OwnerId, Notes, QrToken)
              SELECT @id,
                     (SELECT MIN(t.n)
                      FROM (SELECT 1 AS n
                            UNION ALL
                            SELECT Number + 1 FROM inv.Container) t
                      WHERE NOT EXISTS (SELECT 1 FROM inv.Container c WHERE c.Number = t.n)),
                     @Name, @LocationId, @OwnerId, @Notes, @token;",
            new { id, input.Name, input.LocationId, input.OwnerId, input.Notes, token });
        return await conn.QuerySingleOrDefaultAsync<Container>(
            $"{ContainerSelect} WHERE c.Id = @id;", new { id });
    }

    public async Task<ContainerWithContents?> GetContainerAsync(Guid id, CancellationToken ct)
        => await GetContainerCoreAsync("c.Id = @id", new { id }, ct);

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
        await conn.ExecuteAsync(
            @"DELETE FROM inv.ItemTag WHERE ItemId IN (SELECT Id FROM inv.Item WHERE ContainerId = @id);
              DELETE FROM inv.Item WHERE ContainerId = @id;
              DELETE FROM inv.Photo WHERE ContainerId = @id;
              DELETE FROM inv.Container WHERE Id = @id;",
            new { id });
    }

    public async Task<Item?> AddItemAsync(Guid containerId, SaveItemInput input, string source, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var id = Guid.NewGuid();
        var item = await conn.QuerySingleOrDefaultAsync<Item>(
            @"INSERT INTO inv.Item (Id, ContainerId, Name, Description, Quantity, Source, CategoryId)
              OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                     inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt, inserted.CategoryId
              VALUES (@id, @containerId, @Name, @Description, @Quantity, @source, @CategoryId);",
            new { id, containerId, input.Name, input.Description, Quantity = Math.Max(1, input.Quantity), source, input.CategoryId });
        if (item is null) return null;
        await SetTagsAsync(conn, item.Id, input.Tags ?? new());
        item.Tags = input.Tags ?? new();
        item.Category = await CategoryNameAsync(conn, item.CategoryId);
        return item;
    }

    public async Task<Item?> UpdateItemAsync(Guid itemId, SaveItemInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var item = await conn.QuerySingleOrDefaultAsync<Item>(
            @"UPDATE inv.Item SET Name = @Name, Description = @Description, Quantity = @Quantity,
                     CategoryId = @CategoryId, UpdatedAt = SYSUTCDATETIME()
              OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                     inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt, inserted.CategoryId
              WHERE Id = @itemId;",
            new { itemId, input.Name, input.Description, Quantity = Math.Max(1, input.Quantity), input.CategoryId });
        if (item is null) return null;
        await SetTagsAsync(conn, itemId, input.Tags ?? new());
        item.Tags = input.Tags ?? new();
        item.Category = await CategoryNameAsync(conn, item.CategoryId);
        return item;
    }

    private static async Task<string?> CategoryNameAsync(Microsoft.Data.SqlClient.SqlConnection conn, Guid? categoryId)
        => categoryId is null
            ? null
            : await conn.QuerySingleOrDefaultAsync<string?>(
                "SELECT Name FROM inv.Category WHERE Id = @categoryId;", new { categoryId });

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
        await conn.ExecuteAsync(
            @"DELETE FROM inv.ItemTag WHERE ItemId = @itemId;
              DELETE FROM inv.Item WHERE Id = @itemId;", new { itemId });
    }

    public async Task<IReadOnlyList<Item>> SearchAsync(
        string? q, string? tag, Guid? locationId, Guid? ownerId, Guid? categoryId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var items = (await conn.QueryAsync<Item>(
            @"SELECT DISTINCT i.Id, i.ContainerId, i.Name, i.Description, i.Quantity, i.Source, i.CreatedAt, i.UpdatedAt,
                     i.CategoryId, cat.Name AS Category
              FROM inv.Item i
              JOIN inv.Container c ON c.Id = i.ContainerId
              LEFT JOIN inv.ItemTag it ON it.ItemId = i.Id
              LEFT JOIN inv.Tag t ON t.Id = it.TagId
              LEFT JOIN inv.Category cat ON cat.Id = i.CategoryId
              WHERE (@q IS NULL OR i.Name LIKE @like OR i.Description LIKE @like)
                AND (@tag IS NULL OR t.Name = @tag)
                AND (@locationId IS NULL OR c.LocationId = @locationId)
                AND (@ownerId IS NULL OR c.OwnerId = @ownerId)
                AND (@categoryId IS NULL OR i.CategoryId = @categoryId)
              ORDER BY i.Name;",
            new
            {
                q = string.IsNullOrWhiteSpace(q) ? null : q,
                like = $"%{q}%",
                tag = string.IsNullOrWhiteSpace(tag) ? null : tag,
                locationId,
                ownerId,
                categoryId,
            }))
            .AsList();

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
        return items;
    }

    public async Task<IReadOnlyList<string>> ListTagsAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return (await conn.QueryAsync<string>("SELECT Name FROM inv.Tag ORDER BY Name;")).AsList();
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

    public async Task AddPhotoAsync(Guid photoId, Guid containerId, string blobUrl, string thumbUrl, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        await conn.ExecuteAsync(
            @"INSERT INTO inv.Photo (Id, ContainerId, BlobUrl, ThumbUrl, ProcessedAt)
              VALUES (@photoId, @containerId, @blobUrl, @thumbUrl, SYSUTCDATETIME());",
            new { photoId, containerId, blobUrl, thumbUrl });
    }

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

    public async Task<bool> DeletePhotoAsync(Guid photoId, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var urls = await conn.QuerySingleOrDefaultAsync<(string BlobUrl, string ThumbUrl)?>(
            "SELECT BlobUrl, ThumbUrl FROM inv.Photo WHERE Id = @photoId;", new { photoId });
        if (urls is null) return false;

        await _blob.DeleteAsync(urls.Value.BlobUrl, ct);
        if (!string.Equals(urls.Value.ThumbUrl, urls.Value.BlobUrl, StringComparison.OrdinalIgnoreCase))
            await _blob.DeleteAsync(urls.Value.ThumbUrl, ct);

        await conn.ExecuteAsync("DELETE FROM inv.Photo WHERE Id = @photoId;", new { photoId });
        return true;
    }

    private static async Task SetTagsAsync(Microsoft.Data.SqlClient.SqlConnection conn, Guid itemId, List<string> tags)
    {
        await conn.ExecuteAsync("DELETE FROM inv.ItemTag WHERE ItemId = @itemId;", new { itemId });
        foreach (var raw in tags.Select(t => t.Trim()).Where(t => t.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var tagId = await conn.QuerySingleOrDefaultAsync<Guid?>(
                "SELECT Id FROM inv.Tag WHERE Name = @name;", new { name = raw });
            if (tagId is null)
            {
                tagId = Guid.NewGuid();
                await conn.ExecuteAsync(
                    "INSERT INTO inv.Tag (Id, Name) VALUES (@id, @name);",
                    new { id = tagId, name = raw });
            }
            await conn.ExecuteAsync(
                "INSERT INTO inv.ItemTag (ItemId, TagId) VALUES (@itemId, @tagId);",
                new { itemId, tagId });
        }
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
