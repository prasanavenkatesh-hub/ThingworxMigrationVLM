using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/reports")]
public class SubAssemblyReportController : ControllerBase
{
    private readonly SubAssemblyReportService _service;
    private readonly IConfiguration _configuration;

    public SubAssemblyReportController(SubAssemblyReportService service, IConfiguration configuration)
    {
        _service = service;
        _configuration = configuration;
    }

    // subAssembly = one of SubAssemblyReportService.SubAssemblies (e.g. CYLINDER_HEAD, CRANKSHAFT_OP60).
    // startDate / endDate are date-times (From exclusive, To inclusive).
    [HttpGet("sub-assembly/data")]
    public async Task<ActionResult<SubAssemblyReportData>> GetSubAssemblyReport(
        [FromQuery] string? subAssembly,
        [FromQuery] string? startDate,
        [FromQuery] string? endDate)
    {
        var sa = SubAssemblyReportService.SubAssemblies.FirstOrDefault(a => a.Equals(subAssembly, StringComparison.OrdinalIgnoreCase));
        if (sa == null)
        {
            return BadRequest($"subAssembly must be one of: {string.Join(", ", SubAssemblyReportService.SubAssemblies)}.");
        }
        if (!DateTime.TryParse(startDate, out var sd) || !DateTime.TryParse(endDate, out var ed) || sd >= ed)
        {
            return BadRequest("startDate and endDate must be valid date-times with startDate before endDate.");
        }
        var maxDays = _configuration.GetValue("SubAssemblyReport:MaxRangeDays", 93);
        if ((ed - sd).TotalDays > maxDays)
        {
            return BadRequest($"Date range is limited to {maxDays} days.");
        }

        try
        {
            return Ok(await _service.GetReportAsync(sa, sd, ed));
        }
        catch (SqlException ex) when (ex.Number == 2812)
        {
            // 2812 = procedure not found: dbo.usp_GetSubAssemblyReport is deployed by hand.
            return StatusCode(503, $"dbo.usp_GetSubAssemblyReport is not created yet in RE_Vallam_J1EA2_SA_PTL_IPV_DB ({ex.Message})");
        }
    }
}
