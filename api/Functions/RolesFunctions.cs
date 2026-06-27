using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

/// <summary>
/// Static Web Apps custom roles endpoint. Configured as <c>auth.rolesSource</c>
/// in staticwebapp.config.json, it is invoked by the platform after each login
/// to map the authenticated identity to application roles.
/// </summary>
public class RolesFunctions
{
    private readonly AppUsersRepository _users;
    public RolesFunctions(AppUsersRepository users) => _users = users;

    [Function("GetRoles")]
    public async Task<HttpResponseData> GetRoles(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "GetRoles")] HttpRequestData req,
        CancellationToken ct)
    {
        var payload = await req.ReadFromJsonAsync<RolesRequest>();
        var email = payload?.UserDetails;

        var roles = string.IsNullOrWhiteSpace(email)
            ? Array.Empty<string>()
            : await _users.ResolveRolesAsync(email, NameFrom(payload), ct);

        return await req.Json(new { roles });
    }

    private static string? NameFrom(RolesRequest? payload)
        => payload?.Claims?
            .FirstOrDefault(c => c.Typ is "name"
                or "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
            ?.Val;
}
