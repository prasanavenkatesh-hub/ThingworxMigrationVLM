using System.Text.Json.Serialization;

namespace ControlTower.Models;

public class FireHydrantAlertDto
{
    // AlertId is a 17-digit yyyyMMddHHmmssfff-based bigint, which exceeds JavaScript's safe
    // integer range (Number.MAX_SAFE_INTEGER). Serializing it as a JSON string (instead of a
    // JSON number) avoids the browser silently rounding it to a different value on parse.
    [JsonNumberHandling(JsonNumberHandling.WriteAsString)]
    public long AlertId { get; set; }
    public DateTime EventTime { get; set; }
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime? SnoozeTime { get; set; }
}

public class SnoozeAlertsRequest
{
    // Bound as strings, not long: JsonNumberHandling.WriteAsString on a List<long> only covers
    // output, not reading quoted string elements back - System.Text.Json rejects those with a
    // 400 (verified). Parsed to long explicitly in the controller instead.
    public List<string> AlertIds { get; set; } = new();
    public DateTime SnoozeUntil { get; set; }
}

// Alerts report tab: one row per alert incident, pairing its open row (StartEvent) with its
// close row (EndEvent, null if still open). No AlertId here - this is read-only display, so
// the JS-precision dance FireHydrantAlertDto.AlertId needs isn't worth it for this DTO.
public class FireHydrantAlertHistoryDto
{
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime StartEvent { get; set; }
    public DateTime? EndEvent { get; set; }
}
