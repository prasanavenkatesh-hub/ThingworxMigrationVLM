using System.Data;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Engine QHold Report (ported from Power BI) - a thin wrapper over dbo.usp_GetQHoldReport in the
// QHold / PDI database (ConnectionStrings:QHoldConnection). All filtering happens in the proc.
public class QHoldReportService
{
    private readonly string _connectionString;

    public QHoldReportService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("QHoldConnection") ?? "";
    }

    public async Task<IEnumerable<QHoldReport>> GetReportAsync(
        string mode,
        string? startDate,
        string? endDate,
        string? model,
        string? engineNumber,
        string? qHoldStation,
        string? result,
        string? category,
        string? rejectionDetails,
        string? reworkDetails,
        string? shift)
    {
        using var connection = new SqlConnection(_connectionString);

        var parameters = new DynamicParameters();
        parameters.Add("@Mode", string.IsNullOrWhiteSpace(mode) ? "Overall" : mode);
        parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? sd : (object?)null);
        parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? ed : (object?)null);
        parameters.Add("@Model", model);
        parameters.Add("@EngineNumber", engineNumber);
        parameters.Add("@QHoldStation", qHoldStation);
        parameters.Add("@Result", result);
        parameters.Add("@Category", category);
        parameters.Add("@RejectionDetails", rejectionDetails);
        parameters.Add("@ReworkDetails", reworkDetails);
        parameters.Add("@Shift", shift);

        return await connection.QueryAsync<QHoldReport>(
            "dbo.usp_GetQHoldReport",
            parameters,
            commandType: CommandType.StoredProcedure);
    }
}
