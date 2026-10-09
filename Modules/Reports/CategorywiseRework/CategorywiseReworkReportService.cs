using System.Data;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Categorywise Rework Report (ported from Power BI). Each assembly line has its own Rework DB,
// each holding an identical dbo.usp_GetCategorywiseReworkReport, so the line only selects the
// connection (ConnectionStrings:ReworkEA01Connection / ReworkEA02Connection).
public class CategorywiseReworkReportService
{
    private readonly Dictionary<string, string> _connectionStrings;

    public CategorywiseReworkReportService(IConfiguration configuration)
    {
        _connectionStrings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["EA01"] = configuration.GetConnectionString("ReworkEA01Connection") ?? "",
            ["EA02"] = configuration.GetConnectionString("ReworkEA02Connection") ?? ""
        };
    }

    public bool IsValidLine(string? line) =>
        !string.IsNullOrWhiteSpace(line) && _connectionStrings.ContainsKey(line);

    public async Task<IEnumerable<CategorywiseReworkReport>> GetReportAsync(
        string line,
        string? startDate,
        string? endDate,
        string? station)
    {
        using var connection = new SqlConnection(_connectionStrings[line]);

        // Date-time range from the From/To pickers; the proc filters Date_Time > @StartDate AND <= @EndDate.
        var parameters = new DynamicParameters();
        parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? sd : (object?)null, DbType.DateTime);
        parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? ed : (object?)null, DbType.DateTime);
        parameters.Add("@Station", string.IsNullOrWhiteSpace(station) || station == "ALL" ? null : station);

        return await connection.QueryAsync<CategorywiseReworkReport>(
            "dbo.usp_GetCategorywiseReworkReport",
            parameters,
            commandType: CommandType.StoredProcedure,
            commandTimeout: 120);
    }
}
