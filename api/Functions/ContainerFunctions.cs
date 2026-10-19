using System.Net;
using Microsoft.AspNetCore.Mvc;
using WebInventory.Api.Data;
using WebInventory.Api.Models;

namespace WebInventory.Api.Functions;

[ApiController]
public class ContainerFunctions : ControllerBase
{
    private readonly InventoryRepository _repo;
    public ContainerFunctions(InventoryRepository repo) => _repo = repo;

    [HttpGet("/api/containers")]
    public async Task<IActionResult> List(
        CancellationToken ct)
        => await Request.Json(await _repo.ListContainersAsync(ct));

    [HttpPost("/api/containers")]
    public async Task<IActionResult> Create(
        CancellationToken ct)
    {
        var input = await Request.ReadFromJsonAsync<CreateContainerInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await Request.Text("Name is required.", HttpStatusCode.BadRequest);
        var created = await _repo.CreateContainerAsync(input, ct);
        return await Request.Json(created, HttpStatusCode.Created);
    }

    [HttpGet("/api/containers/{id:guid}")]
    public async Task<IActionResult> Get(
        Guid id, CancellationToken ct)
    {
        var c = await _repo.GetContainerAsync(id, ct);
        return c is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(c);
    }

    [HttpGet("/api/containers/by-token/{token:guid}")]
    public async Task<IActionResult> GetByToken(
        Guid token, CancellationToken ct)
    {
        var c = await _repo.GetContainerByTokenAsync(token, ct);
        return c is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(c);
    }

    [HttpPut("/api/containers/{id:guid}")]
    public async Task<IActionResult> Update(
        Guid id, CancellationToken ct)
    {
        var input = await Request.ReadFromJsonAsync<CreateContainerInput>();
        if (input is null || string.IsNullOrWhiteSpace(input.Name))
            return await Request.Text("Name is required.", HttpStatusCode.BadRequest);
        var updated = await _repo.UpdateContainerAsync(id, input, ct);
        return updated is null ? Request.Status(HttpStatusCode.NotFound) : await Request.Json(updated);
    }

    [HttpDelete("/api/containers/{id:guid}")]
    public async Task<IActionResult> Delete(
        Guid id, CancellationToken ct)
    {
        await _repo.DeleteContainerAsync(id, ct);
        return Request.Status(HttpStatusCode.NoContent);
    }
}
