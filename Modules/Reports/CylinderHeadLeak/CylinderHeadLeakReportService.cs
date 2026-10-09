using System.Data;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Cylinder Head Leak Rejection Report (ported from Power BI) - a thin wrapper over
// dbo.usp_GetCylinderHeadLeakRejectionReport (ConnectionStrings:CylinderHeadLeakConnection).
public class CylinderHeadLeakReportService
{
    private readonly string _connectionString;

    public CylinderHeadLeakReportService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("CylinderHeadLeakConnection") ?? "";
    }

    public async Task<IEnumerable<CylinderHeadLeakReport>> GetReportAsync(
        string? startDate,
        string? endDate,
        string? plant,
        string? assemblyLine,
        string? shift)
    {
        using var connection = new SqlConnection(_connectionString);

        var parameters = new DynamicParameters();
        parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? sd : (object?)null);
        parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? ed : (object?)null);
        parameters.Add("@Plant", plant);
        parameters.Add("@AssemblyLine", assemblyLine);
        parameters.Add("@Shift", shift);

        return await connection.QueryAsync<CylinderHeadLeakReport>(
            "dbo.usp_GetCylinderHeadLeakRejectionReport",
            parameters,
            commandType: CommandType.StoredProcedure,
            commandTimeout: 120);
    }
}
