using ControlTower.Models;

namespace ControlTower.Services;

// Logs each pump's individual run sessions to [Duration] for the Duration report: a row is
// inserted (EndTime/Duration left NULL) the moment a pump starts running, and updated in
// place with EndTime/Duration once it stops. Called after every pump-room MQTT payload.
public class FireHydrantPumpDurationLogger
{
    private readonly FireHydrantPumpDurationRepository _repo;
    private readonly ILogger<FireHydrantPumpDurationLogger> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    // pump label -> last known running state
    private readonly Dictionary<string, bool> _lastRunning = new();
    // pump label -> (open session id, its start time) while a run is in progress
    private readonly Dictionary<string, (long Id, DateTime StartTime)> _openSessions = new();
    private bool _initialized;

    public FireHydrantPumpDurationLogger(FireHydrantPumpDurationRepository repo, ILogger<FireHydrantPumpDurationLogger> logger)
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
                var wasRunning = _lastRunning.GetValueOrDefault(pump.Label, false);
                if (pump.Running == wasRunning) continue;
                _lastRunning[pump.Label] = pump.Running;

                if (pump.Running)
                {
                    await StartSessionAsync(pump.Label, DateTime.Now);
                }
                else
                {
                    await EndSessionAsync(pump.Label, DateTime.Now);
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    // Seeds state from the DB so a restart doesn't lose track of a run already in progress,
    // or leave an old session open forever if the pump already stopped while the app was down.
    private async Task InitializeFromDbAsync(FireHydrantStatus status)
    {
        try
        {
            foreach (var pump in status.Pumps)
            {
                _lastRunning[pump.Label] = pump.Running;
                var open = await _repo.GetOpenSessionAsync(pump.Label);
                if (open == null) continue;

                if (pump.Running)
                {
                    // Still running - resume tracking the existing session rather than
                    // starting a duplicate one.
                    _openSessions[pump.Label] = (open.Id, open.StartTime);
                }
                else
                {
                    // Stopped while the app was down - close it out now as a best-effort
                    // EndTime, since the true stop time was never observed.
                    await EndSessionAsync(pump.Label, DateTime.Now, open);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize Fire Hydrant pump duration logger state from DB");
        }
    }

    private async Task StartSessionAsync(string pump, DateTime startTime)
    {
        try
        {
            var id = await _repo.InsertStartAsync(pump, startTime);
            _openSessions[pump] = (id, startTime);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start Fire Hydrant duration session for {Pump}", pump);
        }
    }

    private async Task EndSessionAsync(string pump, DateTime endTime, FireHydrantPumpDurationRepository.OpenSession? knownOpen = null)
    {
        (long Id, DateTime StartTime)? session = _openSessions.TryGetValue(pump, out var tracked)
            ? tracked
            : knownOpen != null ? (knownOpen.Id, knownOpen.StartTime) : null;

        if (session == null) return; // no open session to close (e.g. app started mid-run, no prior DB row either)

        _openSessions.Remove(pump);
        try
        {
            await _repo.UpdateEndAsync(session.Value.Id, endTime, endTime - session.Value.StartTime);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to end Fire Hydrant duration session for {Pump}", pump);
        }
    }
}
