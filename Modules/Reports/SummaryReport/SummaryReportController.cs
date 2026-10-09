using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/reports")]
public class SummaryReportController : ControllerBase
{
    private readonly SummaryReportService _service;

    public SummaryReportController(SummaryReportService service)
    {
        _service = service;
    }

    // startDate / endDate are production days (yyyy-MM-dd), inclusive.
    [HttpGet("summary/data")]
    public async Task<ActionResult<SummaryReportData>> GetSummaryReport(
        [FromQuery] string? line,
        [FromQuery] string? stage,
        [FromQuery] string? startDate,
        [FromQuery] string? endDate)
    {
        if (!_service.IsValidRequest(line, stage))
        {
            return BadRequest("line must be EA01 or EA02 and stage must be Leak, PDI or Testing.");
        }
        if (!DateTime.TryParse(startDate, out var sd) || !DateTime.TryParse(endDate, out var ed) || sd.Date > ed.Date)
        {
            return BadRequest("startDate and endDate must be valid dates with startDate <= endDate.");
        }
        if ((ed.Date - sd.Date).TotalDays > SummaryReportService.MaxRangeDays - 1)
        {
            return BadRequest($"Date range is limited to {SummaryReportService.MaxRangeDays} days.");
        }

        try
        {
            return Ok(await _service.GetReportAsync(line!, stage!, sd, ed));
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 2812)
        {
            // 2812 = procedure not found: dbo.usp_GetSummaryReport is deployed by hand per line database.
            return StatusCode(503, $"dbo.usp_GetSummaryReport is not created yet in the {line!.ToUpperInvariant()} database ({ex.Message})");
        }
    }
}
