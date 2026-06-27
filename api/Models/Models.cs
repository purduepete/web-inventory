namespace WebInventory.Api.Models;

public record Container(
    Guid Id,
    int Number,
    string Name,
    string? Location,
    string? Notes,
    Guid QrToken,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
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
