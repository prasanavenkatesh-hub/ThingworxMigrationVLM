using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [ControlTowerVLM].[dbo].[EbCPowerFailureEvents] via SharedDataConnection (database name from appsettings). One row per power
// failure session: inserted (EndTime/Duration NULL) the moment AvgVoltage drops below 0, closed
// out once it recovers. Mirrors FireHydrantPumpDurationRepository's open/close session shape,
// but for a single meter rather than a dictionary of pumps.
public class EbRtmPowerFailureRepository
{
    private readonly string _connectionString;
    private readonly string _database; // EbRtm:Database (appsettings.json)

    public EbRtmPowerFailureRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("SharedDataConnection") ?? "";
        _database = config["EbRtm:Database"] ?? "ControlTowerVLM";
    }

    public class OpenSession
    {
        public long Id { get; set; }
        public DateTime StartTime { get; set; }
    }

    public async Task<OpenSession?> GetOpenSessionAsync()
    {
        var sql = $@"
            SELECT TOP 1 [Id], [StartTime] FROM [{_database}].[dbo].[EbCPowerFailureEvents]
            WHERE [EndTime] IS NULL
            ORDER BY [StartTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<OpenSession>(sql);
    }

    public async Task<long> InsertStartAsync(DateTime startTime)
    {
        var sql = $@"
            INSERT INTO [{_database}].[dbo].[EbCPowerFailureEvents] ([Date], [StartTime], [EndTime], [Duration])
            OUTPUT INSERTED.[Id]
            VALUES (@Date, @StartTime, NULL, NULL)";
        using var conn = new SqlConnection(_connectionString);
        return await conn.ExecuteScalarAsync<long>(sql, new { Date = startTime.Date, StartTime = startTime });
    }

    public async Task UpdateEndAsync(long id, DateTime endTime, TimeSpan duration)
    {
        var sql = $@"
            UPDATE [{_database}].[dbo].[EbCPowerFailureEvents]
            SET [EndTime] = @EndTime, [Duration] = @Duration
            WHERE [Id] = @Id";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { Id = id, EndTime = endTime, Duration = duration });
    }

    public class Session
    {
        public DateTime StartTime { get; set; }
        public DateTime? EndTime { get; set; }
    }

    // Every session overlapping [start, end) - including ones that started before `start` but
    // were still in progress (EndTime NULL = still open) - for the per-day bar charts.
    public async Task<List<Session>> GetSessionsOverlappingAsync(DateTime start, DateTime end)
    {
        var sql = $@"
            SELECT [StartTime], [EndTime] FROM [{_database}].[dbo].[EbCPowerFailureEvents]
            WHERE [StartTime] < @End AND ([EndTime] IS NULL OR [EndTime] > @Start)
            ORDER BY [StartTime]";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<Session>(sql, new { Start = start, End = end });
        return rows.ToList();
    }

    public async Task<int> GetCountForDateAsync(DateTime date)
    {
        var sql = $@"
            SELECT COUNT(*) FROM [{_database}].[dbo].[EbCPowerFailureEvents]
            WHERE [Date] = @Date";
        using var conn = new SqlConnection(_connectionString);
        return await conn.ExecuteScalarAsync<int>(sql, new { Date = date.Date });
    }
}
