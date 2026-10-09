using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/reports")]
public class CategorywiseReworkReportController : ControllerBase
{
    private readonly CategorywiseReworkReportService _service;

    public CategorywiseReworkReportController(CategorywiseReworkReportService service)
    {
        _service = service;
    }

    [HttpGet("categorywise-rework/data")]
    public async Task<ActionResult<IEnumerable<CategorywiseReworkReport>>> GetCategorywiseReworkReport(
        [FromQuery] string? line,
        [FromQuery] string? startDate,
        [FromQuery] string? endDate,
        [FromQuery] string? station)
    {
        if (!_service.IsValidLine(line))
        {
            return BadRequest("line must be EA01 or EA02.");
        }

        var data = await _service.GetReportAsync(line!, startDate, endDate, station);
        return Ok(data);
    }
}
