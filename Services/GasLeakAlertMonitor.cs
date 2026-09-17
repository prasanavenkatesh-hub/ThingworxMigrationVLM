using ControlTower.Models;

namespace ControlTower.Services;

// Watches the live GasLeakStatus for Lot 1 / Lot 2 zone-band transitions (green/normal,
// yellow/warning >20, red/danger >40 - same thresholds as the source ThingWorx Thing's
// blinkShapes service) and persists open/close rows to GasLeakAlerts via
// GasLeakAlertRepository. Called after every MQTT payload update. Structurally mirrors
// FireHydrantAlertMonitor (debounce, restart-safe DB seeding, snooze), adapted for a 3-band
// zone instead of FireHydrant's low/normal/high.
public class GasLeakAlertMonitor
{
    // A reading must sit in a non-green band continuously for this long before it's confirmed
    // and acted on - same rationale/window as FireHydrantAlertMonitor: absorbs a single
    // transient bad-but-quality-flagged MQTT reading without meaningfully delaying a
    // genuinely sustained condition.
    private const double DebounceSeconds = 10.0;

    private static readonly (string Key, string Area, string Label)[] ZoneDefinitions =
    [
        ("lot1", "Lot 1", "Lot 1"),
        ("lot2", "Lot 2", "Lot 2")
    ];

    private readonly GasLeakAlertRepository _repo;
    private readonly ILogger<GasLeakAlertMonitor> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    // key -> current confirmed band ("green" | "yellow" | "red")
    private readonly Dictionary<string, string> _bands = new();
    private readonly Dictionary<string, string> _candidateBand = new();
    private readonly Dictionary<string, DateTime> _candidateSince = new();
    // key -> AlertId of the currently-open row for that key
    private readonly Dictionary<string, long> _openAlertIds = new();
    private readonly Dictionary<string, DateTime> _snoozeUntil = new();
    private long _lastAlertId;
    private bool _initialized;

    public GasLeakAlertMonitor(GasLeakAlertRepository repo, ILogger<GasLeakAlertMonitor> logger)
    {
        _repo = repo;
        _logger = logger;
    }

    public async Task EvaluateAsync(GasLeakStatus status)
    {
        await _gate.WaitAsync();
        try
        {
            if (!_initialized)
            {
                await InitializeFromDbAsync();
                _initialized = true;
            }

            await EvaluateZoneAsync("lot1", "Lot 1", status.Lot1.Value);
            await EvaluateZoneAsync("lot2", "Lot 2", status.Lot2.Value);
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

    private static string RawBand(double value) => value <= 20 ? "green" : value <= 40 ? "yellow" : "red";

    private static string Description(string label, string band) => band switch
    {
        "yellow" => $"{label} LPG leak level in Warning band (20-40%)",
        "red" => $"{label} LPG leak level reached Danger band (>40%)",
        _ => $"{label} LPG leak level back to Normal"
    };

    // Same debounce mechanics as FireHydrantAlertMonitor.DebouncedZone.
    private string DebouncedBand(string key, string rawBand, string confirmedBand)
    {
        if (rawBand == confirmedBand)
        {
            _candidateBand.Remove(key);
            _candidateSince.Remove(key);
            return confirmedBand;
        }

        if (!_candidateBand.TryGetValue(key, out var candidate) || candidate != rawBand)
        {
            _candidateBand[key] = rawBand;
            _candidateSince[key] = DateTime.Now;
            return confirmedBand;
        }

        if ((DateTime.Now - _candidateSince[key]).TotalSeconds < DebounceSeconds) return confirmedBand;

        _candidateBand.Remove(key);
        _candidateSince.Remove(key);
        return rawBand;
    }

    private async Task EvaluateZoneAsync(string key, string label, double value)
    {
        var rawBand = RawBand(value);
        var prev = _bands.GetValueOrDefault(key, "green");
        var band = DebouncedBand(key, rawBand, prev);
        if (band == prev) return;

        // Any change away from the previously-open band closes that row first (covers both
        // recovering to green and moving directly between yellow/red).
        if (prev != "green" && _openAlertIds.Remove(key, out var closingId))
        {
            await InsertSafe(closingId, "Gas Leak", Description(label, prev), "close");
        }

        _bands[key] = band;

        if (band != "green")
        {
            if (_snoozeUntil.TryGetValue(key, out var until) && until > DateTime.Now) return;
            var alertId = NextAlertId();
            _openAlertIds[key] = alertId;
            await InsertSafe(alertId, "Gas Leak", Description(label, band), "open");
        }
    }

    // Reconstructs _bands/_openAlertIds from whatever is already "open" in the DB, so a
    // still-abnormal condition surviving an app restart is recognized as already-open rather
    // than re-triggering a duplicate "open" row on the first payload after startup.
    private async Task InitializeFromDbAsync()
    {
        try
        {
            var openAlerts = await _repo.GetOpenAlertsAsync();
            foreach (var alert in openAlerts)
            {
                if (alert.AlertId > _lastAlertId) _lastAlertId = alert.AlertId;
                if (alert.Type != "Gas Leak") continue;

                foreach (var (key, _, label) in ZoneDefinitions)
                {
                    if (alert.Description == Description(label, "yellow")) { _bands[key] = "yellow"; _openAlertIds[key] = alert.AlertId; }
                    else if (alert.Description == Description(label, "red")) { _bands[key] = "red"; _openAlertIds[key] = alert.AlertId; }
                    else continue;

                    if (alert.SnoozeTime.HasValue) _snoozeUntil[key] = alert.SnoozeTime.Value;
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize Gas Leak alert monitor state from DB");
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
            _logger.LogWarning(ex, "Failed to persist Gas Leak alert {AlertId} ({Status})", alertId, status);
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
