using System.Globalization;
using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// EB-RTM Reports (Reports > Energy). from / to are production days (yyyy-MM-dd), inclusive.
[ApiController]
[Route("api/reports/ebrtm")]
public class EbRtmReportController : ControllerBase
{
    private readonly EbRtmReportService _service;

    public EbRtmReportController(EbRtmReportService service)
    {
        _service = service;
    }

    [HttpGet("meters")]
    public ActionResult<List<EbRtmMeterInfo>> GetMeters() => Ok(_service.GetMeters());

    [HttpGet("energy-consumption")]
    public async Task<ActionResult<List<EbRtmEnergyReportRow>>> GetEnergyConsumption([FromQuery] string? meter, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (Validate(meter, from, to, out var m, out var f, out var t) is { } error) return error;
        return Ok(await _service.GetEnergyConsumptionAsync(m!, f, t));
    }

    [HttpGet("power-failure")]
    public async Task<ActionResult<List<EbRtmPowerFailureReportRow>>> GetPowerFailures([FromQuery] string? meter, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (Validate(meter, from, to, out var m, out var f, out var t) is { } error) return error;
        return Ok(await _service.GetPowerFailuresAsync(m!, f, t));
    }

    [HttpGet("alerts")]
    public async Task<ActionResult<List<EbRtmAlertReportRow>>> GetAlerts([FromQuery] string? meter, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (Validate(meter, from, to, out var m, out var f, out var t) is { } error) return error;
        return Ok(await _service.GetAlertsAsync(m!, f, t));
    }

    // parameter = maxdemand | voltage | powerfactor | frequency
    [HttpGet("mma")]
    public async Task<ActionResult<List<EbRtmMmaReportRow>>> GetMma([FromQuery] string? meter, [FromQuery] string? parameter, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (!EbRtmReportService.IsMmaParameter(parameter))
            return BadRequest("parameter must be maxdemand, voltage, powerfactor or frequency.");
        if (Validate(meter, from, to, out var m, out var f, out var t) is { } error) return error;
        return Ok(await _service.GetMmaAsync(m!, parameter!, f, t));
    }

    private ActionResult? Validate(string? meter, string? from, string? to, out EbRtmMeterInfo? m, out DateTime f, out DateTime t)
    {
        m = _service.FindMeter(meter);
        t = default;
        if (m == null) { f = default; return BadRequest($"Unknown meter '{meter}'."); }
        if (!DateTime.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out f)
            || !DateTime.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out t))
            return BadRequest("from and to must be dates in yyyy-MM-dd format.");
        if (f > t) return BadRequest("from must not be after to.");
        if ((t - f).TotalDays >= EbRtmReportService.MaxRangeDays)
            return BadRequest($"Date range is limited to {EbRtmReportService.MaxRangeDays} days.");
        return null;
    }
}
