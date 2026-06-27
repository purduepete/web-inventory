using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker.Http;
using WebInventory.Api.Models;

namespace WebInventory.Api;

internal static class Http
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

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

    /// <summary>
    /// Decodes the Static Web Apps <c>x-ms-client-principal</c> header that
    /// carries the signed-in user's identity and roles.
    /// </summary>
    public static ClientPrincipal? GetClientPrincipal(this HttpRequestData req)
    {
        if (!req.Headers.TryGetValues("x-ms-client-principal", out var values))
            return null;
        var header = values.FirstOrDefault();
        if (string.IsNullOrEmpty(header))
            return null;
        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(header));
            return JsonSerializer.Deserialize<ClientPrincipal>(json, Web);
        }
        catch
        {
            return null;
        }
    }

    public static bool IsAdmin(this ClientPrincipal? principal)
        => principal?.UserRoles?.Contains("admin", StringComparer.OrdinalIgnoreCase) ?? false;
}
