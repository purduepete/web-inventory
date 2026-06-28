using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

/// <summary>
/// CRUD for the managed lookup lists used by the Manage page:
/// owners, locations and item categories. The {kind} segment is
/// constrained to those three values.
/// </summary>
public class ManageFunctions
{
    private static readonly HashSet<string> Kinds = new(StringComparer.OrdinalIgnoreCase)
    {
        "owners", "locations", "categories",
    };

    private readonly InventoryRepository _repo;
    public ManageFunctions(InventoryRepository repo) => _repo = repo;

    [Function("ListLookups")]
    public async Task<HttpResponseData> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "lookups/{kind}")] HttpRequestData req,
        string kind, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return req.Status(HttpStatusCode.NotFound);
        return await req.Json(await _repo.ListLookupAsync(kind.ToLowerInvariant(), ct));
    }

    [Function("CreateLookup")]
    public async Task<HttpResponseData> Create(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "lookups/{kind}")] HttpRequestData req,
        string kind, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return req.Status(HttpStatusCode.NotFound);
        var input = await req.ReadFromJsonAsync<LookupInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await req.Text("Name is required.", HttpStatusCode.BadRequest);
        var created = await _repo.CreateLookupAsync(kind.ToLowerInvariant(), input.Name, ct);
        return created is null
            ? await req.Text("Name is required.", HttpStatusCode.BadRequest)
            : await req.Json(created, HttpStatusCode.Created);
    }

    [Function("RenameLookup")]
    public async Task<HttpResponseData> Rename(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "lookups/{kind}/{id:guid}")] HttpRequestData req,
        string kind, Guid id, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return req.Status(HttpStatusCode.NotFound);
        var input = await req.ReadFromJsonAsync<LookupInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await req.Text("Name is required.", HttpStatusCode.BadRequest);
        var renamed = await _repo.RenameLookupAsync(kind.ToLowerInvariant(), id, input.Name, ct);
        return renamed is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(renamed);
    }

    [Function("DeleteLookup")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "lookups/{kind}/{id:guid}")] HttpRequestData req,
        string kind, Guid id, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) return req.Status(HttpStatusCode.NotFound);
        var deleted = await _repo.DeleteLookupAsync(kind.ToLowerInvariant(), id, ct);
        return req.Status(deleted ? HttpStatusCode.NoContent : HttpStatusCode.NotFound);
    }
}
