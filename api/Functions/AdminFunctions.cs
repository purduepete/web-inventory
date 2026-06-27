using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

/// <summary>
/// Admin-only management of application users. Gated on the <c>admin</c> role
/// both at the Static Web Apps edge (route rules) and here, by inspecting the
/// injected client principal.
/// </summary>
public class AdminFunctions
{
    private static readonly string[] ValidRoles = { "member", "admin" };

    private readonly AppUsersRepository _users;
    public AdminFunctions(AppUsersRepository users) => _users = users;

    [Function("ListUsers")]
    public async Task<HttpResponseData> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "admin/users")] HttpRequestData req,
        CancellationToken ct)
    {
        if (!req.GetClientPrincipal().IsAdmin())
            return req.Status(HttpStatusCode.Forbidden);
        return await req.Json(await _users.ListAsync(ct));
    }

    [Function("InviteUser")]
    public async Task<HttpResponseData> Invite(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "admin/users")] HttpRequestData req,
        CancellationToken ct)
    {
        var principal = req.GetClientPrincipal();
        if (!principal.IsAdmin())
            return req.Status(HttpStatusCode.Forbidden);

        var input = await req.ReadFromJsonAsync<InviteUserInput>();
        var email = input?.Email?.Trim();
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            return await req.Text("A valid email is required.", HttpStatusCode.BadRequest);

        var role = NormalizeRole(input!.Role);
        if (role is null)
            return await req.Text("Role must be 'member' or 'admin'.", HttpStatusCode.BadRequest);

        var created = await _users.InviteAsync(email, role, principal!.UserDetails, ct);
        return created is null
            ? await req.Text("That email is already invited.", HttpStatusCode.Conflict)
            : await req.Json(created, HttpStatusCode.Created);
    }

    [Function("SetUserRole")]
    public async Task<HttpResponseData> SetRole(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "admin/users/{id:guid}/role")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var principal = req.GetClientPrincipal();
        if (!principal.IsAdmin())
            return req.Status(HttpStatusCode.Forbidden);

        var input = await req.ReadFromJsonAsync<SetRoleInput>();
        var role = NormalizeRole(input?.Role);
        if (role is null)
            return await req.Text("Role must be 'member' or 'admin'.", HttpStatusCode.BadRequest);

        // Guard against an admin demoting themselves and losing access.
        var target = await _users.GetAsync(id, ct);
        if (target is null)
            return req.Status(HttpStatusCode.NotFound);
        if (role != "admin" && SameUser(target, principal))
            return await req.Text("You cannot remove your own admin role.", HttpStatusCode.BadRequest);

        var updated = await _users.SetRoleAsync(id, role, ct);
        return updated is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(updated);
    }

    [Function("DeleteUser")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "admin/users/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var principal = req.GetClientPrincipal();
        if (!principal.IsAdmin())
            return req.Status(HttpStatusCode.Forbidden);

        // Guard against an admin removing their own access.
        var target = await _users.GetAsync(id, ct);
        if (target is null)
            return req.Status(HttpStatusCode.NoContent);
        if (SameUser(target, principal))
            return await req.Text("You cannot remove your own access.", HttpStatusCode.BadRequest);

        await _users.DeleteAsync(id, ct);
        return req.Status(HttpStatusCode.NoContent);
    }

    private static string? NormalizeRole(string? role)
    {
        var r = role?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(r) ? "member" : (ValidRoles.Contains(r) ? r : null);
    }

    private static bool SameUser(AppUser user, ClientPrincipal? principal)
        => string.Equals(user.Email, principal?.UserDetails?.Trim(), StringComparison.OrdinalIgnoreCase);
}
