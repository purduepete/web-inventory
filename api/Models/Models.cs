namespace WebInventory.Api.Models;

// NOTE: Uses a parameterless constructor with init/settable properties (not a
// positional record) so Dapper can materialize varying projections — including
// the ListContainers query, which returns an extra computed ItemCount column.
public record Container
{
    public Guid Id { get; init; }
    public int Number { get; init; }
    public string Name { get; init; } = "";
    public string? Location { get; init; }
    public string? Notes { get; init; }
    public Guid QrToken { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public int ItemCount { get; set; }
}

public record Item(
    Guid Id,
    Guid ContainerId,
    string Name,
    string? Description,
    int Quantity,
    string Source,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public List<string> Tags { get; set; } = new();
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
    string? Location,
    string? Notes,
    Guid QrToken,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    List<Item> Items,
    List<Photo> Photos);

// ---- request DTOs ----
public record CreateContainerInput(string Name, string? Location, string? Notes);
public record SaveItemInput(string Name, string? Description, int Quantity, List<string>? Tags);
public record MoveItemInput(Guid TargetContainerId);
public record DetectedItem(string Name, string? Description, int Quantity);
public record PhotoUploadResult(Guid PhotoId, List<DetectedItem> Detected);
