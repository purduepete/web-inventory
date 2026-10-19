using System.Net;
using Microsoft.AspNetCore.Mvc;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

[ApiController]
public class ItemFunctions : ControllerBase
{
    private readonly InventoryRepository _repo;
    public ItemFunctions(InventoryRepository repo) => _repo = repo;

    [HttpPost("/api/containers/{containerId:guid}/items")]
    public async Task<IActionResult> Add(
        Guid containerId, CancellationToken ct)
    {
        var input = await Request.ReadFromJsonAsync<SaveItemInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await Request.Text("Name is required.", HttpStatusCode.BadRequest);
        var item = await _repo.AddItemAsync(containerId, input, "manual", ct);
        return item is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(item, HttpStatusCode.Created);
    }

    [HttpPut("/api/items/{id:guid}")]
    public async Task<IActionResult> Update(
        Guid id, CancellationToken ct)
    {
        var input = await Request.ReadFromJsonAsync<SaveItemInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await Request.Text("Name is required.", HttpStatusCode.BadRequest);
        var item = await _repo.UpdateItemAsync(id, input, ct);
        return item is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(item);
    }

    [HttpPost("/api/items/{id:guid}/move")]
    public async Task<IActionResult> Move(
        Guid id, CancellationToken ct)
    {
        var input = await Request.ReadFromJsonAsync<MoveItemInput>();
        if (input is null || input.TargetContainerId == Guid.Empty)
            return await Request.Text("targetContainerId is required.", HttpStatusCode.BadRequest);
        var item = await _repo.MoveItemAsync(id, input.TargetContainerId, ct);
        return item is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(item);
    }

    [HttpDelete("/api/items/{id:guid}")]
    public async Task<IActionResult> Delete(
        Guid id, CancellationToken ct)
    {
        await _repo.DeleteItemAsync(id, ct);
        return Request.Status(HttpStatusCode.NoContent);
    }
}
