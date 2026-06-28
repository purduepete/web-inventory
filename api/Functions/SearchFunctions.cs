using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;

namespace WebInventory.Api.Functions;

public class SearchFunctions
{
    private readonly InventoryRepository _repo;
    public SearchFunctions(InventoryRepository repo) => _repo = repo;

    [Function("Search")]
    public async Task<HttpResponseData> Search(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "search")] HttpRequestData req,
        CancellationToken ct)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var q = query["q"];
        var tag = query["tag"];
        Guid? ParseId(string key) => Guid.TryParse(query[key], out var id) ? id : null;
        return await req.Json(await _repo.SearchAsync(
            q, tag, ParseId("locationId"), ParseId("ownerId"), ParseId("categoryId"), ct));
    }

    [Function("ListTags")]
    public async Task<HttpResponseData> Tags(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tags")] HttpRequestData req,
        CancellationToken ct)
        => await req.Json(await _repo.ListTagsAsync(ct));

    [Function("ListFacets")]
    public async Task<HttpResponseData> Facets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "facets")] HttpRequestData req,
        CancellationToken ct)
        => await req.Json(await _repo.ListFacetsAsync(ct));
}
