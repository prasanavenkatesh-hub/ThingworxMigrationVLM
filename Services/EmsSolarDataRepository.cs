using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [ControlTowerVLM].[dbo].[SolarData] via PokeYokeDataConnection - one row per
// day, inserted at 00:15 by EmsSolarMqttBackgroundService, holding that moment's cumulative
// RealEnergy reading as the daily baseline for Today/Yesterday delta calculations. "id" has
// no identity/default (same pattern as the FireHydrant tables), so MAX(id)+1 on insert.
public class EmsSolarDataRepository
{
    private readonly string _connectionString;

    public EmsSolarDataRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("PokeYokeDataConnection") ?? "";
    }

    public async Task<double?> GetRealEnergyForDateAsync(DateTime date)
    {
        const string sql = @"
            SELECT TOP 1 [RealEnergy] FROM [ControlTowerVLM].[dbo].[SolarData]
            WHERE CAST([TimeStamp] AS DATE) = @Date
            ORDER BY [TimeStamp] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<double?>(sql, new { Date = date.Date });
    }

    public async Task InsertAsync(DateTime timestamp, double liveSolar, double realEnergy)
    {
        const string sql = @"
            INSERT INTO [ControlTowerVLM].[dbo].[SolarData] ([id], [TimeStamp], [LiveSolar], [RealEnergy])
            SELECT ISNULL(MAX([id]), 0) + 1, @TimeStamp, @LiveSolar, @RealEnergy
            FROM [ControlTowerVLM].[dbo].[SolarData]";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { TimeStamp = timestamp, LiveSolar = liveSolar, RealEnergy = realEnergy });
    }

    // [ControlTowerVLM].[dbo].[SolarLiveGraph]: one row per hour (logged at HH:15), backs the
    // hourly Live(kW) chart. No id column, no identity concerns - plain insert.
    public async Task InsertLiveGraphPointAsync(DateTime timestamp, long solar)
    {
        const string sql = @"
            INSERT INTO [ControlTowerVLM].[dbo].[SolarLiveGraph] ([TimeStamp], [Solar])
            VALUES (@TimeStamp, @Solar)";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { TimeStamp = timestamp, Solar = solar });
    }

    // Today's hourly points only (00:15 to 00:15) - the chart resets daily.
    public async Task<List<SolarLiveGraphPoint>> GetTodayLiveGraphAsync(DateTime date)
    {
        const string sql = @"
            SELECT [TimeStamp], [Solar] FROM [ControlTowerVLM].[dbo].[SolarLiveGraph]
            WHERE CAST([TimeStamp] AS DATE) = @Date
            ORDER BY [TimeStamp]";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<SolarLiveGraphPoint>(sql, new { Date = date.Date });
        return rows.ToList();
    }

    public class SolarLiveGraphPoint
    {
        public DateTime TimeStamp { get; set; }
        public long Solar { get; set; }
    }
}
