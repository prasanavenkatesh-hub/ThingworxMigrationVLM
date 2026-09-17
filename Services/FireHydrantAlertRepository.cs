using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [FireHydrant].[dbo].[Alerts] via PokeYokeDataConnection (cross-database
// query, same pattern used elsewhere in ReportsService). The table is an append-only audit
// log: an "open" row is inserted when a red condition starts, a "close" row (same AlertId)
// when it recovers. "id" has no identity/default, so it's assigned as MAX(id)+1 on insert.
public class FireHydrantAlertRepository
{
    private readonly string _connectionString;

    public FireHydrantAlertRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("PokeYokeDataConnection") ?? "";
    }

    public async Task<List<FireHydrantAlertDto>> GetOpenAlertsAsync()
    {
        const string sql = @"
            SELECT a.[AlertId], a.[EventTime], a.[Type], a.[Description], a.[status] AS Status, a.[SnoozeTime]
            FROM [FireHydrant].[dbo].[Alerts] a
            INNER JOIN (
                SELECT [AlertId], MAX([EventTime]) AS MaxEventTime
                FROM [FireHydrant].[dbo].[Alerts]
                GROUP BY [AlertId]
            ) latest ON a.[AlertId] = latest.[AlertId] AND a.[EventTime] = latest.[MaxEventTime]
            WHERE a.[status] = 'open'
            ORDER BY a.[EventTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<FireHydrantAlertDto>(sql);
        return rows.ToList();
    }

    public async Task InsertAsync(long alertId, DateTime eventTime, string type, string description, string status)
    {
        const string sql = @"
            INSERT INTO [FireHydrant].[dbo].[Alerts] ([id], [AlertId], [EventTime], [Type], [Description], [status], [SnoozeTime])
            SELECT ISNULL(MAX([id]), 0) + 1, @AlertId, @EventTime, @Type, @Description, @Status, NULL
            FROM [FireHydrant].[dbo].[Alerts]";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { AlertId = alertId, EventTime = eventTime, Type = type, Description = description, Status = status });
    }

    public async Task SnoozeAsync(List<long> alertIds, DateTime snoozeUntil)
    {
        if (alertIds.Count == 0) return;
        const string sql = @"
            UPDATE [FireHydrant].[dbo].[Alerts]
            SET [SnoozeTime] = @SnoozeUntil
            WHERE [AlertId] IN @AlertIds AND [status] = 'open'";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { AlertIds = alertIds, SnoozeUntil = snoozeUntil });
    }

    // Pairs each AlertId's "open" row (Start Event) with its "close" row (End Event, null if
    // still open) for the Alerts report tab. Filtered by the open row's EventTime falling in
    // [start, end]. AlertId itself isn't returned - the report is read-only display, and
    // AlertId's precision issue in JS (see FireHydrantAlertDto) isn't worth dealing with here.
    public async Task<List<FireHydrantAlertHistoryDto>> GetAlertHistoryAsync(DateTime start, DateTime end)
    {
        const string sql = @"
            SELECT o.[Type], o.[Description], o.[EventTime] AS StartEvent, c.[EventTime] AS EndEvent
            FROM [FireHydrant].[dbo].[Alerts] o
            LEFT JOIN [FireHydrant].[dbo].[Alerts] c
                ON c.[AlertId] = o.[AlertId] AND c.[status] = 'close'
            WHERE o.[status] = 'open' AND o.[EventTime] >= @Start AND o.[EventTime] <= @End
            ORDER BY o.[EventTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<FireHydrantAlertHistoryDto>(sql, new { Start = start, End = end });
        return rows.ToList();
    }
}
