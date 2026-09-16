using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Reads/writes [FireHydrant].[dbo].[PumpRunningCount] via PokeYokeDataConnection. Unlike
// Alerts, this table's DateTime column is a real datetime (verified before writing this) -
// "id" still has no identity/default though, so it's assigned as MAX(id)+1 on insert, same
// as FireHydrantAlertRepository.
public class FireHydrantPumpCountRepository
{
    private static readonly string[] PumpNames =
    [
        "Diesel Pump", "Hydrant Main Pump", "Hydrant Jockey Pump", "Sprinkler Jockey Pump", "Sprinkler Main Pump"
    ];

    private readonly string _connectionString;

    public FireHydrantPumpCountRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("PokeYokeDataConnection") ?? "";
    }

    public async Task<int?> GetLastCountAsync(string pump)
    {
        const string sql = @"
            SELECT TOP 1 [Count] FROM [FireHydrant].[dbo].[PumpRunningCount]
            WHERE [Pump] = @Pump ORDER BY [DateTime] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<int?>(sql, new { Pump = pump });
    }

    public async Task InsertAsync(string pump, int count, DateTime dateTime)
    {
        const string sql = @"
            INSERT INTO [FireHydrant].[dbo].[PumpRunningCount] ([id], [DateTime], [Pump], [Count])
            SELECT ISNULL(MAX([id]), 0) + 1, @DateTime, @Pump, @Count
            FROM [FireHydrant].[dbo].[PumpRunningCount]";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, new { DateTime = dateTime, Pump = pump, Count = count });
    }

    // The MQTT tag's cumulative count resets to 0 every day (confirmed by the user), so a
    // plain EndCount-StartCount across a multi-day range would be wrong - even negative -
    // whenever a reset falls inside the range. Instead this sums each calendar day's delta
    // separately: a day resets to 0 at its own midnight, so a day fully inside the range
    // contributes its last-logged count that day (0 baseline); only the first day (if the
    // range doesn't start at midnight) subtracts whatever had already accumulated before
    // `start`. StartCount/EndCount are still returned for display (the raw counter reading at
    // the exact start/end instant), but RunCount - not their difference - is the real total.
    public async Task<List<PumpCountSummaryDto>> GetSummaryAsync(DateTime start, DateTime end)
    {
        const string sql = @"
            SELECT [Pump], [DateTime], [Count]
            FROM [FireHydrant].[dbo].[PumpRunningCount]
            WHERE [Pump] IN @Pumps AND [DateTime] >= @RangeStart AND [DateTime] <= @RangeEnd
            ORDER BY [Pump], [DateTime]";

        var rangeStart = start.Date;
        var rangeEnd = end.Date.AddDays(1).AddTicks(-1);

        using var conn = new SqlConnection(_connectionString);
        var rows = (await conn.QueryAsync<PumpCountRow>(sql, new { Pumps = PumpNames, RangeStart = rangeStart, RangeEnd = rangeEnd })).ToList();

        var results = new List<PumpCountSummaryDto>();
        foreach (var pumpName in PumpNames)
        {
            var pumpRows = rows.Where(r => r.Pump == pumpName).ToList();

            long LastAtOrBefore(DateTime day, DateTime cutoff) =>
                pumpRows.Where(r => r.DateTime.Date == day.Date && r.DateTime <= cutoff)
                        .OrderByDescending(r => r.DateTime)
                        .Select(r => (long?)r.Count).FirstOrDefault() ?? 0;

            long runCount = 0;
            for (var day = start.Date; day <= end.Date; day = day.AddDays(1))
            {
                var upperBound = day == end.Date ? end : day.AddDays(1).AddTicks(-1);
                var upperValue = LastAtOrBefore(day, upperBound);
                // Every day resets to 0 at its own midnight, except the range's first day,
                // which may already have accumulated some count before `start`.
                var lowerValue = day == start.Date ? LastAtOrBefore(day, start) : 0;
                runCount += upperValue - lowerValue;
            }

            if (runCount <= 0) continue; // only pumps that actually ran in this range are reported

            results.Add(new PumpCountSummaryDto
            {
                Pump = pumpName,
                StartCount = LastAtOrBefore(start, start),
                EndCount = LastAtOrBefore(end, end),
                RunCount = runCount
            });
        }

        return results;
    }

    private class PumpCountRow
    {
        public string Pump { get; set; } = "";
        public DateTime DateTime { get; set; }
        public long Count { get; set; }
    }
}
