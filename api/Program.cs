using Microsoft.Extensions.FileProviders;
using WebInventory.Api.Data;
using WebInventory.Api.Services;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:18795");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 15 * 1024 * 1024);
builder.Services.AddControllers().AddJsonOptions(options =>
    options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);
builder.Services.AddSingleton<Database>();
builder.Services.AddSingleton<InventoryRepository>();
builder.Services.AddSingleton<BlobService>();
builder.Services.AddSingleton<VisionService>();
var app = builder.Build();
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = 500;
    await context.Response.WriteAsJsonAsync(new { error = "Request failed; inspect server logs." });
}));
app.Use(async (context, next) =>
{
    var origin = context.Request.Headers.Origin.ToString();
    var developmentOrigin = app.Environment.IsDevelopment() &&
        origin is "http://localhost:5173" or "http://127.0.0.1:5173";
    if (origin.Length > 0 && origin != "https://web-inventory.jimlertech.com" &&
        origin != "https://jimbrownhome1.tail8ad282.ts.net:8795" && !developmentOrigin)
    {
        context.Response.StatusCode = 403;
        return;
    }
    context.Response.Headers.XContentTypeOptions = "nosniff";
    await next();
});
var imageRoot = app.Services.GetRequiredService<BlobService>().Root;
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(imageRoot),
    RequestPath = "/images",
    OnPrepareResponse = context => context.Context.Response.Headers.CacheControl = "private, max-age=3600"
});
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        if (context.File.Name is "index.html" or "sw.js" or "manifest.webmanifest")
            context.Context.Response.Headers.CacheControl = "no-cache";
    }
});
app.MapControllers();
app.MapGet("/healthz", async (Database database, CancellationToken ct) =>
{
    await using var connection = await database.OpenAsync(ct);
    return Results.Ok(new { ok = true, service = "web-inventory" });
});
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");
app.Run();
