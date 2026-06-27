using System.Net;
using Microsoft.Azure.Functions.Worker.Http;

namespace WebInventory.Api;

internal static class Http
{
    public static async Task<HttpResponseData> Json<T>(this HttpRequestData req, T value, HttpStatusCode status = HttpStatusCode.OK)
    {
        var res = req.CreateResponse(status);
        await res.WriteAsJsonAsync(value, status);
        return res;
    }

    public static HttpResponseData Status(this HttpRequestData req, HttpStatusCode status)
        => req.CreateResponse(status);

    public static async Task<HttpResponseData> Text(this HttpRequestData req, string message, HttpStatusCode status)
    {
        var res = req.CreateResponse(status);
        await res.WriteStringAsync(message);
        return res;
    }
}
