using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EbRtmController : ControllerBase
{
    private readonly EbRtmStateStore _store;
    private readonly EbRtmReadingRepository _readingRepo;
    private readonly EbRtmEnergyCalculator _energyCalculator;
    private readonly EbRtmPowerFailureRepository _powerFailureRepo;

    public EbRtmController(EbRtmStateStore store, EbRtmReadingRepository readingRepo, EbRtmEnergyCalculator energyCalculator, EbRtmPowerFailureRepository powerFailureRepo)
    {
        _store = store;
        _readingRepo = readingRepo;
        _energyCalculator = energyCalculator;
        _powerFailureRepo = powerFailureRepo;
    }

    // Live values only (in-memory, no DB hit) - safe to poll every few seconds.
    [HttpGet("status")]
    public ActionResult<EbRtmStatus> GetStatus()
    {
        return Ok(_store.GetStatus());
    }

    // Trend chart data (Voltage/Frequency/PF/Current) for the given range - hits the DB, so the
    // frontend polls this far less often than /status.
    [HttpGet("history")]
    public async Task<ActionResult<List<EbRtmReadingDto>>> GetHistory([FromQuery] DateTime start, [FromQuery] DateTime end)
    {
        return Ok(await _readingRepo.GetHistoryAsync(ApiDateTime.ToLocal(start), ApiDateTime.ToLocal(end)));
    }

    // The Energy Consumption sidebar card: All/A/B/C x Current Day/Previous Day.
    [HttpGet("energy")]
    public async Task<ActionResult<List<EbRtmEnergyConsumptionDto>>> GetEnergy()
    {
        return Ok(await _energyCalculator.GetConsumptionTableAsync(DateTime.Now));
    }

    // Energy Consumption tab: one point per completed production day of the given month.
    [HttpGet("energy/daily")]
    public async Task<ActionResult<List<EbRtmDailyEnergyDto>>> GetDailyEnergy([FromQuery] int year, [FromQuery] int month)
    {
        if (year < 2000 || month is < 1 or > 12) return BadRequest("Invalid year/month.");
        return Ok(await _energyCalculator.GetDailyConsumptionAsync(year, month, DateTime.Now));
    }

    // Power Failure Count / Duration tabs: `days` calendar days ending on (and including) `end`.
    [HttpGet("powerfailure/daily")]
    public async Task<ActionResult<List<EbRtmDailyPowerFailureDto>>> GetDailyPowerFailures([FromQuery] DateTime end, [FromQuery] int days = 7)
    {
        if (days is < 1 or > 62) return BadRequest("days must be between 1 and 62.");

        var lastDay = ApiDateTime.ToLocal(end).Date;
        var firstDay = lastDay.AddDays(-(days - 1));
        var rangeEnd = lastDay.AddDays(1);
        var now = DateTime.Now;
        var sessions = await _powerFailureRepo.GetSessionsOverlappingAsync(firstDay, rangeEnd);

        var results = new List<EbRtmDailyPowerFailureDto>();
        for (var day = firstDay; day < rangeEnd; day = day.AddDays(1))
        {
            var dayEnd = day.AddDays(1);
            var minutes = 0.0;
            var count = 0;
            foreach (var s in sessions)
            {
                if (s.StartTime >= day && s.StartTime < dayEnd) count++;

                // Clip each session to this day; a still-open session runs up to now.
                var from = s.StartTime > day ? s.StartTime : day;
                var sessionEnd = s.EndTime ?? now;
                var to = sessionEnd < dayEnd ? sessionEnd : dayEnd;
                if (to > from) minutes += (to - from).TotalMinutes;
            }
            results.Add(new EbRtmDailyPowerFailureDto { Date = day, Count = count, DurationMinutes = Math.Round(minutes, 2) });
        }

        return Ok(results);
    }
}
