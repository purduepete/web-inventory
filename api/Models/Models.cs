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

// ---- users & roles ----
public record AppUser
{
    public Guid Id { get; init; }
    public string Email { get; init; } = "";
    public string Role { get; init; } = "member";
    public string? DisplayName { get; init; }
    public string? InvitedBy { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? LastLoginAt { get; init; }
}

public record InviteUserInput(string Email, string? Role);
public record SetRoleInput(string Role);

/// <summary>
/// The user info Static Web Apps POSTs to the custom roles function after login.
/// </summary>
public sealed class RolesRequest
{
    public string? IdentityProvider { get; set; }
    public string? UserId { get; set; }
    public string? UserDetails { get; set; }
    public RoleClaim[]? Claims { get; set; }
}

public sealed class RoleClaim
{
    public string? Typ { get; set; }
    public string? Val { get; set; }
}

/// <summary>
/// The principal Static Web Apps injects into backend requests via the
/// base64-encoded <c>x-ms-client-principal</c> header.
/// </summary>
public sealed class ClientPrincipal
{
    public string? IdentityProvider { get; set; }
    public string? UserId { get; set; }
    public string? UserDetails { get; set; }
    public string[]? UserRoles { get; set; }
}
