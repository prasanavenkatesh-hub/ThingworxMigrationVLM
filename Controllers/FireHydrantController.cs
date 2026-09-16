using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FireHydrantController : ControllerBase
{
    private readonly FireHydrantStateStore _store;
    private readonly FireHydrantAlertRepository _alertRepo;
    private readonly FireHydrantAlertMonitor _alertMonitor;
    private readonly FireHydrantPumpCountRepository _pumpCountRepo;
    private readonly FireHydrantPumpDurationRepository _pumpDurationRepo;

    public FireHydrantController(FireHydrantStateStore store, FireHydrantAlertRepository alertRepo, FireHydrantAlertMonitor alertMonitor, FireHydrantPumpCountRepository pumpCountRepo, FireHydrantPumpDurationRepository pumpDurationRepo)
    {
        _store = store;
        _alertRepo = alertRepo;
        _alertMonitor = alertMonitor;
        _pumpCountRepo = pumpCountRepo;
        _pumpDurationRepo = pumpDurationRepo;
    }

    [HttpGet("status")]
    public ActionResult<FireHydrantStatus> GetStatus()
    {
        return Ok(_store.GetStatus());
    }

    [HttpGet("alerts")]
    public async Task<ActionResult<List<FireHydrantAlertDto>>> GetAlerts()
    {
        return Ok(await _alertRepo.GetOpenAlertsAsync());
    }

    [HttpPost("alerts/snooze")]
    public async Task<IActionResult> SnoozeAlerts([FromBody] SnoozeAlertsRequest request)
    {
        if (request.AlertIds == null || request.AlertIds.Count == 0) return BadRequest();

        var alertIds = new List<long>();
        foreach (var raw in request.AlertIds)
        {
            if (!long.TryParse(raw, out var alertId)) return BadRequest($"Invalid alertId: {raw}");
            alertIds.Add(alertId);
        }

        var snoozeUntil = ToLocal(request.SnoozeUntil);
        await _alertRepo.SnoozeAsync(alertIds, snoozeUntil);
        await _alertMonitor.ApplySnoozeAsync(alertIds, snoozeUntil);
        return NoContent();
    }

    [HttpGet("alerts/history")]
    public async Task<ActionResult<List<FireHydrantAlertHistoryDto>>> GetAlertHistory([FromQuery] DateTime start, [FromQuery] DateTime end)
    {
        return Ok(await _alertRepo.GetAlertHistoryAsync(ToLocal(start), ToLocal(end)));
    }

    [HttpGet("pumpcount/summary")]
    public async Task<ActionResult<List<PumpCountSummaryDto>>> GetPumpCountSummary([FromQuery] DateTime start, [FromQuery] DateTime end)
    {
        return Ok(await _pumpCountRepo.GetSummaryAsync(ToLocal(start), ToLocal(end)));
    }

    [HttpGet("pumpduration/sessions")]
    public async Task<ActionResult<List<FireHydrantPumpDurationDto>>> GetPumpDurationSessions([FromQuery] DateTime start, [FromQuery] DateTime end)
    {
        return Ok(await _pumpDurationRepo.GetSessionsAsync(ToLocal(start), ToLocal(end)));
    }

    // The frontend sends datetimes via JS's toISOString(), which is always UTC ("Z"-suffixed).
    // ASP.NET Core's model binder parses that into a DateTime with Kind=Utc but does NOT shift
    // the value to local time - and every DateTime stored in these tables is local server time
    // (DateTime.Now). Left uncorrected, a query/snooze time arrives 5.5h (IST) off from what
    // the user actually picked, silently excluding recent data or expiring a snooze instantly.
    private static DateTime ToLocal(DateTime dt) => dt.Kind == DateTimeKind.Utc ? dt.ToLocalTime() : dt;
}
