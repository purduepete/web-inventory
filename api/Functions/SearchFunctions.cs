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
        return await req.Json(await _repo.SearchAsync(q, tag, ct));
    }

    [Function("ListTags")]
    public async Task<HttpResponseData> Tags(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tags")] HttpRequestData req,
        CancellationToken ct)
        => await req.Json(await _repo.ListTagsAsync(ct));
}
