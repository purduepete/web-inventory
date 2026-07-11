using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace WebInventory.Api.Functions;

/// <summary>
/// Lightweight endpoints used only to confirm the caller's access key is accepted.
/// The <see cref="Middleware.KeyAuthMiddleware"/> has already validated the key (a
/// cached lookup) by the time the handler runs, so the handler itself does no work
/// and returns an empty 204. The client hits this on load instead of a data endpoint
/// like <c>/tags</c>, avoiding an extra DB query + payload just to gate the app.
/// </summary>
public class AuthFunctions
{
    [Function("AuthCheck")]
    public HttpResponseData Check(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "auth/check")] HttpRequestData req)
        => req.Status(HttpStatusCode.NoContent);
}
