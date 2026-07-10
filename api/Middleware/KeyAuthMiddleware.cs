using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;
using WebInventory.Api.Data;

namespace WebInventory.Api.Middleware;

/// <summary>
/// Enforces access-key authentication on every HTTP-triggered function. The whole
/// app is gated by a single key presented in the <c>x-api-key</c> header; there are
/// no scopes (any active key = full access). This is the sole gate once the linked
/// Function App's Easy Auth is set to allow anonymous, so it is fail-closed.
///
/// Non-HTTP triggers (Timer/Queue/Blob) pass through untouched. The middleware never
/// reads the request body, so raw-JPEG photo uploads still work.
/// </summary>
public sealed class KeyAuthMiddleware : IFunctionsWorkerMiddleware
{
    private readonly AccessKeyRepository _keys;

    // A raw key is a high-entropy url-safe string (~43 chars for 32 bytes). Reject
    // obviously malformed inputs cheaply, before hashing / touching the database.
    private const int MinKeyLength = 16;
    private const int MaxKeyLength = 512;

    // TRANSITION ONLY: while Entra/SWA auth is still in front, trust the platform-
    // injected SWA principal so signed-in users aren't 401'd mid-cutover. Set
    // WEBINV_ALLOW_SWA_PRINCIPAL=false (or remove) after the key frontend ships.
    private static readonly bool AllowSwaPrincipal =
        !string.Equals(
            Environment.GetEnvironmentVariable("WEBINV_ALLOW_SWA_PRINCIPAL"),
            "false",
            StringComparison.OrdinalIgnoreCase);

    public KeyAuthMiddleware(AccessKeyRepository keys) => _keys = keys;

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var req = await context.GetHttpRequestDataAsync();
        if (req is null)
        {
            // Not an HTTP trigger — nothing to authenticate.
            await next(context);
            return;
        }

        if (await IsAuthorizedAsync(req, context.CancellationToken))
        {
            await next(context);
            return;
        }

        var res = req.CreateResponse(HttpStatusCode.Unauthorized);
        await res.WriteStringAsync("Missing or invalid access key.");
        context.GetInvocationResult().Value = res;
    }

    private async Task<bool> IsAuthorizedAsync(HttpRequestData req, CancellationToken ct)
    {
        if (AllowSwaPrincipal && HasHeader(req, "x-ms-client-principal"))
            return true;

        if (!req.Headers.TryGetValues("x-api-key", out var values))
            return false;

        var key = values.FirstOrDefault()?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length is < MinKeyLength or > MaxKeyLength)
            return false;

        return await _keys.IsValidAsync(key, ct);
    }

    private static bool HasHeader(HttpRequestData req, string name)
        => req.Headers.TryGetValues(name, out var v)
           && !string.IsNullOrWhiteSpace(v.FirstOrDefault());
}
