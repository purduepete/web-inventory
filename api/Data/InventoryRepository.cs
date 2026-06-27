using Dapper;
using WebInventory.Api.Models;

namespace WebInventory.Api.Data;

public sealed class InventoryRepository
{
    private readonly Database _db;

    public InventoryRepository(Database db) => _db = db;

    public async Task<IReadOnlyList<Container>> ListContainersAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var rows = await conn.QueryAsync<Container>(
            @"SELECT c.Id, c.Number, c.Name, c.Location, c.Notes, c.QrToken, c.CreatedAt, c.UpdatedAt,
                     (SELECT COUNT(*) FROM inv.Item i WHERE i.ContainerId = c.Id) AS ItemCount
              FROM inv.Container c
              ORDER BY c.Number;");
        return rows.AsList();
    }

    public async Task<Container?> CreateContainerAsync(CreateContainerInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var id = Guid.NewGuid();
        var token = Guid.NewGuid();
        var container = await conn.QuerySingleAsync<Container>(
            @"INSERT INTO inv.Container (Id, Number, Name, Location, Notes, QrToken)
              OUTPUT inserted.Id, inserted.Number, inserted.Name, inserted.Location,
                     inserted.Notes, inserted.QrToken, inserted.CreatedAt, inserted.UpdatedAt
              VALUES (@id, NEXT VALUE FOR inv.ContainerNumberSeq, @Name, @Location, @Notes, @token);",
            new { id, input.Name, input.Location, input.Notes, token });
        return container;
    }

    public async Task<ContainerWithContents?> GetContainerAsync(Guid id, CancellationToken ct)
        => await GetContainerCoreAsync("c.Id = @id", new { id }, ct);

    public async Task<ContainerWithContents?> GetContainerByTokenAsync(Guid token, CancellationToken ct)
        => await GetContainerCoreAsync("c.QrToken = @token", new { token }, ct);

    private async Task<ContainerWithContents?> GetContainerCoreAsync(string where, object args, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var container = await conn.QuerySingleOrDefaultAsync<Container>(
            $@"SELECT c.Id, c.Number, c.Name, c.Location, c.Notes, c.QrToken, c.CreatedAt, c.UpdatedAt
               FROM inv.Container c WHERE {where};", args);
        if (container is null) return null;

        var items = (await conn.QueryAsync<Item>(
            @"SELECT Id, ContainerId, Name, Description, Quantity, Source, CreatedAt, UpdatedAt
              FROM inv.Item WHERE ContainerId = @id ORDER BY Name;",
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

        return new ContainerWithContents(container.Id, container.Number, container.Name,
            container.Location, container.Notes, container.QrToken, container.CreatedAt,
            container.UpdatedAt, items, photos);
    }

    public async Task<Container?> UpdateContainerAsync(Guid id, CreateContainerInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<Container>(
            @"UPDATE inv.Container SET Name = @Name, Location = @Location, Notes = @Notes, UpdatedAt = SYSUTCDATETIME()
              OUTPUT inserted.Id, inserted.Number, inserted.Name, inserted.Location,
                     inserted.Notes, inserted.QrToken, inserted.CreatedAt, inserted.UpdatedAt
              WHERE Id = @id;",
            new { id, input.Name, input.Location, input.Notes });
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
            @"INSERT INTO inv.Item (Id, ContainerId, Name, Description, Quantity, Source)
              OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                     inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt
              VALUES (@id, @containerId, @Name, @Description, @Quantity, @source);",
            new { id, containerId, input.Name, input.Description, Quantity = Math.Max(1, input.Quantity), source });
        if (item is null) return null;
        await SetTagsAsync(conn, item.Id, input.Tags ?? new());
        item.Tags = input.Tags ?? new();
        return item;
    }

    public async Task<Item?> UpdateItemAsync(Guid itemId, SaveItemInput input, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var item = await conn.QuerySingleOrDefaultAsync<Item>(
            @"UPDATE inv.Item SET Name = @Name, Description = @Description, Quantity = @Quantity, UpdatedAt = SYSUTCDATETIME()
              OUTPUT inserted.Id, inserted.ContainerId, inserted.Name, inserted.Description,
                     inserted.Quantity, inserted.Source, inserted.CreatedAt, inserted.UpdatedAt
              WHERE Id = @itemId;",
            new { itemId, input.Name, input.Description, Quantity = Math.Max(1, input.Quantity) });
        if (item is null) return null;
        await SetTagsAsync(conn, itemId, input.Tags ?? new());
        item.Tags = input.Tags ?? new();
        return item;
    }

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

    public async Task<IReadOnlyList<Item>> SearchAsync(string? q, string? tag, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var items = (await conn.QueryAsync<Item>(
            @"SELECT DISTINCT i.Id, i.ContainerId, i.Name, i.Description, i.Quantity, i.Source, i.CreatedAt, i.UpdatedAt
              FROM inv.Item i
              LEFT JOIN inv.ItemTag it ON it.ItemId = i.Id
              LEFT JOIN inv.Tag t ON t.Id = it.TagId
              WHERE (@q IS NULL OR i.Name LIKE @like OR i.Description LIKE @like)
                AND (@tag IS NULL OR t.Name = @tag)
              ORDER BY i.Name;",
            new { q = string.IsNullOrWhiteSpace(q) ? null : q, like = $"%{q}%", tag = string.IsNullOrWhiteSpace(tag) ? null : tag }))
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

    public async Task AddPhotoAsync(Guid photoId, Guid containerId, string blobUrl, string thumbUrl, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        await conn.ExecuteAsync(
            @"INSERT INTO inv.Photo (Id, ContainerId, BlobUrl, ThumbUrl, ProcessedAt)
              VALUES (@photoId, @containerId, @blobUrl, @thumbUrl, SYSUTCDATETIME());",
            new { photoId, containerId, blobUrl, thumbUrl });
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
}
