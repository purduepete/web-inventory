using System.Text.Json;
using Azure.AI.OpenAI;
using Azure.Identity;
using Azure;
using OpenAI.Chat;
using WebInventory.Api.Models;

namespace WebInventory.Api.Services;

/// <summary>
/// Sends a container photo to Azure OpenAI (gpt-5-mini vision) and asks it to
/// list the discrete physical items it can see, returned as structured JSON.
/// </summary>
public sealed class VisionService
{
    private readonly ChatClient? _chat;

    private const string SystemPrompt =
        "You are an inventory assistant. Look at the photo of the contents of a storage container " +
        "and list the distinct, individually identifiable physical items you can see. " +
        "Use concise, specific names (brand/colour when obvious). Ignore the container itself, " +
        "packaging fillers, and background. Respond ONLY as JSON of the form " +
        "{\"items\":[{\"name\":string,\"description\":string,\"quantity\":number}]}.";

    private readonly ILogger<VisionService> _logger;

    public VisionService(ILogger<VisionService> logger)
    {
        _logger = logger;
        var endpoint = Environment.GetEnvironmentVariable("OpenAiEndpoint");
        var deployment = Environment.GetEnvironmentVariable("OpenAiDeployment") ?? "gpt-5-mini";
        if (string.IsNullOrWhiteSpace(endpoint) || endpoint.Contains("<your-"))
        {
            _chat = null;
            return;
        }
        var key = Environment.GetEnvironmentVariable("OpenAiKey");
        var client = string.IsNullOrWhiteSpace(key)
            ? new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
            : new AzureOpenAIClient(new Uri(endpoint), new AzureKeyCredential(key));
        _chat = client.GetChatClient(deployment);
    }

    public bool Enabled => _chat is not null;

    public async Task<List<DetectedItem>> DetectAsync(byte[] imageBytes, CancellationToken ct)
    {
        if (_chat is null) return new();

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage(SystemPrompt),
            new UserChatMessage(
                ChatMessageContentPart.CreateTextPart("List the items visible in this container."),
                ChatMessageContentPart.CreateImagePart(
                    BinaryData.FromBytes(imageBytes), "image/jpeg", ChatImageDetailLevel.Low)),
        };

        var options = new ChatCompletionOptions
        {
            ResponseFormat = ChatResponseFormat.CreateJsonObjectFormat(),
        };

        try
        {
            var response = await _chat.CompleteChatAsync(messages, options, ct);
            var text = response.Value.Content.Count > 0 ? response.Value.Content[0].Text : "{}";
            return Parse(text);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Inventory image analysis failed.");
            throw;
        }
    }

    private static List<DetectedItem> Parse(string json)
    {
        var result = new List<DetectedItem>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("items", out var items) ||
                items.ValueKind != JsonValueKind.Array)
                return result;

            foreach (var el in items.EnumerateArray())
            {
                var name = el.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrWhiteSpace(name)) continue;
                var desc = el.TryGetProperty("description", out var d) ? d.GetString() : null;
                var qty = el.TryGetProperty("quantity", out var q) && q.TryGetInt32(out var qi) ? qi : 1;
                result.Add(new DetectedItem(name!.Trim(), string.IsNullOrWhiteSpace(desc) ? null : desc!.Trim(), Math.Max(1, qty)));
            }
        }
        catch (JsonException)
        {
            // Model returned non-JSON; treat as no detections.
        }
        return result;
    }
}
