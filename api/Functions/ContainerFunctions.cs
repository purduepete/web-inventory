using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

public class ContainerFunctions
{
    private readonly InventoryRepository _repo;
    public ContainerFunctions(InventoryRepository repo) => _repo = repo;

    [Function("ListContainers")]
    public async Task<HttpResponseData> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "containers")] HttpRequestData req,
        CancellationToken ct)
        => await req.Json(await _repo.ListContainersAsync(ct));

    [Function("CreateContainer")]
    public async Task<HttpResponseData> Create(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "containers")] HttpRequestData req,
        CancellationToken ct)
    {
        var input = await req.ReadFromJsonAsync<CreateContainerInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await req.Text("Name is required.", HttpStatusCode.BadRequest);
        var created = await _repo.CreateContainerAsync(input, ct);
        return await req.Json(created, HttpStatusCode.Created);
    }

    [Function("GetContainer")]
    public async Task<HttpResponseData> Get(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "containers/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var c = await _repo.GetContainerAsync(id, ct);
        return c is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(c);
    }

    [Function("GetContainerByToken")]
    public async Task<HttpResponseData> GetByToken(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "containers/by-token/{token:guid}")] HttpRequestData req,
        Guid token, CancellationToken ct)
    {
        var c = await _repo.GetContainerByTokenAsync(token, ct);
        return c is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(c);
    }

    [Function("UpdateContainer")]
    public async Task<HttpResponseData> Update(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "containers/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        var input = await req.ReadFromJsonAsync<CreateContainerInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await req.Text("Name is required.", HttpStatusCode.BadRequest);
        var updated = await _repo.UpdateContainerAsync(id, input, ct);
        return updated is null ? req.Status(HttpStatusCode.NotFound) : await req.Json(updated);
    }

    [Function("DeleteContainer")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "containers/{id:guid}")] HttpRequestData req,
        Guid id, CancellationToken ct)
    {
        await _repo.DeleteContainerAsync(id, ct);
        return req.Status(HttpStatusCode.NoContent);
    }
}
