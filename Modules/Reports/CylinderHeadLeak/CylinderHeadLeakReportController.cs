using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/reports")]
public class CylinderHeadLeakReportController : ControllerBase
{
    private readonly CylinderHeadLeakReportService _service;

    public CylinderHeadLeakReportController(CylinderHeadLeakReportService service)
    {
        _service = service;
    }

    [HttpGet("cylinder-head-leak/data")]
    public async Task<ActionResult<IEnumerable<CylinderHeadLeakReport>>> GetCylinderHeadLeakReport(
        [FromQuery] string? startDate,
        [FromQuery] string? endDate,
        [FromQuery] string? plant,
        [FromQuery] string? assemblyLine,
        [FromQuery] string? shift)
    {
        var data = await _service.GetReportAsync(startDate, endDate, plant, assemblyLine, shift);
        return Ok(data);
    }
}
