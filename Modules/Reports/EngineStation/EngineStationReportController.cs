using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace ControlTower.Controllers;

// Engine Station reports - {report} = leak-station | pdi-station | engine-testbed
// (EngineStationReportDefinitions). Read-only. The data call is a POST only because the multi-select
// filters (up to 500 engine numbers) would overflow IIS's 2048-character query-string limit.
//   POST {report}/data                          body EngineStationRequest
//   GET  {report}/filters?line&from&to          filter options (+ Bed Wise bed map for engine-testbed)
//   GET  {report}/engine-numbers?line&from&to   latest engine numbers in the range
// from / to = JS toISOString() (UTC) -> server-local via ApiDateTime.ToLocal. Errors: { message }.
// No [ApiController]: its automatic ProblemDetails 400s would not carry { message }.
[Route("api/reports")]
public class EngineStationReportController : ControllerBase
{
    private readonly EngineStationReportService _service;
    private readonly ILogger<EngineStationReportController> _logger;

    public EngineStationReportController(EngineStationReportService service, ILogger<EngineStationReportController> logger)
    {
        _service = service;
        _logger = logger;
    }

    [HttpPost("{report}/data")]
    public async Task<IActionResult> GetData(string report, [FromBody] EngineStationRequest? request)
    {
        var def = EngineStationReportDefinitions.Find(report);
        if (def == null) return UnknownReport(report);
        if (request == null) return Error(400, "Request body must be JSON: { line, mode, from, to, filters }.");

        var line = EngineStationReportDefinitions.CanonicalLine(request.Line);
        if (line == null) return Error(400, $"line must be one of: {string.Join(", ", EngineStationReportDefinitions.Lines)}.");
        var mode = EngineStationReportDefinitions.CanonicalMode(request.Mode);
        if (mode == null) return Error(400, $"mode must be one of: {string.Join(", ", EngineStationReportDefinitions.Modes)}.");

        var from = ToLocal(request.From);
        var to = ToLocal(request.To);
        var rangeError = _service.ValidateRange(from, to);
        if (rangeError != null) return Error(400, rangeError);

        var filterError = _service.BuildFilterValues(def, request.Filters, out var filterValues);
        if (filterError != null) return Error(400, filterError);

        var procedure = def.DataProcedure(line, mode);
        return await Run(procedure, () => _service.GetDataAsync(def, line, mode, from!.Value, to!.Value, filterValues, HttpContext.RequestAborted));
    }

    [HttpGet("{report}/filters")]
    public async Task<IActionResult> GetFilters(string report, [FromQuery] string? line, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var def = EngineStationReportDefinitions.Find(report);
        if (def == null) return UnknownReport(report);
        var l = EngineStationReportDefinitions.CanonicalLine(line);
        if (l == null) return Error(400, $"line must be one of: {string.Join(", ", EngineStationReportDefinitions.Lines)}.");
        var f = ToLocal(from);
        var t = ToLocal(to);
        var rangeError = _service.ValidateRange(f, t);
        if (rangeError != null) return Error(400, rangeError);

        return await Run(def.FilterDataProcedure(l), () => _service.GetFilterOptionsAsync(def, l, f!.Value, t!.Value, HttpContext.RequestAborted));
    }

    [HttpGet("{report}/engine-numbers")]
    public async Task<IActionResult> GetEngineNumbers(string report, [FromQuery] string? line, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var def = EngineStationReportDefinitions.Find(report);
        if (def == null) return UnknownReport(report);
        var l = EngineStationReportDefinitions.CanonicalLine(line);
        if (l == null) return Error(400, $"line must be one of: {string.Join(", ", EngineStationReportDefinitions.Lines)}.");
        var f = ToLocal(from);
        var t = ToLocal(to);
        var rangeError = _service.ValidateRange(f, t);
        if (rangeError != null) return Error(400, rangeError);

        return await Run($"dbo.{def.MasterTables[l]}", () => _service.GetEngineNumbersAsync(def, l, f!.Value, t!.Value, HttpContext.RequestAborted));
    }

    // Runs one query and maps SQL failures to HTTP (the source returned HTTP 200 with an error row).
    private async Task<IActionResult> Run<T>(string sqlObject, Func<Task<T>> query)
    {
        try
        {
            return Ok(await query());
        }
        catch (Exception ex) when (HttpContext.RequestAborted.IsCancellationRequested
                                   && (ex is OperationCanceledException || ex is SqlException))
        {
            return StatusCode(499); // client closed the tab / aborted the fetch; the query was cancelled
        }
        catch (SqlException ex) when (ex.Number == -2)
        {
            return Error(504, $"{sqlObject} timed out - narrow the date range or the filters.");
        }
        catch (SqlException ex) when (ex.Number is 229 or 2812)
        {
            // 229 = EXECUTE/SELECT permission denied, 2812 = procedure not found (or not visible to the login).
            _logger.LogWarning(ex, "Engine Station report: {Object} unavailable", sqlObject);
            return Error(503, $"{sqlObject} is missing or the login has no permission on it - ask the DBA (FACTREPRDETL, see Modules/Reports/EngineStation/Sql/). SQL {ex.Number}: {ex.Message}");
        }
        catch (SqlException ex) when (ex.Number is 4060 or 18456)
        {
            _logger.LogWarning(ex, "Engine Station report: cannot open FACTREPRDETL for {Object}", sqlObject);
            return Error(503, $"Cannot open database FACTREPRDETL for {sqlObject} (login failed or no access). SQL {ex.Number}: {ex.Message}");
        }
        catch (SqlException ex)
        {
            _logger.LogError(ex, "Engine Station report: {Object} failed", sqlObject);
            return Error(500, $"{sqlObject} failed. SQL {ex.Number}: {ex.Message}");
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("EngineStationConnection"))
        {
            return Error(503, ex.Message);
        }
    }

    private static DateTime? ToLocal(DateTime? dt) => dt == null ? null : ApiDateTime.ToLocal(dt.Value);

    private IActionResult UnknownReport(string report) =>
        Error(404, $"Unknown report '{report}'. Use one of: {string.Join(", ", EngineStationReportDefinitions.All.Keys)}.");

    private ObjectResult Error(int status, string message) => StatusCode(status, new { message });
}
