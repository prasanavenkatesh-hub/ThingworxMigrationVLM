using ControlTower.Models;

namespace ControlTower.Services;

// Logs full meter snapshots to [ControlTowerVLM].[dbo].[EbCMonitoring] on a fixed interval
// (EbRtm:LogIntervalMinutes, default 5) rather than on every data change. Called
// after every "vlmEnergyMonitoring" payload; the first payload to arrive in each new
// clock-aligned slot (e.g. 10:00, 10:05, 10:10 for a 5 min interval) is the one logged, and the
// rest of that slot's payloads are skipped. Aligning to the clock rather than "5 min since the
// last row" keeps rows on predictable timestamps for the trend charts and the shift-boundary
// energy deltas. If the MQTT feed stops, nothing is logged (no fresh reading to record).
public class EbRtmReadingLogger
{
    private readonly EbRtmReadingRepository _repo;
    private readonly ILogger<EbRtmReadingLogger> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly TimeSpan _interval;

    private long? _lastLoggedSlot;
    private bool _initialized;

    public EbRtmReadingLogger(EbRtmReadingRepository repo, IConfiguration config, ILogger<EbRtmReadingLogger> logger)
    {
        _repo = repo;
        _logger = logger;
        var minutes = config.GetValue<double?>("EbRtm:LogIntervalMinutes") ?? 5;
        _interval = TimeSpan.FromMinutes(minutes > 0 ? minutes : 5);
    }

    public async Task EvaluateAsync(EbRtmReadingDto current)
    {
        await _gate.WaitAsync();
        try
        {
            if (!_initialized)
            {
                await InitializeFromDbAsync();
                _initialized = true;
            }

            var slot = SlotOf(current.Timestamp);
            if (_lastLoggedSlot == slot) return;

            _lastLoggedSlot = slot;
            try
            {
                await _repo.InsertAsync(current);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to log EB Real Time Monitoring reading");
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    // Seeds the last-logged slot from the DB's most recent row, so a restart inside a slot that
    // was already logged doesn't insert a second row for it.
    private async Task InitializeFromDbAsync()
    {
        try
        {
            var last = await _repo.GetLastAsync();
            if (last != null) _lastLoggedSlot = SlotOf(last.Timestamp);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize EB Real Time Monitoring logger state from DB");
        }
    }

    // Index of the clock-aligned interval `t` falls in (local time, same as the stored Timestamp).
    private long SlotOf(DateTime t) => t.Ticks / _interval.Ticks;
}
