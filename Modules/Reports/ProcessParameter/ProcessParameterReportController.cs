using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/reports")]
public class ProcessParameterReportController : ControllerBase
{
    private readonly ProcessParameterReportService _service;
    private readonly IConfiguration _configuration;

    public ProcessParameterReportController(ProcessParameterReportService service, IConfiguration configuration)
    {
        _service = service;
        _configuration = configuration;
    }

    private int Setting(string key, int fallback) => _configuration.GetValue($"ProcessParameterReport:{key}", fallback);

    // The Dynamic Columns lists (Power BI field parameters) for the page's dropdown.
    [HttpGet("process-parameter/columns")]
    public ActionResult GetColumns() => Ok(new
    {
        mainline = ProcessParameterColumns.Mainline,
        qhold = ProcessParameterColumns.QHold,
        pageSize = Setting("PageSize", 100),
        exportMaxRows = Setting("ExportMaxRows", 150000),
        maxRangeDays = Setting("MaxRangeDays", 31)
    });

    // section = ML | QH | DUP; startDate / endDate = calendar dates (both inclusive); timeRange = "07-08" ... "24-01";
    // columns = repeated source column names from the Dynamic Columns lists.
    [HttpGet("process-parameter/data")]
    public async Task<ActionResult<ProcessParameterData>> GetData(
        [FromQuery] string? section, [FromQuery] string? startDate, [FromQuery] string? endDate,
        [FromQuery] string? shift, [FromQuery] string? timeRange, [FromQuery] string? station,
        [FromQuery] string? engine, [FromQuery] string? status, [FromQuery] List<string>? columns,
        [FromQuery] int page = 1)
    {
        var error = TryBuildFilter(section, startDate, endDate, shift, timeRange, station, engine, status, columns, out var filter);
        if (error != null) return BadRequest(error);
        return Ok(await _service.GetPageAsync(filter!, Math.Max(1, page), Setting("PageSize", 100)));
    }

    // Same filters; CSV of up to ProcessParameterReport:ExportMaxRows rows.
    [HttpGet("process-parameter/export")]
    public async Task<IActionResult> Export(
        [FromQuery] string? section, [FromQuery] string? startDate, [FromQuery] string? endDate,
        [FromQuery] string? shift, [FromQuery] string? timeRange, [FromQuery] string? station,
        [FromQuery] string? engine, [FromQuery] string? status, [FromQuery] List<string>? columns)
    {
        var error = TryBuildFilter(section, startDate, endDate, shift, timeRange, station, engine, status, columns, out var filter);
        if (error != null) return BadRequest(error);

        var name = $"Process_Parameter_{filter!.Section}_{filter.FromDate:yyyyMMdd}_{filter.ToDate:yyyyMMdd}.csv";
        Response.ContentType = "text/csv; charset=utf-8";
        Response.Headers.ContentDisposition = $"attachment; filename=\"{name}\"";
        await _service.WriteCsvAsync(filter, Setting("ExportMaxRows", 150000), Response.Body, HttpContext.RequestAborted);
        return new EmptyResult();
    }

    private string? TryBuildFilter(string? section, string? startDate, string? endDate, string? shift, string? timeRange,
        string? station, string? engine, string? status, List<string>? columns, out ProcessParameterFilter? filter)
    {
        filter = null;
        var s = ProcessParameterReportService.Sections.FirstOrDefault(a => a.Equals(section, StringComparison.OrdinalIgnoreCase));
        if (s == null) return "section must be ML, QH or DUP.";
        if (!DateTime.TryParse(startDate, out var from) || !DateTime.TryParse(endDate, out var to) || from.Date > to.Date)
            return "startDate and endDate must be valid dates with startDate on or before endDate.";
        var maxDays = Setting("MaxRangeDays", 31);
        if ((to.Date - from.Date).TotalDays + 1 > maxDays) return $"Date range is limited to {maxDays} days.";
        if (!string.IsNullOrEmpty(shift) && shift is not ("A" or "B" or "C")) return "shift must be A, B or C.";

        int? hour = null;
        if (!string.IsNullOrEmpty(timeRange))
        {
            if (timeRange.Length != 5 || !int.TryParse(timeRange[..2], out var h) || h < 1 || h > 24) return "timeRange must look like 07-08.";
            hour = h == 24 ? 0 : h;   // "24-01" = 00:00-00:59
        }

        filter = new ProcessParameterFilter
        {
            Section = s, FromDate = from.Date, ToDate = to.Date, Shift = string.IsNullOrEmpty(shift) ? null : shift, Hour = hour,
            Station = string.IsNullOrWhiteSpace(station) ? null : station.Trim(),
            Engine = string.IsNullOrWhiteSpace(engine) ? null : engine.Trim(),
            Status = string.IsNullOrWhiteSpace(status) ? null : status.Trim(),
            Columns = columns ?? new List<string>()
        };
        return null;
    }
}
