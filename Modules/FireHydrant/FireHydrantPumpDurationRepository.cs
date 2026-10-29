using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [ControlTowerVLM].[dbo].[FH_Duration] via SharedDataConnection (database name from FireHydrant:Database;
// moved from the old [FireHydrant].[dbo].[Duration] on 2026-10-26). Unlike Alerts (an
// append-only open+close row pair) and PumpRunningCount (change-log), this table is one row
// per complete pump run session: a row is inserted when a pump starts running (EndTime/
// Duration left NULL) and updated in place when it stops. "id" here has no identity either
// (verified before writing this), so MAX(id)+1 on insert, same as the other two tables.
public class FireHydrantPumpDurationRepository
{
    private readonly string _connectionString;
    private readonly string _database; // FireHydrant:Database (appsettings.json)
    private readonly bool _writesEnabled; // TEMPORARY: AppWriteMode (view-only copies)

    public FireHydrantPumpDurationRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("SharedDataConnection") ?? "";
        _database = config["FireHydrant:Database"] ?? "ControlTowerVLM";
        _writesEnabled = AppWriteMode.IsEnabled(config); // TEMPORARY: AppWriteMode (view-only copies)
    }

    // The currently-open (EndTime IS NULL) session for a pump, if any - used on startup to
    // resume tracking a run that was already in progress before a restart, rather than
    // starting a duplicate session or losing track of it entirely.
    public async Task<OpenSession?> GetOpenSessionAsync(string pump)
    {
        var sql = $@"
            SELECT TOP 1 [id] AS Id, [StartTime] FROM [{_database}].[dbo].[FH_Duration]
            WHERE [Pump] = @Pump AND [EndTime] IS NULL
            ORDER BY [StartTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<OpenSession>(sql, new { Pump = pump });
    }

    public class OpenSession
    {
        public long Id { get; set; }
        public DateTime StartTime { get; set; }
    }

    public async Task<long> InsertStartAsync(string pump, DateTime startTime)
    {
        if (!_writesEnabled) return 0; // TEMPORARY: AppWriteMode (view-only copies)
        var sql = $@"
            INSERT INTO [{_database}].[dbo].[FH_Duration] ([id], [Date], [Pump], [StartTime], [EndTime], [Duration])
            OUTPUT INSERTED.[id]
            SELECT ISNULL(MAX([id]), 0) + 1, @Date, @Pump, @StartTime, NULL, NULL
            FROM [{_database}].[dbo].[FH_Duration]";
        using var conn = new SqlConnection(_connectionString);
        return await conn.ExecuteScalarAsync<long>(sql, new { Date = startTime.Date, Pump = pump, StartTime = startTime });
    }

    public async Task UpdateEndAsync(long id, DateTime endTime, TimeSpan duration)
    {
        if (!_writesEnabled) return; // TEMPORARY: AppWriteMode (view-only copies)
        var sql = $@"
            UPDATE [{_database}].[dbo].[FH_Duration]
            SET [EndTime] = @EndTime, [Duration] = @Duration
            WHERE [id] = @Id";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { Id = id, EndTime = endTime, Duration = duration });
    }

    public async Task<List<FireHydrantPumpDurationDto>> GetSessionsAsync(DateTime start, DateTime end)
    {
        var sql = $@"
            SELECT [Pump], [StartTime], [EndTime], [Duration]
            FROM [{_database}].[dbo].[FH_Duration]
            WHERE [StartTime] >= @Start AND [StartTime] <= @End
            ORDER BY [StartTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<FireHydrantPumpDurationDto>(sql, new { Start = start, End = end });
        return rows.ToList();
    }
}
