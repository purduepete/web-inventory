using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

public class ItemFunctions
{
    private readonly InventoryRepository _repo;
    public ItemFunctions(InventoryRepository repo) => _repo = repo;

    [Function("AddItem")]
    public async Task<HttpResponseData> Add(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "containers/{containerId:guid}/items")] HttpRequestData req,
        Guid containerId, CancellationToken ct)
    {
        var input = await req.ReadFromJsonAsync<SaveItemInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await req.Text("Name is required.", HttpStatusCode.BadRequest);
        var item = await _repo.AddItemAsync(containerId, input, "manual", ct);
        return item is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(item, HttpStatusCode.Created);
    }

    [Function("UpdateItem")]
    public async Task<HttpResponseData> Update(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "items/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var input = await req.ReadFromJsonAsync<SaveItemInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await req.Text("Name is required.", HttpStatusCode.BadRequest);
        var item = await _repo.UpdateItemAsync(id, input, ct);
        return item is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(item);
    }

    [Function("MoveItem")]
    public async Task<HttpResponseData> Move(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "items/{id:guid}/move")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var input = await req.ReadFromJsonAsync<MoveItemInput>();
        if (input is null || input.TargetContainerId == Guid.Empty)
            return await req.Text("targetContainerId is required.", HttpStatusCode.BadRequest);
        var item = await _repo.MoveItemAsync(id, input.TargetContainerId, ct);
        return item is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(item);
    }

    [Function("DeleteItem")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "items/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        await _repo.DeleteItemAsync(id, ct);
        return req.Status(HttpStatusCode.NoContent);
    }
}
