using System.Globalization;
using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// Machine Shop > Gauge Inspection Report (ThingWorx RE_Gauging_Report_MU). Read-only.
[ApiController]
[Route("api/machineshop/gaugereport")]
public class MachineShopGaugeReportController : ControllerBase
{
    private readonly MachineShopGaugeReportService _report;
    private readonly ILogger<MachineShopGaugeReportController> _logger;

    public MachineShopGaugeReportController(MachineShopGaugeReportService report, ILogger<MachineShopGaugeReportController> logger)
    {
        _report = report;
        _logger = logger;
    }

    [HttpGet("options")]
    public ActionResult<MachineShopGirOptions> GetOptions() => Ok(_report.GetOptions());

    // role = OPERATOR | INSPECTOR; critical / nonCritical = which rows of the layout.
    [HttpGet("processcodes")]
    public async Task<ActionResult<List<string>>> GetProcessCodes([FromQuery] string? machine, [FromQuery] string? role,
        [FromQuery] bool critical = true, [FromQuery] bool nonCritical = true)
    {
        if (_report.FindMachine(machine) == null) return NotFound($"Unknown machine '{machine}'.");
        if (Role(role) is not string r) return BadRequest("role must be OPERATOR or INSPECTOR.");
        try
        {
            return Ok(await _report.GetProcessCodesAsync(machine!, r, critical, nonCritical));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Gauge report process codes failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // range = shift | today | custom (date = production day yyyy-MM-dd); processCodes = comma list.
    [HttpGet("data")]
    public async Task<ActionResult<MachineShopGirData>> GetData([FromQuery] string? machine, [FromQuery] string? cell, [FromQuery] string? role,
        [FromQuery] string? processCodes, [FromQuery] string? range, [FromQuery] string? date,
        [FromQuery] bool critical = true, [FromQuery] bool nonCritical = true,
        [FromQuery] bool conforming = true, [FromQuery] bool nonConforming = true)
    {
        if (_report.FindMachine(machine) == null) return NotFound($"Unknown machine '{machine}'.");
        if (!_report.IsCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
        if (Role(role) is not string r) return BadRequest("role must be OPERATOR or INSPECTOR.");
        var codes = (processCodes ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();
        if (codes.Count == 0) return BadRequest("Select at least one process code.");
        if (!critical && !nonCritical) return BadRequest("Select Critical and / or Non Critical.");
        if (!conforming && !nonConforming) return BadRequest("Select Conforming and / or Non Conforming.");
        DateTime? day = null;
        if (range == MachineShopGaugeReportService.RangeCustom)
        {
            if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                return BadRequest("date must be yyyy-MM-dd.");
            if (d.Date > _report.ProductionDay(DateTime.Now)) return BadRequest("The date must not be in the future.");
            day = d.Date;
        }
        else if (range != MachineShopGaugeReportService.RangeShift && range != MachineShopGaugeReportService.RangeToday)
            return BadRequest("range must be shift, today or custom.");
        try
        {
            return Ok(await _report.GetDataAsync(machine!, cell!.ToUpperInvariant(), r, critical, nonCritical, conforming, nonConforming,
                codes, range!, day));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Gauge report data failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    private static string? Role(string? role) => role?.Trim().ToUpperInvariant() switch
    {
        MachineShopGaugeReportService.RoleOperator => MachineShopGaugeReportService.RoleOperator,
        MachineShopGaugeReportService.RoleInspector => MachineShopGaugeReportService.RoleInspector,
        _ => null
    };
}
