using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/reports")]
public class RejectionSummaryReportController : ControllerBase
{
    private readonly RejectionSummaryReportService _service;

    public RejectionSummaryReportController(RejectionSummaryReportService service)
    {
        _service = service;
    }

    // line = EA01 | EA02, section = ML (Main Line) | SA (Sub Assembly).
    // startDate / endDate are date-times (From exclusive, To inclusive).
    [HttpGet("rejection-summary/data")]
    public async Task<ActionResult<RejectionSummaryData>> GetRejectionSummaryReport(
        [FromQuery] string? line,
        [FromQuery] string? section,
        [FromQuery] string? startDate,
        [FromQuery] string? endDate)
    {
        var l = RejectionSummaryReportService.Lines.FirstOrDefault(a => a.Equals(line, StringComparison.OrdinalIgnoreCase));
        var s = RejectionSummaryReportService.Sections.FirstOrDefault(a => a.Equals(section, StringComparison.OrdinalIgnoreCase));
        if (l == null || s == null)
        {
            return BadRequest("line must be EA01 or EA02 and section ML or SA.");
        }
        if (!DateTime.TryParse(startDate, out var sd) || !DateTime.TryParse(endDate, out var ed) || sd >= ed)
        {
            return BadRequest("startDate and endDate must be valid date-times with startDate before endDate.");
        }
        if ((ed - sd).TotalDays > 93)
        {
            return BadRequest("Date range is limited to 93 days.");
        }

        try
        {
            return Ok(await _service.GetReportAsync(l, s, sd, ed));
        }
        catch (SqlException ex) when (ex.Number == 2812)
        {
            // 2812 = procedure not found: dbo.usp_GetRejectionSummaryReport is deployed by hand.
            return StatusCode(503, $"dbo.usp_GetRejectionSummaryReport is not created yet in the {l} database ({ex.Message})");
        }
    }
}
