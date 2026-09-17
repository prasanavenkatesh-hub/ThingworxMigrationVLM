using System.Text.Json.Serialization;

namespace ControlTower.Models;

public class GasLeakAlertDto
{
    // AlertId is a 17-digit yyyyMMddHHmmssfff-based bigint, which exceeds JavaScript's safe
    // integer range (Number.MAX_SAFE_INTEGER). Serializing it as a JSON string (instead of a
    // JSON number) avoids the browser silently rounding it to a different value on parse -
    // same reasoning as FireHydrantAlertDto.
    [JsonNumberHandling(JsonNumberHandling.WriteAsString)]
    public long AlertId { get; set; }
    public DateTime EventTime { get; set; }
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime? SnoozeTime { get; set; }
}

public class SnoozeGasLeakAlertsRequest
{
    // Bound as strings, not long - see FireHydrantController.SnoozeAlerts for why (System.Text.Json
    // rejects a quoted string element when binding into List<long>). Parsed to long explicitly
    // in the controller instead.
    public List<string> AlertIds { get; set; } = new();
    public DateTime SnoozeUntil { get; set; }
}

// Alerts report: one row per alert incident, pairing its open row (StartEvent) with its close
// row (EndEvent, null if still open). No AlertId here - read-only display.
public class GasLeakAlertHistoryDto
{
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime StartEvent { get; set; }
    public DateTime? EndEvent { get; set; }
}
