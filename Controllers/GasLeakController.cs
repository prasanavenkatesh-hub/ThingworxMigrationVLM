using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GasLeakController : ControllerBase
{
    private readonly GasLeakStateStore _store;
    private readonly GasLeakAlertRepository _alertRepo;
    private readonly GasLeakAlertMonitor _alertMonitor;
    private readonly GasLeakMqttBackgroundService _mqtt;

    public GasLeakController(GasLeakStateStore store, GasLeakAlertRepository alertRepo, GasLeakAlertMonitor alertMonitor, GasLeakMqttBackgroundService mqtt)
    {
        _store = store;
        _alertRepo = alertRepo;
        _alertMonitor = alertMonitor;
        _mqtt = mqtt;
    }

    [HttpGet("status")]
    public ActionResult<GasLeakStatus> GetStatus()
    {
        return Ok(_store.GetStatus());
    }

    [HttpPost("valve/{target}")]
    public async Task<IActionResult> ToggleValve(string target)
    {
        if (target is not ("lot1" or "lot2"))
            return BadRequest($"Unknown or read-only valve target '{target}'.");

        return await _mqtt.PublishValveCommandAsync(target)
            ? Ok()
            : Problem($"MQTT broker is not currently connected (or '{target}''s command topic isn't configured yet); the command was not sent.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    [HttpGet("alerts")]
    public async Task<ActionResult<List<GasLeakAlertDto>>> GetAlerts()
    {
        return Ok(await _alertRepo.GetOpenAlertsAsync());
    }

    [HttpPost("alerts/snooze")]
    public async Task<IActionResult> SnoozeAlerts([FromBody] SnoozeGasLeakAlertsRequest request)
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
    public async Task<ActionResult<List<GasLeakAlertHistoryDto>>> GetAlertHistory([FromQuery] DateTime start, [FromQuery] DateTime end)
    {
        return Ok(await _alertRepo.GetAlertHistoryAsync(ToLocal(start), ToLocal(end)));
    }

    // See FireHydrantController.ToLocal - same UTC/local timezone gotcha applies here.
    private static DateTime ToLocal(DateTime dt) => dt.Kind == DateTimeKind.Utc ? dt.ToLocalTime() : dt;
}
