using Azure.Core;
using Azure.Identity;
using Microsoft.Data.SqlClient;

namespace WebInventory.Api.Data;

/// <summary>
/// Opens SQL connections to the shared webportfolio database using Entra ID
/// (Active Directory Default) auth — a managed identity in Azure, or the
/// developer's az / VS credential locally.
/// </summary>
public sealed class Database
{
    private readonly string _connectionString;
    private readonly DefaultAzureCredential _credential = new();
    private static readonly TokenRequestContext SqlScope =
        new(new[] { "https://database.windows.net/.default" });

    public Database()
    {
        _connectionString = Environment.GetEnvironmentVariable("SqlConnectionString")
            ?? throw new InvalidOperationException("SqlConnectionString app setting is not configured.");
    }

    public async Task<SqlConnection> OpenAsync(CancellationToken ct = default)
    {
        var conn = new SqlConnection(_connectionString);
        // If the connection string already carries SQL credentials, skip token auth.
        if (!_connectionString.Contains("User ID", StringComparison.OrdinalIgnoreCase)
            && !_connectionString.Contains("Password", StringComparison.OrdinalIgnoreCase))
        {
            var token = await _credential.GetTokenAsync(SqlScope, ct);
            conn.AccessToken = token.Token;
        }
        await conn.OpenAsync(ct);
        return conn;
    }
}
