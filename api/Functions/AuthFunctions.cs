using System.Net;
using Microsoft.AspNetCore.Mvc;

namespace WebInventory.Api.Functions;

/// <summary>
/// Public requests pass Cloudflare Access before reaching the loopback origin.
/// Private requests use Tailscale access controls.
/// </summary>
[ApiController]
public class AuthFunctions : ControllerBase
{
    [HttpGet("/api/auth/check")]
    public IActionResult Check()
        => Request.Status(HttpStatusCode.NoContent);
}
