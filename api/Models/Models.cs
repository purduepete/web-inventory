namespace WebInventory.Api.Models;

// NOTE: Uses a parameterless constructor with init/settable properties (not a
// positional record) so Dapper can materialize varying projections — including
// the ListContainers query, which returns an extra computed ItemCount column.
public record Container
{
    public Guid Id { get; init; }
    public int Number { get; init; }
    public string Name { get; init; } = "";
    public Guid? LocationId { get; init; }
    public string? Location { get; init; }
    public Guid? OwnerId { get; init; }
    public string? Owner { get; init; }
    public string? Notes { get; init; }
    public Guid QrToken { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public int ItemCount { get; set; }
}

public record Item
{
    public Guid Id { get; set; }
    public Guid ContainerId { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int Quantity { get; set; }
    public string Source { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<string> Tags { get; set; } = new();
    public Guid? CategoryId { get; set; }
    public string? Category { get; set; }
}

public record Photo(
    Guid Id,
    Guid ContainerId,
    string BlobUrl,
    string ThumbUrl,
    DateTime TakenAt,
    DateTime? ProcessedAt);

public record ContainerWithContents(
    Guid Id,
    int Number,
    string Name,
    Guid? LocationId,
    string? Location,
    Guid? OwnerId,
    string? Owner,
    string? Notes,
    Guid QrToken,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    List<Item> Items,
    List<Photo> Photos);

public record Lookup(Guid Id, string Name);

// ---- request DTOs ----
public record CreateContainerInput(string Name, Guid? LocationId, Guid? OwnerId, string? Notes);
public record SaveItemInput(string Name, string? Description, int Quantity, List<string>? Tags, Guid? CategoryId);
public record MoveItemInput(Guid TargetContainerId);
public record MovePhotoInput(Guid TargetContainerId);

public sealed class PhotoBackfillRow
{
    public Guid Id { get; set; }
    public Guid ContainerId { get; set; }
    public string BlobUrl { get; set; } = "";
}

public sealed class FacetRow
{
    public Guid? OwnerId { get; set; }
    public Guid? LocationId { get; set; }
    public Guid? CategoryId { get; set; }
}
public record LookupInput(string Name);
public record DetectedItem(string Name, string? Description, int Quantity);
public record PhotoUploadResult(Guid PhotoId, List<DetectedItem> Detected);
