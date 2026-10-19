using System.Net;
using Microsoft.AspNetCore.Mvc;
using WebInventory.Api.Data;

namespace WebInventory.Api.Functions;

[ApiController]
public class SearchFunctions : ControllerBase
{
    private readonly InventoryRepository _repo;
    public SearchFunctions(InventoryRepository repo) => _repo = repo;

    [HttpGet("/api/search")]
    public async Task<IActionResult> Search(
        CancellationToken ct)
    {
        var query = System.Web.HttpUtility.ParseQueryString(Request.QueryString.Value ?? "");
        var q = query["q"];
        var tag = query["tag"];
        Guid? ParseId(string key) => Guid.TryParse(query[key], out var id) ? id : null;
        var skip = int.TryParse(query["skip"], out var s) ? s : 0;
        var take = int.TryParse(query["take"], out var t) ? t : InventoryRepository.DefaultSearchTake;
        return await Request.Json(await _repo.SearchAsync(
            q, tag, ParseId("locationId"), ParseId("ownerId"), ParseId("categoryId"), skip, take, ct));
    }

    [HttpGet("/api/tags")]
    public async Task<IActionResult> Tags(
        CancellationToken ct)
        => await Request.Json(await _repo.ListTagsAsync(ct));

    [HttpGet("/api/facets")]
    public async Task<IActionResult> Facets(
        CancellationToken ct)
        => await Request.Json(await _repo.ListFacetsAsync(ct));
}
