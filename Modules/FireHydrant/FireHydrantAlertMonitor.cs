using System.Collections.Concurrent;
using ControlTower.Models;

namespace ControlTower.Services;

// Watches the live FireHydrantStatus for red-condition transitions (water/diesel level
// <=20%, pressure <4.5 or >9.5 bar) and persists open/close rows to the Alerts table via
// FireHydrantAlertRepository. Called after every MQTT payload update.
public class FireHydrantAlertMonitor
{
    private const double LevelAlertThreshold = 20.0;
    private const double PressureLow = 4.5;
    private const double PressureHigh = 9.5;

    // A reading must sit in a red zone continuously for this long before it's confirmed and
    // acted on. Absorbs a single transient bad-but-quality-flagged MQTT reading (observed in
    // practice: 5 unrelated metrics all flipped red and back within under a second) without
    // delaying a genuinely sustained condition by more than this window.
    private const double DebounceSeconds = 10.0;

    // Pressure points with no MQTT source (ro, mrs) or that mirror a gauge already covered
    // separately (fh mirrors the Hydrant gauge) are skipped to avoid dead/duplicate alerts.
    private static readonly HashSet<string> SkipPressurePointKeys = new() { "ro", "mrs", "fh" };

    // Fixed key->description definitions, used only to reconstruct in-memory zone state from
    // the DB's currently-open rows on startup (see InitializeFromDbAsync) - without this, a
    // restart while an alert is still open would forget it was already open and re-insert a
    // duplicate "open" row for the same still-red condition on the next MQTT payload.
    private static readonly (string Key, string Description)[] LevelAlertDefinitions =
    [
        ("level_wt1", "Water Tank 1 level down to 20%"),
        ("level_wt2", "Water Tank 2 level down to 20%"),
        ("level_diesel", "Diesel level down to 20%")
    ];

    private static readonly (string Key, string Label)[] PressureAlertDefinitions =
    [
        ("pressure_hydrant", "Hydrant"),
        ("pressure_sprinkler", "Sprinkler"),
        ("pressure_ev", "EV Building"),
        ("pressure_g120", "G120"),
        ("pressure_machine", "Machine Shop"),
        ("pressure_canteen", "Canteen"),
        ("pressure_engine", "Engine Assembly"),
        ("pressure_paint2", "Paint Shop 2"),
        ("pressure_vehicle", "Vehicle Assembly"),
        ("pressure_paint1", "Paint Shop 1"),
        ("pressure_warehouse", "FG Warehouse")
    ];

    private readonly FireHydrantAlertRepository _repo;
    private readonly ILogger<FireHydrantAlertMonitor> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    // key -> current confirmed zone ("normal" | "low" | "high")
    private readonly Dictionary<string, string> _zones = new();
    // key -> zone currently being debounced (pending confirmation) and when it started
    private readonly Dictionary<string, string> _candidateZone = new();
    private readonly Dictionary<string, DateTime> _candidateSince = new();
    // key -> AlertId of the currently-open row for that key
    private readonly Dictionary<string, long> _openAlertIds = new();
    // key -> snooze deadline; while in the future, a new "open" row is suppressed for that key
    // even if the condition briefly recovers and re-triggers (a "close" row is still inserted
    // on genuine recovery - only re-opening is suppressed until the deadline passes).
    private readonly Dictionary<string, DateTime> _snoozeUntil = new();
    private long _lastAlertId;
    private bool _initialized;

    public FireHydrantAlertMonitor(FireHydrantAlertRepository repo, ILogger<FireHydrantAlertMonitor> logger)
    {
        _repo = repo;
        _logger = logger;
    }

    public async Task EvaluateAsync(FireHydrantStatus status)
    {
        await _gate.WaitAsync();
        try
        {
            if (!_initialized)
            {
                await InitializeFromDbAsync();
                _initialized = true;
            }

            foreach (var tank in status.Tanks)
                await EvaluateLevelAsync($"level_{tank.Id}", "Water level", $"{tank.Label} level down to 20%", tank.Level);

            await EvaluateLevelAsync("level_diesel", "Diesel level", "Diesel level down to 20%", status.Diesel.Level);

            foreach (var gauge in status.Gauges)
                await EvaluatePressureAsync($"pressure_{gauge.Id}", PressureLabel(gauge.Id), gauge.Value);

            foreach (var point in status.PressurePoints)
            {
                if (SkipPressurePointKeys.Contains(point.Key) || point.Value is not double v) continue;
                await EvaluatePressureAsync($"pressure_{point.Key}", PressurePointLabel(point.Key), v);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    // Called by the controller right after a snooze request is persisted, so suppression takes
    // effect immediately rather than waiting for a restart to reload it from the DB.
    public async Task ApplySnoozeAsync(IEnumerable<long> alertIds, DateTime until)
    {
        await _gate.WaitAsync();
        try
        {
            foreach (var alertId in alertIds)
            {
                var match = _openAlertIds.FirstOrDefault(kv => kv.Value == alertId);
                if (match.Key != null) _snoozeUntil[match.Key] = until;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private static string PressureLabel(string gaugeId) => gaugeId switch
    {
        "hydrant" => "Hydrant",
        "sprinkler" => "Sprinkler",
        _ => gaugeId
    };

    private static string PressurePointLabel(string key) => key switch
    {
        "ev" => "EV Building",
        "g120" => "G120",
        "machine" => "Machine Shop",
        "canteen" => "Canteen",
        "engine" => "Engine Assembly",
        "paint2" => "Paint Shop 2",
        "vehicle" => "Vehicle Assembly",
        "paint1" => "Paint Shop 1",
        "warehouse" => "FG Warehouse",
        _ => key
    };

    // Returns the zone to act on this call: rawZone if it has now persisted for at least
    // DebounceSeconds (confirming it), otherwise the unchanged confirmedZone (still pending).
    private string DebouncedZone(string key, string rawZone, string confirmedZone)
    {
        if (rawZone == confirmedZone)
        {
            _candidateZone.Remove(key);
            _candidateSince.Remove(key);
            return confirmedZone;
        }

        if (!_candidateZone.TryGetValue(key, out var candidate) || candidate != rawZone)
        {
            _candidateZone[key] = rawZone;
            _candidateSince[key] = DateTime.Now;
            return confirmedZone;
        }

        if ((DateTime.Now - _candidateSince[key]).TotalSeconds < DebounceSeconds) return confirmedZone;

        _candidateZone.Remove(key);
        _candidateSince.Remove(key);
        return rawZone;
    }

    private async Task EvaluateLevelAsync(string key, string type, string description, double level)
    {
        var rawZone = level <= LevelAlertThreshold ? "low" : "normal";
        var prev = _zones.GetValueOrDefault(key, "normal");
        var zone = DebouncedZone(key, rawZone, prev);
        if (zone == prev) return;
        _zones[key] = zone;

        if (zone == "low")
        {
            if (_snoozeUntil.TryGetValue(key, out var until) && until > DateTime.Now) return;
            var alertId = NextAlertId();
            _openAlertIds[key] = alertId;
            await InsertSafe(alertId, type, description, "open");
        }
        else if (_openAlertIds.Remove(key, out var alertId))
        {
            await InsertSafe(alertId, type, description, "close");
        }
    }

    private async Task EvaluatePressureAsync(string key, string label, double value)
    {
        var rawZone = value < PressureLow ? "low" : value > PressureHigh ? "high" : "normal";
        var prev = _zones.GetValueOrDefault(key, "normal");
        var zone = DebouncedZone(key, rawZone, prev);
        if (zone == prev) return;

        if (prev != "normal" && _openAlertIds.Remove(key, out var closingId))
        {
            await InsertSafe(closingId, "Water pressure", PressureDescription(label, prev), "close");
        }

        _zones[key] = zone;

        if (zone != "normal")
        {
            if (_snoozeUntil.TryGetValue(key, out var until) && until > DateTime.Now) return;
            var alertId = NextAlertId();
            _openAlertIds[key] = alertId;
            await InsertSafe(alertId, "Water pressure", PressureDescription(label, zone), "open");
        }
    }

    private static string PressureDescription(string label, string zone) =>
        zone == "low" ? $"{label} pressure down to {PressureLow}" : $"{label} pressure raises to {PressureHigh}";

    // Reconstructs _zones/_openAlertIds from whatever is already "open" in the DB, so a
    // still-red condition surviving an app restart is recognized as already-open rather than
    // re-triggering a duplicate "open" row on the first payload after startup.
    private async Task InitializeFromDbAsync()
    {
        try
        {
            var openAlerts = await _repo.GetOpenAlertsAsync();
            foreach (var alert in openAlerts)
            {
                if (alert.AlertId > _lastAlertId) _lastAlertId = alert.AlertId;

                if (alert.Type is "Water level" or "Diesel level")
                {
                    var match = LevelAlertDefinitions.FirstOrDefault(d => d.Description == alert.Description);
                    if (match.Key == null) continue;
                    _zones[match.Key] = "low";
                    _openAlertIds[match.Key] = alert.AlertId;
                    if (alert.SnoozeTime.HasValue) _snoozeUntil[match.Key] = alert.SnoozeTime.Value;
                }
                else if (alert.Type == "Water pressure")
                {
                    foreach (var (key, label) in PressureAlertDefinitions)
                    {
                        if (alert.Description == PressureDescription(label, "low")) { _zones[key] = "low"; _openAlertIds[key] = alert.AlertId; }
                        else if (alert.Description == PressureDescription(label, "high")) { _zones[key] = "high"; _openAlertIds[key] = alert.AlertId; }
                        else continue;
                        if (alert.SnoozeTime.HasValue) _snoozeUntil[key] = alert.SnoozeTime.Value;
                        break;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize Fire Hydrant alert monitor state from DB");
        }
    }

    private async Task InsertSafe(long alertId, string type, string description, string status)
    {
        try
        {
            await _repo.InsertAsync(alertId, DateTime.Now, type, description, status);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist Fire Hydrant alert {AlertId} ({Status})", alertId, status);
        }
    }

    // yyyyMMddHHmmssfff, bumped by 1 if two alerts land in the same millisecond
    // (EvaluateAsync already serializes callers via _gate, so this is race-free).
    private long NextAlertId()
    {
        var candidate = long.Parse(DateTime.Now.ToString("yyyyMMddHHmmssfff"));
        if (candidate <= _lastAlertId) candidate = _lastAlertId + 1;
        _lastAlertId = candidate;
        return candidate;
    }
}
