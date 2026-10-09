using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EmsController : ControllerBase
{
    private readonly EmsSolarStateStore _store;
    private readonly EmsSolarDataRepository _repo;
    private readonly EmsOtherPowerSourceRepository _otherSourceRepo;

    public EmsController(EmsSolarStateStore store, EmsSolarDataRepository repo, EmsOtherPowerSourceRepository otherSourceRepo)
    {
        _store = store;
        _repo = repo;
        _otherSourceRepo = otherSourceRepo;
    }

    // Live (kW) from the current MQTT reading; Today/Yesterday (kWh) computed against the
    // daily 00:15 baseline rows in SolarData. If today's 00:15 row hasn't landed yet (e.g.
    // it's 00:10), both shift back a day: yesterday's baseline stands in for today's.
    [HttpGet("solar/status")]
    public async Task<IActionResult> GetSolarStatus()
    {
        var now = DateTime.Now;
        var todayBaseline = await _repo.GetRealEnergyForDateAsync(now.Date);
        DateTime baseDate = todayBaseline.HasValue ? now.Date : now.Date.AddDays(-1);
        double baseline0 = todayBaseline ?? await _repo.GetRealEnergyForDateAsync(baseDate) ?? 0;
        double baseline1 = await _repo.GetRealEnergyForDateAsync(baseDate.AddDays(-1)) ?? 0;

        return Ok(new
        {
            connected = _store.Connected,
            lastUpdated = _store.LastUpdated,
            live = _store.LiveKw,
            today = Math.Round((_store.RealEnergySum - baseline0) / 1000.0, 2),
            yesterday = Math.Round((baseline0 - baseline1) / 1000.0, 2)
        });
    }

    // Today's hourly Live(kW) points (00:15 to 00:15) for the solar chart - resets daily since
    // it's always filtered to "today".
    [HttpGet("solar/graph")]
    public async Task<IActionResult> GetSolarGraph()
    {
        var points = await _repo.GetTodayLiveGraphAsync(DateTime.Now.Date);
        return Ok(points.Select(p => new { timestamp = p.TimeStamp, solar = p.Solar }));
    }

    // "Other Power Source" tab (Green Power Contribution Input fields) - one row per month.
    [HttpPost("othersource")]
    public async Task<IActionResult> PostOtherPowerSource([FromBody] OtherPowerSourceInput input)
    {
        if (!DateTime.TryParseExact(input.Month + "-01", "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var monthDate))
            return BadRequest("Invalid month");
        await _otherSourceRepo.InsertAsync(monthDate, input);
        return Ok();
    }

    // Full history for the "Other Power Source" popup's data grid, newest first.
    [HttpGet("othersource/history")]
    public async Task<IActionResult> GetOtherPowerSourceHistory()
    {
        var rows = await _otherSourceRepo.GetHistoryAsync();
        return Ok(rows.Select(r => new
        {
            timestamp = r.TimeStamp,
            thirdPartyWind = r.ThirdPartyWind,
            thirdPartySolar = r.ThirdPartySolar,
            tneb = r.TNEB,
            dg = r.DG,
            solar = r.Solar,
            gcpSolar = r.GCPSolar,
            iexRenewable = r.IEXRenewable,
            iexNonRenewable = r.IEXNonRenewable
        }));
    }

    // Previous/current month values for GCPSolar/ThirdPartyWind/ThirdPartySolar/IEXRenewable/Solar
    // (the 5 "Other Sources" shown in ems-source-table), converted to lakhs kWh, plus each
    // source's % share of that month's 5-source total.
    [HttpGet("othersource/summary")]
    public async Task<IActionResult> GetOtherPowerSourceSummary()
    {
        var now = DateTime.Now;
        var prevMonth = now.AddMonths(-1);
        return Ok(new
        {
            previous = await BuildOtherSourceMonthSummary(prevMonth.Year, prevMonth.Month),
            current = await BuildOtherSourceMonthSummary(now.Year, now.Month)
        });
    }

    private async Task<object> BuildOtherSourceMonthSummary(int year, int month)
    {
        var row = await _otherSourceRepo.GetLatestForMonthAsync(year, month);
        double gcp = (row?.GCPSolar ?? 0) / 100000.0;
        double tpSolar = (row?.ThirdPartySolar ?? 0) / 100000.0;
        double tpWind = (row?.ThirdPartyWind ?? 0) / 100000.0;
        double iex = (row?.IEXRenewable ?? 0) / 100000.0;
        double solar = (row?.Solar ?? 0) / 100000.0;
        double sum = gcp + tpSolar + tpWind + iex + solar;
        int Pct(double v) => sum > 0 ? (int)Math.Round(v / sum * 100) : 0;

        // CO2 uses the raw kWh values (same columns GetOtherPowerSourceHistory returns),
        // not the /100000 "lakhs" figures above used for display/percentages.
        double rawSum = (row?.GCPSolar ?? 0) + (row?.ThirdPartySolar ?? 0) + (row?.ThirdPartyWind ?? 0) + (row?.IEXRenewable ?? 0) + (row?.Solar ?? 0);

        // Total Units adds TNEB/DG/IEXNonRenewable (also lakhs-scale) to the 5-source total.
        double tneb = (row?.TNEB ?? 0) / 100000.0;
        double dg = (row?.DG ?? 0) / 100000.0;
        double iexNonRenewable = (row?.IEXNonRenewable ?? 0) / 100000.0;
        double totalUnits = sum + tneb + dg + iexNonRenewable;

        return new
        {
            month = new DateTime(year, month, 1).ToString("MMMM - yyyy"),
            gcpSolar = Math.Round(gcp, 2),
            thirdPartySolar = Math.Round(tpSolar, 2),
            thirdPartyWind = Math.Round(tpWind, 2),
            iexRenewable = Math.Round(iex, 2),
            solar = Math.Round(solar, 2),
            pctGcpSolar = Pct(gcp),
            pctThirdPartySolar = Pct(tpSolar),
            pctThirdPartyWind = Pct(tpWind),
            pctIexRenewable = Pct(iex),
            pctSolar = Pct(solar),
            co2 = Math.Round(0.716 * rawSum / 1000),
            totalGreen = Math.Round(sum, 2),
            totalUnits = Math.Round(totalUnits, 2),
            pctGreen = totalUnits > 0 ? (int)Math.Round(sum / totalUnits * 100) : 0
        };
    }
}
