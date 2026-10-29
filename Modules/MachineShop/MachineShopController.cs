using System.Globalization;
using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// Machine Shop screens. PDI Dashboard: date = production day (yyyy-MM-dd), shift = a ShiftConfiguration
// shift name (A / B / C). Read-only.
[ApiController]
[Route("api/machineshop")]
public class MachineShopController : ControllerBase
{
    private readonly MachineShopPdiService _pdi;
    private readonly ILogger<MachineShopController> _logger;

    public MachineShopController(MachineShopPdiService pdi, ILogger<MachineShopController> logger)
    {
        _pdi = pdi;
        _logger = logger;
    }

    // Parts of the PDI screens (MachineShop:Pdi:Parts) - the Rejection Details buttons.
    [HttpGet("pdi/parts")]
    public ActionResult<IReadOnlyList<MachineShopPdiPartInfo>> GetPdiParts() => Ok(_pdi.GetParts());

    // Hourly Screen: hourly counts per part (top grid) + Total / Pass / Fail per part (bottom grid).
    [HttpGet("pdi/hourly")]
    public async Task<ActionResult<MachineShopPdiHourly>> GetPdiHourly([FromQuery] string? date, [FromQuery] string? shift)
    {
        if (!TryParse(date, shift, out var day, out var error)) return BadRequest(error);
        try
        {
            return Ok(await _pdi.GetHourlyAsync(day, shift!));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PDI hourly data failed for {Date} shift {Shift}", date, shift);
            return Problem(ex.Message);
        }
    }

    // Machine Shop Rejection Details pop-up: NOK reasons of one part.
    [HttpGet("pdi/rejections")]
    public async Task<ActionResult<MachineShopPdiRejections>> GetPdiRejections([FromQuery] string? part, [FromQuery] string? date, [FromQuery] string? shift)
    {
        if (!TryParse(date, shift, out var day, out var error)) return BadRequest(error);
        if (string.IsNullOrWhiteSpace(part) || !_pdi.HasPart(part)) return NotFound($"Unknown PDI part '{part}'.");
        try
        {
            return Ok(await _pdi.GetRejectionsAsync(day, shift!, part));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PDI rejections failed for {Part} {Date} shift {Shift}", part, date, shift);
            return Problem(ex.Message);
        }
    }

    // Part tab (e.g. Crankcase): Produced / OK / NOK per cell for each shift of the production day + day totals.
    [HttpGet("pdi/part")]
    public async Task<ActionResult<MachineShopPdiPartDay>> GetPdiPart([FromQuery] string? part, [FromQuery] string? date)
    {
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return BadRequest("date must be yyyy-MM-dd.");
        if (string.IsNullOrWhiteSpace(part) || !_pdi.HasPartTab(part)) return NotFound($"No PDI part tab '{part}'.");
        try
        {
            return Ok(await _pdi.GetPartDayAsync(day, part));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PDI part data failed for {Part} {Date}", part, date);
            return Problem(ex.Message);
        }
    }

    // PDI Summary tab: Produced / OK / NOK per part for each shift of the production day + day totals (pies).
    [HttpGet("pdi/summary")]
    public async Task<ActionResult<MachineShopPdiSummaryDay>> GetPdiSummary([FromQuery] string? date)
    {
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return BadRequest("date must be yyyy-MM-dd.");
        try
        {
            return Ok(await _pdi.GetSummaryDayAsync(day));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PDI summary failed for {Date}", date);
            return Problem(ex.Message);
        }
    }

    // PDI Report pop-up (Cover LH): rows of one cell from `from` to `to` (calendar days, yyyy-MM-dd), filtered by
    // shift (comma list of ShiftConfiguration names) and status (comma list of OK / NOK).
    [HttpGet("pdi/report")]
    public async Task<ActionResult<MachineShopPdiReport>> GetPdiReport([FromQuery] string? part, [FromQuery] string? from,
        [FromQuery] string? to, [FromQuery] string? cell, [FromQuery] string? shifts, [FromQuery] string? status)
    {
        if (string.IsNullOrWhiteSpace(part) || !_pdi.HasReport(part)) return NotFound($"No PDI report for '{part}'.");
        if (!DateTime.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var fromDay) ||
            !DateTime.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var toDay))
            return BadRequest("from and to must be yyyy-MM-dd.");
        if (toDay < fromDay) return BadRequest("to is before from.");
        var maxDays = Math.Max(1, _pdi.ReportSettings.MaxDays);
        if ((toDay - fromDay).TotalDays + 1 > maxDays) return BadRequest($"Pick at most {maxDays} days.");
        if (string.IsNullOrWhiteSpace(cell) || !_pdi.PartCells(part).Contains(cell.Trim())) return BadRequest($"Unknown cell '{cell}'.");
        var shiftList = Split(shifts);
        if (shiftList.Count == 0) return BadRequest("Pick at least one shift.");
        if (shiftList.Any(s => !_pdi.HasShift(s))) return BadRequest($"Unknown shift in '{shifts}'.");
        var statusList = Split(status);
        if (statusList.Count == 0) return BadRequest("Pick at least one status.");
        if (statusList.Any(s => !_pdi.IsStatus(s))) return BadRequest($"Unknown status in '{status}'.");
        try
        {
            return Ok(await _pdi.GetReportAsync(part, fromDay, toDay, cell.Trim(), shiftList, statusList));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PDI report failed for {Part} cell {Cell} {From}..{To}", part, cell, from, to);
            return Problem(ex.Message);
        }
    }

    private static List<string> Split(string? list) =>
        (list ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();

    private bool TryParse(string? date, string? shift, out DateTime day, out string error)
    {
        error = "";
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day))
        {
            error = "date must be yyyy-MM-dd.";
            return false;
        }
        if (string.IsNullOrWhiteSpace(shift) || !_pdi.HasShift(shift))
        {
            error = $"Unknown shift '{shift}'.";
            return false;
        }
        return true;
    }
}
