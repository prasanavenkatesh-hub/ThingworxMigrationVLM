using System.Data;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace ControlTower.Services;

// Summary Report (ported from Power BI business rules): one dbo.usp_GetSummaryReport per line
// database (ConnectionStrings:Summary{Line}Connection), taking the stage as a parameter.
public class SummaryReportService
{
    public static readonly string[] Lines = { "EA01", "EA02" };
    public static readonly string[] Stages = { "Leak", "PDI", "Testing" };
    // Same limit as the page's SR_MAX_DAYS.
    public const int MaxRangeDays = 93;
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(60);

    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;

    public SummaryReportService(IConfiguration configuration, IMemoryCache cache)
    {
        _configuration = configuration;
        _cache = cache;
    }

    public bool IsValidRequest(string? line, string? stage) =>
        !string.IsNullOrWhiteSpace(line) && !string.IsNullOrWhiteSpace(stage)
        && Lines.Contains(line, StringComparer.OrdinalIgnoreCase)
        && Stages.Contains(stage, StringComparer.OrdinalIgnoreCase);

    public async Task<SummaryReportData> GetReportAsync(string line, string stage, DateTime startDate, DateTime endDate)
    {
        line = line.ToUpperInvariant();
        stage = Stages.First(k => k.Equals(stage, StringComparison.OrdinalIgnoreCase));

        // Shop-floor data changes every few seconds; a short cache stops auto-refreshing TVs and
        // several viewers from each re-running the same month-long query.
        var cacheKey = $"summary:{line}:{stage}:{startDate:yyyyMMdd}:{endDate:yyyyMMdd}";
        if (_cache.TryGetValue(cacheKey, out SummaryReportData? cached) && cached != null)
        {
            return cached;
        }

        var data = new SummaryReportData { Line = line, Stage = stage, GeneratedAt = DateTime.Now };

        using (var connection = new SqlConnection(_configuration.GetConnectionString($"Summary{line}Connection") ?? ""))
        {
            // Production days, inclusive; the proc turns them into the 00:15 -> 00:15 window.
            var parameters = new DynamicParameters();
            parameters.Add("@Stage", stage);
            parameters.Add("@StartDate", startDate.Date, DbType.Date);
            parameters.Add("@EndDate", endDate.Date, DbType.Date);

            using var grid = await connection.QueryMultipleAsync(
                "dbo.usp_GetSummaryReport",
                parameters,
                commandType: CommandType.StoredProcedure,
                commandTimeout: 180);

            // Fixed result-set order (see the proc header); EA02 has no Monthly set.
            async Task<List<SummaryReportRow>> Next() =>
                grid.IsConsumed ? new List<SummaryReportRow>() : (await grid.ReadAsync<SummaryReportRow>()).ToList();

            data.Daily = await Next();
            data.Hourly = await Next();
            data.Latest = await Next();
            data.Rework = await Next();
            data.Range = await Next();
        }

        // Leak's Daily set carries the Bypassed / NA / Empty counts of the Power BI Status table too.
        if (stage == "Leak") data.Status = data.Daily;

        _cache.Set(cacheKey, data, CacheDuration);
        return data;
    }
}
