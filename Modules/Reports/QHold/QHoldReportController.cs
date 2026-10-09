using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// Shares the "api/reports" prefix with ReportsController (line reports) - routes are unchanged
// from the original Power BI port, only split out into this module's own controller.
[ApiController]
[Route("api/reports")]
public class QHoldReportController : ControllerBase
{
    private readonly QHoldReportService _service;

    public QHoldReportController(QHoldReportService service)
    {
        _service = service;
    }

    [HttpGet("qhold/data")]
    public async Task<ActionResult<IEnumerable<QHoldReport>>> GetQHoldReport(
        [FromQuery] string? mode,
        [FromQuery] string? startDate,
        [FromQuery] string? endDate,
        [FromQuery] string? model,
        [FromQuery] string? engineNumber,
        [FromQuery] string? qHoldStation,
        [FromQuery] string? result,
        [FromQuery] string? category,
        [FromQuery] string? rejectionDetails,
        [FromQuery] string? reworkDetails,
        [FromQuery] string? shift)
    {
        var data = await _service.GetReportAsync(
            mode ?? "Overall", startDate, endDate, model, engineNumber, qHoldStation, result, category, rejectionDetails, reworkDetails, shift);
        return Ok(data);
    }
}
