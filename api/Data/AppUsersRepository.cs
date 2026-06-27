using Dapper;
using WebInventory.Api.Models;

namespace WebInventory.Api.Data;

/// <summary>
/// Manages application users and their roles in the <c>inv.AppUser</c> table.
/// An admin pre-authorizes household members by email; the custom roles
/// function resolves those records into Static Web Apps roles at login.
/// </summary>
public sealed class AppUsersRepository
{
    private readonly Database _db;

    public AppUsersRepository(Database db) => _db = db;

    private const string Columns =
        "Id, Email, Role, DisplayName, InvitedBy, CreatedAt, LastLoginAt";

    public async Task<IReadOnlyList<AppUser>> ListAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var rows = await conn.QueryAsync<AppUser>(
            $"SELECT {Columns} FROM inv.AppUser ORDER BY Role DESC, Email;");
        return rows.AsList();
    }

    /// <summary>
    /// Resolves the roles for a signed-in identity. Records a login timestamp
    /// (and captures a display name on first sight). Returns an empty array for
    /// anyone who hasn't been invited, which denies them the <c>member</c> role.
    /// </summary>
    public async Task<string[]> ResolveRolesAsync(string email, string? displayName, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var role = await conn.QuerySingleOrDefaultAsync<string?>(
            @"UPDATE inv.AppUser
                 SET LastLoginAt = SYSUTCDATETIME(),
                     DisplayName = COALESCE(DisplayName, @displayName)
              OUTPUT inserted.Role
              WHERE LOWER(Email) = @email;",
            new { email = email.Trim().ToLowerInvariant(), displayName });

        return role switch
        {
            "admin" => new[] { "member", "admin" },
            "member" => new[] { "member" },
            _ => Array.Empty<string>(),
        };
    }

    /// <summary>Invites (pre-authorizes) an email. Returns null if already present.</summary>
    public async Task<AppUser?> InviteAsync(string email, string role, string? invitedBy, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var normalized = email.Trim().ToLowerInvariant();
        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM inv.AppUser WHERE LOWER(Email) = @normalized;", new { normalized });
        if (exists > 0) return null;

        return await conn.QuerySingleAsync<AppUser>(
            $@"INSERT INTO inv.AppUser (Id, Email, Role, InvitedBy)
               OUTPUT {InsertedColumns}
               VALUES (@id, @normalized, @role, @invitedBy);",
            new { id = Guid.NewGuid(), normalized, role, invitedBy });
    }

    public async Task<AppUser?> SetRoleAsync(Guid id, string role, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<AppUser>(
            $@"UPDATE inv.AppUser SET Role = @role
               OUTPUT {InsertedColumns}
               WHERE Id = @id;",
            new { id, role });
    }

    public async Task<AppUser?> GetAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<AppUser>(
            $"SELECT {Columns} FROM inv.AppUser WHERE Id = @id;", new { id });
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await _db.OpenAsync(ct);
        var affected = await conn.ExecuteAsync(
            "DELETE FROM inv.AppUser WHERE Id = @id;", new { id });
        return affected > 0;
    }

    private const string InsertedColumns =
        "inserted.Id, inserted.Email, inserted.Role, inserted.DisplayName, " +
        "inserted.InvitedBy, inserted.CreatedAt, inserted.LastLoginAt";
}
