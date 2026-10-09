using ControlTower.Models;

namespace ControlTower.Services;

// Computes the Energy Consumption sidebar table (All / Shift A / Shift B / Shift C, each with
// Current Day and Previous Day) from RealEnergyIntoLoad readings logged in
// [ControlTowerVLM].[dbo].[EbCMonitoring]. RealEnergyIntoLoad is treated as a monotonically increasing
// lifetime totalizer (standard behavior for a "FWD Real Energy" register - unlike the Fire
// Hydrant pump count tag, nothing in the tag sheet says this one resets), so consumption over
// any window is simply (reading at window end) - (reading at window start).
//
// Reuses the same ShiftConfiguration:Shifts appsettings section the biometric shift reports
// use, rather than a separate EB-specific copy, so the two stay in sync automatically.
public class EbRtmEnergyCalculator
{
    private static readonly (string Key, string Label)[] Shifts = [("A", "A"), ("B", "B"), ("C", "C")];

    private readonly EbRtmReadingRepository _repo;
    private readonly IConfiguration _config;

    public EbRtmEnergyCalculator(EbRtmReadingRepository repo, IConfiguration config)
    {
        _repo = repo;
        _config = config;
    }

    public async Task<List<EbRtmEnergyConsumptionDto>> GetConsumptionTableAsync(DateTime asOf)
    {
        var results = new List<EbRtmEnergyConsumptionDto>();

        // "All" spans the same 24h cycle the shifts tile together (Shift A's start to the next
        // day's Shift A start), not a plain midnight-to-midnight calendar day, so it lines up
        // exactly with summing A+B+C.
        var (allStart, _) = ShiftWindow("A", asOf);
        var allEnd = allStart.AddDays(1);
        var (prevAllStart, _) = ShiftWindow("A", asOf.AddDays(-1));
        var prevAllEnd = prevAllStart.AddDays(1);

        results.Add(new EbRtmEnergyConsumptionDto
        {
            Shift = "All",
            CurrentDay = await DeltaAsync(allStart, allEnd),
            PreviousDay = await DeltaAsync(prevAllStart, prevAllEnd)
        });

        foreach (var (key, label) in Shifts)
        {
            var (start, end) = ShiftWindow(key, asOf);
            var (prevStart, prevEnd) = ShiftWindow(key, asOf.AddDays(-1));

            results.Add(new EbRtmEnergyConsumptionDto
            {
                Shift = label,
                CurrentDay = await DeltaAsync(start, end),
                PreviousDay = await DeltaAsync(prevStart, prevEnd)
            });
        }

        return results;
    }

    // The Energy Consumption tab's historical chart: one point per production day of the given
    // month (same Shift A -> next Shift A window as the "All" row above). Only days whose window
    // has fully ended by `asOf` are included - an in-progress day would show a misleadingly low
    // partial total (the sidebar's Current Day column already covers today).
    public async Task<List<EbRtmDailyEnergyDto>> GetDailyConsumptionAsync(int year, int month, DateTime asOf)
    {
        var results = new List<EbRtmDailyEnergyDto>();
        // Consecutive days share a boundary (day N's end = day N+1's start), so cache each
        // boundary's reading instead of querying it twice.
        var boundaryCache = new Dictionary<DateTime, double?>();

        async Task<double?> ValueAt(DateTime t)
        {
            if (!boundaryCache.TryGetValue(t, out var v))
            {
                v = await _repo.GetRealEnergyAtOrBeforeAsync(t);
                boundaryCache[t] = v;
            }
            return v;
        }

        var daysInMonth = DateTime.DaysInMonth(year, month);
        for (var day = 1; day <= daysInMonth; day++)
        {
            var date = new DateTime(year, month, day);
            var (start, _) = ShiftWindow("A", date);
            var end = start.AddDays(1);
            if (end > asOf) break;

            var startValue = await ValueAt(start);
            var endValue = await ValueAt(end);
            results.Add(new EbRtmDailyEnergyDto
            {
                Date = date,
                Consumption = startValue is null || endValue is null ? null : Math.Round(endValue.Value - startValue.Value, 2)
            });
        }

        return results;
    }

    private async Task<double?> DeltaAsync(DateTime start, DateTime end)
    {
        var startValue = await _repo.GetRealEnergyAtOrBeforeAsync(start);
        var endValue = await _repo.GetRealEnergyAtOrBeforeAsync(end);
        if (startValue is null || endValue is null) return null;
        return Math.Round(endValue.Value - startValue.Value, 2);
    }

    // The absolute [start, end) DateTime window for the given shift on the calendar day
    // `referenceDate` falls in, handling the overnight wrap (Shift C runs into the next day)
    // the same way ReportsService's shift-bucketing does.
    private (DateTime Start, DateTime End) ShiftWindow(string shiftKey, DateTime referenceDate)
    {
        var start = TimeSpan.Parse(_config[$"ShiftConfiguration:Shifts:{shiftKey}:Start"] ?? "00:00:00");
        var end = TimeSpan.Parse(_config[$"ShiftConfiguration:Shifts:{shiftKey}:End"] ?? "23:59:59");
        var date = referenceDate.Date;

        var startDateTime = date + start;
        var endDateTime = start <= end ? date + end : date.AddDays(1) + end;
        return (startDateTime, endDateTime + TimeSpan.FromSeconds(1)); // End is inclusive (":59" second) in config; make it an exclusive upper bound
    }
}
