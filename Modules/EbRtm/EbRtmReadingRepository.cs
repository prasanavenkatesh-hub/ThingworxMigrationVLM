using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [ControlTowerVLM].[dbo].[EbCMonitoring] via SharedDataConnection (database name from appsettings) (cross-database query, same
// pattern used by the Fire Hydrant/Gas Leak repositories). Unlike those tables, Id here is a
// real IDENTITY column - this is a brand new table with no legacy MAX(id)+1 constraint to match.
public class EbRtmReadingRepository
{
    private readonly string _connectionString;
    private readonly string _database; // EbRtm:Database (appsettings.json)

    public EbRtmReadingRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("SharedDataConnection") ?? "";
        _database = config["EbRtm:Database"] ?? "ControlTowerVLM";
    }

    public async Task InsertAsync(EbRtmReadingDto reading)
    {
        var sql = $@"
            INSERT INTO [{_database}].[dbo].[EbCMonitoring]
                ([Timestamp], [AvgVoltage], [AvgCurrent], [Frequency], [ActivePower], [PowerFactorSigned], [MaxDemand], [PresentDemand], [RealEnergyIntoLoad])
            VALUES
                (@Timestamp, @AvgVoltage, @AvgCurrent, @Frequency, @ActivePower, @PowerFactorSigned, @MaxDemand, @PresentDemand, @RealEnergyIntoLoad)";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, reading);
    }

    // Most recent logged row, used to seed EbRtmReadingLogger's deadband-comparison state after
    // a restart so it doesn't immediately re-log a value that hasn't actually moved.
    public async Task<EbRtmReadingDto?> GetLastAsync()
    {
        var sql = $@"
            SELECT TOP 1 [Timestamp], [AvgVoltage], [AvgCurrent], [Frequency], [ActivePower], [PowerFactorSigned], [MaxDemand], [PresentDemand], [RealEnergyIntoLoad]
            FROM [{_database}].[dbo].[EbCMonitoring]
            ORDER BY [Timestamp] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<EbRtmReadingDto>(sql);
    }

    // The last logged RealEnergyIntoLoad value at or before `cutoff` - used to compute energy
    // consumption over a window as (value at window end) - (value at window start). Null if no
    // reading has ever been logged at or before that instant (e.g. window starts before logging
    // began), so the caller can report the delta as "not available" rather than a wrong number.
    public async Task<double?> GetRealEnergyAtOrBeforeAsync(DateTime cutoff)
    {
        var sql = $@"
            SELECT TOP 1 [RealEnergyIntoLoad]
            FROM [{_database}].[dbo].[EbCMonitoring]
            WHERE [Timestamp] <= @Cutoff AND [RealEnergyIntoLoad] IS NOT NULL
            ORDER BY [Timestamp] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<double?>(sql, new { Cutoff = cutoff });
    }

    public async Task<List<EbRtmReadingDto>> GetHistoryAsync(DateTime start, DateTime end)
    {
        var sql = $@"
            SELECT [Timestamp], [AvgVoltage], [AvgCurrent], [Frequency], [ActivePower], [PowerFactorSigned], [MaxDemand], [PresentDemand], [RealEnergyIntoLoad]
            FROM [{_database}].[dbo].[EbCMonitoring]
            WHERE [Timestamp] >= @Start AND [Timestamp] <= @End
            ORDER BY [Timestamp]";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<EbRtmReadingDto>(sql, new { Start = start, End = end });
        return rows.ToList();
    }
}
