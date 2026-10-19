using Npgsql;

namespace WebInventory.Api.Data;

/// <summary>
/// Opens pooled PostgreSQL connections from the PostgresConnectionString setting.
/// </summary>
public sealed class Database : IAsyncDisposable
{
    private readonly NpgsqlDataSource _dataSource;

    public Database()
    {
        var connectionString = Environment.GetEnvironmentVariable("PostgresConnectionString")
            ?? throw new InvalidOperationException("PostgresConnectionString setting is not configured.");
        _dataSource = NpgsqlDataSource.Create(connectionString);
    }

    public async Task<NpgsqlConnection> OpenAsync(CancellationToken ct = default)
        => await _dataSource.OpenConnectionAsync(ct);

    public ValueTask DisposeAsync() => _dataSource.DisposeAsync();
}
