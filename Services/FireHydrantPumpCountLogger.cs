using ControlTower.Models;

namespace ControlTower.Services;

// Logs pump running-count changes to PumpRunningCount for the Count report. Counts arriving
// on the MQTT pump-room topic are cumulative and the topic publishes every few seconds, so
// logging every message would flood the table with repeated values - a row is only inserted
// when a pump's count actually differs from the last logged value (or on first observation,
// to establish a baseline). Called after every pump-room payload update. Zero counts are
// never inserted (per user request - a 0 isn't a meaningful "it ran" event) - this is safe
// because FireHydrantPumpCountRepository.GetSummaryAsync() already treats "no row logged yet
// today" as a 0 baseline, which is exactly what a day with no runs (and thus never leaving 0)
// should look like.
public class FireHydrantPumpCountLogger
{
    private readonly FireHydrantPumpCountRepository _repo;
    private readonly ILogger<FireHydrantPumpCountLogger> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    // pump label -> last logged count
    private readonly Dictionary<string, int> _lastCount = new();
    private bool _initialized;

    public FireHydrantPumpCountLogger(FireHydrantPumpCountRepository repo, ILogger<FireHydrantPumpCountLogger> logger)
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
                await InitializeFromDbAsync(status);
                _initialized = true;
            }

            foreach (var pump in status.Pumps)
            {
                if (_lastCount.TryGetValue(pump.Label, out var last) && last == pump.Count) continue;
                _lastCount[pump.Label] = pump.Count;
                if (pump.Count > 0) await InsertSafe(pump.Label, pump.Count);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    // Seeds _lastCount from each pump's most recent DB row, so a restart while a count is
    // unchanged doesn't log a spurious duplicate - only a genuine change (including one that
    // happened while the app was down) gets logged, on the first live reading after restart.
    private async Task InitializeFromDbAsync(FireHydrantStatus status)
    {
        try
        {
            foreach (var pump in status.Pumps)
            {
                var last = await _repo.GetLastCountAsync(pump.Label);
                if (last.HasValue) _lastCount[pump.Label] = last.Value;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize Fire Hydrant pump count logger state from DB");
        }
    }

    private async Task InsertSafe(string pump, int count)
    {
        try
        {
            await _repo.InsertAsync(pump, count, DateTime.Now);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to log Fire Hydrant pump count for {Pump}", pump);
        }
    }
}
