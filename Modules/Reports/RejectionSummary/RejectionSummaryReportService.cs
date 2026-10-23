using System.Data;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Rejection Summary Report (ported from the "ML-Rejection Summary Report EA L2" and
// "EA2 SA-Rejection Summary Report" Power BI files) - a thin wrapper over
// dbo.usp_GetRejectionSummaryReport in each line's Mainline DB
// (ConnectionStrings:RejectionSummary{Line}Connection). A line without a connection string has no
// data source yet (EA01 today) and returns Available = false.
public class RejectionSummaryReportService
{
    public static readonly string[] Lines = { "EA01", "EA02" };
    public static readonly string[] Sections = { "ML", "SA" };

    private readonly IConfiguration _configuration;

    public RejectionSummaryReportService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public async Task<RejectionSummaryData> GetReportAsync(string line, string section, DateTime startDate, DateTime endDate)
    {
        var data = new RejectionSummaryData { Line = line, Section = section };
        var connectionString = _configuration.GetConnectionString($"RejectionSummary{line}Connection");
        if (string.IsNullOrWhiteSpace(connectionString)) return data;

        data.Available = true;
        using var connection = new SqlConnection(connectionString);

        // Date-time range: the proc reads rows with Date > @StartDate and <= @EndDate.
        var parameters = new DynamicParameters();
        parameters.Add("@Section", section);
        parameters.Add("@StartDate", startDate, DbType.DateTime);
        parameters.Add("@EndDate", endDate, DbType.DateTime);

        data.Rows = (await connection.QueryAsync<RejectionSummaryRow>(
            "dbo.usp_GetRejectionSummaryReport",
            parameters,
            commandType: CommandType.StoredProcedure,
            commandTimeout: 180)).ToList();
        return data;
    }
}
