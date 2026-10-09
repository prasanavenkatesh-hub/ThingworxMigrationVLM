using Dapper;
using Microsoft.Data.SqlClient;
using ControlTower.Models;

namespace ControlTower.Services;

// Reads/writes [ControlTowerVLM].[dbo].[OtherPowerSource] via PokeYokeDataConnection - one row
// per Update click on the "Other Power Source" tab's month, holding that month's manually
// entered green-power-contribution figures (kWh, whole numbers). "id" has no identity/default
// (same pattern as the other EMS/FireHydrant tables), so MAX(id)+1 on insert.
public class EmsOtherPowerSourceRepository
{
    private readonly string _connectionString;

    public EmsOtherPowerSourceRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("PokeYokeDataConnection") ?? "";
    }

    public async Task InsertAsync(DateTime timestamp, OtherPowerSourceInput input)
    {
        const string sql = @"
            INSERT INTO [ControlTowerVLM].[dbo].[OtherPowerSource]
                ([id], [TimeStamp], [ThirdPartyWind], [ThirdPartySolar], [TNEB], [DG], [Solar], [GCPSolar], [IEXRenewable], [IEXNonRenewable])
            SELECT ISNULL(MAX([id]), 0) + 1, @TimeStamp, @ThirdPartyWind, @ThirdPartySolar, @Tneb, @Dg, @Solar, @GcpSolar, @IexRenewable, @IexNonRenewable
            FROM [ControlTowerVLM].[dbo].[OtherPowerSource]";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new
        {
            TimeStamp = timestamp,
            input.ThirdPartyWind,
            input.ThirdPartySolar,
            input.Tneb,
            input.Dg,
            input.Solar,
            input.GcpSolar,
            input.IexRenewable,
            input.IexNonRenewable
        });
    }

    // Latest entry for the given calendar month (in case of a re-submitted/edited month).
    public async Task<OtherPowerSourceRow?> GetLatestForMonthAsync(int year, int month)
    {
        const string sql = @"
            SELECT TOP 1 [ThirdPartyWind], [ThirdPartySolar], [Solar], [GCPSolar], [IEXRenewable], [TNEB], [DG], [IEXNonRenewable]
            FROM [ControlTowerVLM].[dbo].[OtherPowerSource]
            WHERE YEAR([TimeStamp]) = @Year AND MONTH([TimeStamp]) = @Month
            ORDER BY [TimeStamp] DESC, [id] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<OtherPowerSourceRow>(sql, new { Year = year, Month = month });
    }

    public class OtherPowerSourceRow
    {
        public long ThirdPartyWind { get; set; }
        public long ThirdPartySolar { get; set; }
        public long Solar { get; set; }
        public long GCPSolar { get; set; }
        public long IEXRenewable { get; set; }
        public long TNEB { get; set; }
        public long DG { get; set; }
        public long IEXNonRenewable { get; set; }
    }

    // Full history for the "Other Power Source" popup's data grid, newest first.
    public async Task<List<OtherPowerSourceHistoryRow>> GetHistoryAsync()
    {
        const string sql = @"
            SELECT TOP (1000) [TimeStamp], [ThirdPartyWind], [ThirdPartySolar], [TNEB], [DG], [Solar], [GCPSolar], [IEXRenewable], [IEXNonRenewable]
            FROM [ControlTowerVLM].[dbo].[OtherPowerSource]
            ORDER BY [TimeStamp] DESC, [id] DESC";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<OtherPowerSourceHistoryRow>(sql);
        return rows.ToList();
    }

    public class OtherPowerSourceHistoryRow
    {
        public DateTime TimeStamp { get; set; }
        public long ThirdPartyWind { get; set; }
        public long ThirdPartySolar { get; set; }
        public long TNEB { get; set; }
        public long DG { get; set; }
        public long Solar { get; set; }
        public long GCPSolar { get; set; }
        public long IEXRenewable { get; set; }
        public long IEXNonRenewable { get; set; }
    }
}
