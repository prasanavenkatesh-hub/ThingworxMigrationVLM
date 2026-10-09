using ControlTower.Services;

namespace ControlTower.Services;

// Watches AvgVoltage for the power-failure condition (< 0, per the tag sheet's rule) and
// persists open/close session rows to [ControlTowerVLM].[dbo].[EbCPowerFailureEvents], same open-then-close
// shape as FireHydrantPumpDurationLogger. Also tracks today's count and the current session's
// running duration for display, refreshed on every call rather than only on state transitions
// so the on-screen "0h : Xm : Ys" duration keeps ticking while a failure is in progress.
public class EbRtmPowerFailureMonitor
{
    private readonly EbRtmPowerFailureRepository _repo;
    private readonly EbRtmStateStore _store;
    private readonly ILogger<EbRtmPowerFailureMonitor> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private bool _lastActive;
    private (long Id, DateTime StartTime)? _openSession;
    private bool _initialized;
    private DateTime _countDate = DateTime.MinValue;
    private int _countToday;

    public EbRtmPowerFailureMonitor(EbRtmPowerFailureRepository repo, EbRtmStateStore store, ILogger<EbRtmPowerFailureMonitor> logger)
    {
        _repo = repo;
        _store = store;
        _logger = logger;
    }

    public async Task EvaluateAsync(double avgVoltage)
    {
        await _gate.WaitAsync();
        try
        {
            if (!_initialized)
            {
                await InitializeFromDbAsync();
                _initialized = true;
            }

            var active = avgVoltage < 0;
            var now = DateTime.Now;

            if (_countDate != now.Date)
            {
                _countDate = now.Date;
                _countToday = await CountTodaySafe(now);
            }

            if (active && !_lastActive)
            {
                await StartAsync(now);
                _countToday++;
            }
            else if (!active && _lastActive)
            {
                await EndAsync(now);
            }
            _lastActive = active;

            var currentDuration = active && _openSession.HasValue ? now - _openSession.Value.StartTime : TimeSpan.Zero;
            _store.SetPowerFailureState(active, currentDuration, _countToday);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task InitializeFromDbAsync()
    {
        try
        {
            var open = await _repo.GetOpenSessionAsync();
            if (open != null)
            {
                _openSession = (open.Id, open.StartTime);
                _lastActive = true;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize EB Real Time Monitoring power failure monitor state from DB");
        }
    }

    private async Task StartAsync(DateTime startTime)
    {
        try
        {
            var id = await _repo.InsertStartAsync(startTime);
            _openSession = (id, startTime);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start EB Real Time Monitoring power failure session");
        }
    }

    private async Task EndAsync(DateTime endTime)
    {
        if (_openSession is not { } session) return;
        _openSession = null;
        try
        {
            await _repo.UpdateEndAsync(session.Id, endTime, endTime - session.StartTime);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to end EB Real Time Monitoring power failure session");
        }
    }

    private async Task<int> CountTodaySafe(DateTime now)
    {
        try
        {
            return await _repo.GetCountForDateAsync(now.Date);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read EB Real Time Monitoring power failure count for today");
            return 0;
        }
    }
}
