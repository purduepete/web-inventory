using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Azure.Core.Serialization;
using System.Text.Json;
using WebInventory.Api.Data;
using WebInventory.Api.Middleware;
using WebInventory.Api.Services;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults(builder =>
    {
        // Gate every HTTP function behind an access key (see KeyAuthMiddleware).
        builder.UseMiddleware<KeyAuthMiddleware>();
    })
    .ConfigureServices(services =>
    {
        services.Configure<WorkerOptions>(o =>
        {
            o.Serializer = new JsonObjectSerializer(new JsonSerializerOptions(JsonSerializerDefaults.Web));
        });

        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();

        services.AddMemoryCache();

        services.AddSingleton<Database>();
        services.AddSingleton<AccessKeyRepository>();
        services.AddSingleton<InventoryRepository>();
        services.AddSingleton<BlobService>();
        services.AddSingleton<VisionService>();
    })
    .Build();

host.Run();
