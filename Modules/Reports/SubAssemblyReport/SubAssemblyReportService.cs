using System.Data;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// StraightPass & Rework Sub Assembly Report (EA2), ported from the "StraightPass & Rework
// subassemblyReport" Power BI file - a thin wrapper over dbo.usp_GetSubAssemblyReport in
// RE_Vallam_J1EA2_SA_PTL_IPV_DB (ConnectionStrings:SubAssemblyReportConnection). One call returns the
// four result sets for one sub-assembly; station / shift / cell filtering is done by the page.
public class SubAssemblyReportService
{
    public static readonly string[] SubAssemblies =
    {
        "BALANCER_SHAFT", "CRANKSHAFT_PISTON_BARREL", "GEAR_TRAIN", "GEAR_SHIFT_SHAFT", "EFI", "CAM_LADDER",
        "CYLINDER_HEAD", "CRANKCASE", "CRANKCASE_RH_LGA", "MAGNETO_COVER", "ROTOR", "ENGINE_TESTBED",
        "CLUTCH_COVER", "CRANKSHAFT", "CRANKSHAFT_OP60"
    };

    private readonly IConfiguration _configuration;

    public SubAssemblyReportService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public async Task<SubAssemblyReportData> GetReportAsync(string subAssembly, DateTime startDate, DateTime endDate)
    {
        var connectionString = _configuration.GetConnectionString("SubAssemblyReportConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:SubAssemblyReportConnection is not configured.");
        using var connection = new SqlConnection(connectionString);

        // Date-time range: the proc counts rows with time > @StartDate and <= @EndDate.
        var parameters = new DynamicParameters();
        parameters.Add("@SubAssembly", subAssembly);
        parameters.Add("@StartDate", startDate, DbType.DateTime);
        parameters.Add("@EndDate", endDate, DbType.DateTime);

        // The source tables have no date index, so a month takes ~3-45 s (Gear Train slowest).
        using var grid = await connection.QueryMultipleAsync(
            "dbo.usp_GetSubAssemblyReport",
            parameters,
            commandType: CommandType.StoredProcedure,
            commandTimeout: _configuration.GetValue("SubAssemblyReport:CommandTimeoutSeconds", 300));

        var data = new SubAssemblyReportData
        {
            SubAssembly = subAssembly,
            Assy = (await grid.ReadAsync<SubAssemblyCountRow>()).ToList(),
            StraightPass = (await grid.ReadAsync<SubAssemblyCountRow>()).ToList(),
            Bypassed = (await grid.ReadAsync<SubAssemblyCountRow>()).ToList(),
            Rework = (await grid.ReadAsync<SubAssemblyReworkRow>()).ToList()
        };
        // Result set 5 (reworked engines) - only in the updated proc.
        if (!grid.IsConsumed)
        {
            data.ReworkEngines = (await grid.ReadAsync<SubAssemblyReworkEngineRow>()).ToList();
        }
        return data;
    }
}
