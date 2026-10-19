using System.Net;
using Microsoft.AspNetCore.Mvc;

namespace WebInventory.Api;

internal static class Http
{
    public static Task<IActionResult> Json<T>(this HttpRequest req, T value, HttpStatusCode status = HttpStatusCode.OK)
        => Task.FromResult<IActionResult>(new ObjectResult(value) { StatusCode = (int)status });

    public static IActionResult Status(this HttpRequest req, HttpStatusCode status)
        => new StatusCodeResult((int)status);

    public static Task<IActionResult> Text(this HttpRequest req, string message, HttpStatusCode status)
        => Task.FromResult<IActionResult>(new ContentResult { StatusCode = (int)status, Content = message, ContentType = "text/plain" });
}
