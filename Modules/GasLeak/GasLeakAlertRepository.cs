using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [LPGGasLeak].[dbo].[GasLeakAlerts] via SharedDataConnection (database name from appsettings) (cross-database
// query on the same 10.130.1.73 server, same pattern FireHydrantAlertRepository uses for
// [FireHydrant].[dbo].[Alerts]). A NEW table, deliberately not the original GasSentry
// project's own [LPGGasLeak].[dbo].[Alerts] table (different schema, and that project may
// still be running against it independently) - see README for the one-time CREATE TABLE this
// needs before first use.
//
// Schema mirrors FireHydrantAlertRepository's table exactly: an append-only audit log, "open"
// row inserted when a red/warning condition starts, "close" row (same AlertId) when it clears.
// "id" has no identity/default, so it's assigned as MAX(id)+1 on insert, same as FireHydrant.
public class GasLeakAlertRepository
{
    private readonly string _connectionString;
    private readonly string _database; // GasLeak:Database (appsettings.json)

    public GasLeakAlertRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("SharedDataConnection") ?? "";
        _database = config["GasLeak:Database"] ?? "LPGGasLeak";
    }

    public async Task<List<GasLeakAlertDto>> GetOpenAlertsAsync()
    {
        var sql = $@"
            SELECT a.[AlertId], a.[EventTime], a.[Type], a.[Description], a.[status] AS Status, a.[SnoozeTime]
            FROM [{_database}].[dbo].[GasLeakAlerts] a
            INNER JOIN (
                SELECT [AlertId], MAX([EventTime]) AS MaxEventTime
                FROM [{_database}].[dbo].[GasLeakAlerts]
                GROUP BY [AlertId]
            ) latest ON a.[AlertId] = latest.[AlertId] AND a.[EventTime] = latest.[MaxEventTime]
            WHERE a.[status] = 'open'
            ORDER BY a.[EventTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<GasLeakAlertDto>(sql);
        return rows.ToList();
    }

    public async Task InsertAsync(long alertId, DateTime eventTime, string type, string description, string status)
    {
        var sql = $@"
            INSERT INTO [{_database}].[dbo].[GasLeakAlerts] ([id], [AlertId], [EventTime], [Type], [Description], [status], [SnoozeTime])
            SELECT ISNULL(MAX([id]), 0) + 1, @AlertId, @EventTime, @Type, @Description, @Status, NULL
            FROM [{_database}].[dbo].[GasLeakAlerts]";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { AlertId = alertId, EventTime = eventTime, Type = type, Description = description, Status = status });
    }

    public async Task SnoozeAsync(List<long> alertIds, DateTime snoozeUntil)
    {
        if (alertIds.Count == 0) return;
        var sql = $@"
            UPDATE [{_database}].[dbo].[GasLeakAlerts]
            SET [SnoozeTime] = @SnoozeUntil
            WHERE [AlertId] IN @AlertIds AND [status] = 'open'";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { AlertIds = alertIds, SnoozeUntil = snoozeUntil });
    }

    public async Task<List<GasLeakAlertHistoryDto>> GetAlertHistoryAsync(DateTime start, DateTime end)
    {
        var sql = $@"
            SELECT o.[Type], o.[Description], o.[EventTime] AS StartEvent, c.[EventTime] AS EndEvent
            FROM [{_database}].[dbo].[GasLeakAlerts] o
            LEFT JOIN [{_database}].[dbo].[GasLeakAlerts] c
                ON c.[AlertId] = o.[AlertId] AND c.[status] = 'close'
            WHERE o.[status] = 'open' AND o.[EventTime] >= @Start AND o.[EventTime] <= @End
            ORDER BY o.[EventTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<GasLeakAlertHistoryDto>(sql, new { Start = start, End = end });
        return rows.ToList();
    }
}
