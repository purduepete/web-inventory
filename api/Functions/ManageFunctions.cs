using System.Net;
using Microsoft.AspNetCore.Mvc;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

/// <summary>
/// CRUD for the managed lookup lists used by the Manage page:
/// owners, locations and item categories. The {kind} segment is
/// constrained to those three values.
/// </summary>
[ApiController]
public class ManageFunctions : ControllerBase
{
    private static readonly HashSet<string> Kinds = new(StringComparer.OrdinalIgnoreCase)
    {
        "owners", "locations", "categories",
    };

    private readonly InventoryRepository _repo;
    public ManageFunctions(InventoryRepository repo) => _repo = repo;

    [HttpGet("/api/lookups/{kind}")]
    public async Task<IActionResult> List(
        string kind, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return Request.Status(HttpStatusCode.NotFound);
        return await Request.Json(await _repo.ListLookupAsync(kind.ToLowerInvariant(), ct));
    }

    [HttpPost("/api/lookups/{kind}")]
    public async Task<IActionResult> Create(
        string kind, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return Request.Status(HttpStatusCode.NotFound);
        var input = await Request.ReadFromJsonAsync<LookupInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await Request.Text("Name is required.", HttpStatusCode.BadRequest);
        var created = await _repo.CreateLookupAsync(kind.ToLowerInvariant(), input.Name, ct);
        return created is null
            ? await Request.Text("Name is required.", HttpStatusCode.BadRequest)
            : await Request.Json(created, HttpStatusCode.Created);
    }

    [HttpPut("/api/lookups/{kind}/{id:guid}")]
    public async Task<IActionResult> Rename(
        string kind, Guid id, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return Request.Status(HttpStatusCode.NotFound);
        var input = await Request.ReadFromJsonAsync<LookupInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await Request.Text("Name is required.", HttpStatusCode.BadRequest);
        var renamed = await _repo.RenameLookupAsync(kind.ToLowerInvariant(), id, input.Name, ct);
        return renamed is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(renamed);
    }

    [HttpDelete("/api/lookups/{kind}/{id:guid}")]
    public async Task<IActionResult> Delete(
        string kind, Guid id, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return Request.Status(HttpStatusCode.NotFound);
        var deleted = await _repo.DeleteLookupAsync(kind.ToLowerInvariant(), id, ct);
        return Request.Status(deleted ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }
}
