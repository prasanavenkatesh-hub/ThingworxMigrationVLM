using System.Globalization;
using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// Machine Shop screens. PDI Dashboard: date = production day (yyyy-MM-dd), shift = a ShiftConfiguration
// shift name (A / B / C). Read-only, apart from Part Parameter Config (Create / Edit / Delete on the plant
// CriticalPartParameter tables, settings in ControlTowerVLM).
[ApiController]
[Route("api/machineshop")]
public class MachineShopController : ControllerBase
{
    private readonly MachineShopPdiService _pdi;
    private readonly MachineShopHistoryCardService _historyCard;
    private readonly MachineShopPartParamService _partParam;
    private readonly MachineShopControlChartsService _controlCharts;
    private readonly MachineShopControlChartsSpcService _spc;
    private readonly MachineShopGaugeInspectionService _gauge;
    private readonly ILogger<MachineShopController> _logger;

    public MachineShopController(MachineShopPdiService pdi, MachineShopHistoryCardService historyCard, MachineShopPartParamService partParam,
        MachineShopControlChartsService controlCharts, MachineShopControlChartsSpcService spc, MachineShopGaugeInspectionService gauge, ILogger<MachineShopController> logger)
    {
        _pdi = pdi;
        _historyCard = historyCard;
        _partParam = partParam;
        _controlCharts = controlCharts;
        _spc = spc;
        _gauge = gauge;
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

    // History Card main screen: cards (dropdown), cells and the barcode list cap.
    [HttpGet("historycard/options")]
    public async Task<ActionResult<MachineShopHistoryCardOptions>> GetHistoryCardOptions()
    {
        try
        {
            return Ok(await _historyCard.GetOptionsAsync());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "History card options failed");
            return Problem(ex.Message);
        }
    }

    // History Card barcode list: barcode = search it at the card's PDI station; otherwise cell + from / to
    // (local time, yyyy-MM-ddTHH:mm).
    [HttpGet("historycard/barcodes")]
    public async Task<ActionResult<MachineShopHistoryCardBarcodes>> GetHistoryCardBarcodes([FromQuery] string? card, [FromQuery] string? cell,
        [FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? barcode)
    {
        if (string.IsNullOrWhiteSpace(card) || !await _historyCard.HasCardAsync(card)) return NotFound($"Unknown history card '{card}'.");
        if (barcode is { Length: > 100 }) return BadRequest("barcode is too long.");
        DateTime start = default, end = default;
        if (string.IsNullOrWhiteSpace(barcode))
        {
            if (string.IsNullOrWhiteSpace(cell) || !_historyCard.HasCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
            if (!TryLocal(from, out start) || !TryLocal(to, out end)) return BadRequest("from and to must be yyyy-MM-ddTHH:mm.");
            if (end < start) return BadRequest("to is before from.");
        }
        try
        {
            return Ok(await _historyCard.GetBarcodesAsync(card, cell ?? "", start, end, barcode));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "History card barcodes failed for {Card} cell {Cell} {From}..{To} {Barcode}", card, cell, from, to, barcode);
            return Problem(ex.Message);
        }
    }

    // History card of one barcode (Table 1 + the SPC table of Cover LH / RH).
    [HttpGet("historycard/card")]
    public async Task<ActionResult<MachineShopHistoryCardData>> GetHistoryCard([FromQuery] string? card, [FromQuery] string? barcode, [FromQuery] string? cell)
    {
        if (string.IsNullOrWhiteSpace(card) || !await _historyCard.HasCardAsync(card)) return NotFound($"Unknown history card '{card}'.");
        if (string.IsNullOrWhiteSpace(barcode) || barcode.Length > 100) return BadRequest("barcode is required (at most 100 characters).");
        try
        {
            return Ok(await _historyCard.GetCardAsync(card, barcode.Trim(), cell?.Trim() ?? ""));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "History card failed for {Card} {Barcode}", card, barcode);
            return Problem(ex.Message);
        }
    }

    // Part Parameter Config: machine tabs, the Non Critical / Sample Size settings and the sample sizes.
    [HttpGet("partparam/options")]
    public async Task<ActionResult<MachineShopPartParamOptions>> GetPartParamOptions()
    {
        try
        {
            return Ok(await _partParam.GetOptionsAsync());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Part parameter options failed");
            return Problem(ex.Message);
        }
    }

    // Part Parameter Config grid: the CriticalPartParameter rows of one machine (read-only).
    [HttpGet("partparam/parameters")]
    public async Task<ActionResult<MachineShopPartParamList>> GetPartParameters([FromQuery] string? machine)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_partParam.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        try
        {
            return Ok(await _partParam.GetParametersAsync(machine));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Part parameters failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // Part Parameter Config Create (ThingWorx partParam_create_popup_MU): body { machine, partParaCode, partParaDescription,
    // criticalParameter, updatedDate (yyyy-MM-dd) }. 409 = the code exists.
    [HttpPost("partparam/parameter")]
    public Task<IActionResult> CreatePartParameter([FromBody] MachineShopPartParamInput? input) =>
        PartParamWrite(input, true, (i, date) => _partParam.CreateAsync(i, date));

    // Part Parameter Config Edit (ThingWorx RE_partParam_Edit_popup_MU): same body + operator, inspector, spc; the code is the key.
    [HttpPut("partparam/parameter")]
    public Task<IActionResult> UpdatePartParameter([FromBody] MachineShopPartParamInput? input) =>
        PartParamWrite(input, false, (i, date) => _partParam.UpdateAsync(i, date));

    // Part Parameter Config Delete: every row of the code in the machine's table.
    [HttpDelete("partparam/parameter")]
    public async Task<IActionResult> DeletePartParameter([FromQuery] string? machine, [FromQuery] string? code)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_partParam.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        if (string.IsNullOrEmpty(code)) return BadRequest("code is required.");
        try
        {
            return PartParamResult(await _partParam.DeleteAsync(machine, code));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Deleting part parameter {Code} of {Machine} failed", code, machine);
            return Problem(ex.Message);
        }
    }

    // Checks the Create / Edit body as the ThingWorx service did (code and description required) + the column sizes.
    // Create trims the new code; Edit keeps the code as listed (it is the key of the row).
    private async Task<IActionResult> PartParamWrite(MachineShopPartParamInput? input, bool create,
        Func<MachineShopPartParamInput, DateTime, Task<MachineShopPartParamWriteResult>> write)
    {
        if (input == null) return BadRequest("Body is required.");
        if (string.IsNullOrWhiteSpace(input.Machine) || !_partParam.HasMachine(input.Machine)) return NotFound($"Unknown machine '{input.Machine}'.");
        if (create) input.PartParaCode = (input.PartParaCode ?? "").Trim();
        input.PartParaDescription = (input.PartParaDescription ?? "").Trim();
        if (string.IsNullOrWhiteSpace(input.PartParaCode)) return BadRequest("Please give input for PartPara Code.");
        if (input.PartParaCode.Length > 100) return BadRequest("PartPara Code can have at most 100 characters.");
        if (input.PartParaDescription.Length == 0) return BadRequest("Please give input for PartPara Description.");
        if (input.PartParaDescription.Length > 500) return BadRequest("PartPara Description can have at most 500 characters.");
        var date = DateTime.Today;
        if (!string.IsNullOrWhiteSpace(input.UpdatedDate) &&
            !DateTime.TryParseExact(input.UpdatedDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
            return BadRequest("updatedDate must be yyyy-MM-dd.");
        try
        {
            return PartParamResult(await write(input, date));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Saving part parameter {Code} of {Machine} failed", input.PartParaCode, input.Machine);
            return Problem(ex.Message);
        }
    }

    private IActionResult PartParamResult(MachineShopPartParamWriteResult result) => result.Status switch
    {
        MachineShopPartParamWriteStatus.Ok => Ok(new { message = result.Message }),
        MachineShopPartParamWriteStatus.Duplicate => Conflict(result.Message),
        MachineShopPartParamWriteStatus.NotFound => NotFound(result.Message),
        MachineShopPartParamWriteStatus.NoSource => BadRequest(result.Message),
        _ => StatusCode(StatusCodes.Status403Forbidden, result.Message) // ViewOnly, NoPermission
    };

    // Part Parameter Config: save Non Critical and / or Sample Size (ControlTowerVLM). 403 in a view-only copy.
    [HttpPut("partparam/settings")]
    public async Task<ActionResult<MachineShopPartParamPageSettings>> SavePartParamSettings([FromBody] MachineShopPartParamSettingsUpdate? update)
    {
        if (update == null || (update.NonCritical == null && update.SampleSize == null)) return BadRequest("Nothing to save.");
        try
        {
            if (update.SampleSize is int size && !await _partParam.IsSampleSizeAsync(size)) return BadRequest($"Unknown sample size {size}.");
            var saved = await _partParam.SaveSettingsAsync(update);
            if (saved == null) return StatusCode(StatusCodes.Status403Forbidden, "This copy of the app is view-only (App:WritesEnabled = false)."); // TEMPORARY: AppWriteMode
            return Ok(saved);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Saving part parameter settings failed");
            return Problem(ex.Message);
        }
    }

    // Report Configuration grid (ThingWorx RE_Gauging_ReportConfi_MU): the machine's Gauging Report layout rows.
    [HttpGet("partparam/report-config")]
    public async Task<ActionResult<List<MachineShopReportTemplateRow>>> GetReportConfig([FromQuery] string? machine)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_partParam.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        try
        {
            return Ok(await _partParam.GetReportTemplateAsync(machine));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Report configuration failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // Report Configuration Save: body { machine, rows: [{ id, show }] } -> { message, changed }. 403 in a view-only copy.
    [HttpPut("partparam/report-config")]
    public async Task<IActionResult> SaveReportConfig([FromBody] MachineShopReportTemplateUpdate? update)
    {
        if (update == null || update.Rows.Count == 0) return BadRequest("Nothing to save.");
        if (string.IsNullOrWhiteSpace(update.Machine) || !_partParam.HasMachine(update.Machine)) return NotFound($"Unknown machine '{update.Machine}'.");
        try
        {
            var changed = await _partParam.SaveReportTemplateAsync(update);
            if (changed == null) return StatusCode(StatusCodes.Status403Forbidden, "This copy of the app is view-only (App:WritesEnabled = false)."); // TEMPORARY: AppWriteMode
            return Ok(new { message = $"Report configuration saved ({changed} row(s) changed).", changed });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Saving report configuration failed for {Machine}", update.Machine);
            return Problem(ex.Message);
        }
    }

    // Online Control Charts: machine tabs (MachineShop:ControlCharts:Machines) + CUSTOM default offset.
    [HttpGet("controlcharts/options")]
    public ActionResult<MachineShopOccOptions> GetControlChartsOptions() => Ok(_controlCharts.GetOptions());

    // Online Control Charts CELL view (ThingWorx getMachinePercentageData): Operator / Inspector cards of one machine.
    // range = shift (shift running now) | today (production day so far) | custom (date = yyyy-MM-dd, whole production day).
    [HttpGet("controlcharts/cell")]
    public async Task<ActionResult<MachineShopOccCell>> GetControlChartsCell([FromQuery] string? machine, [FromQuery] string? range, [FromQuery] string? date)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        range = (range ?? MachineShopControlChartsService.RangeShift).Trim().ToLowerInvariant();
        if (range is not (MachineShopControlChartsService.RangeShift or MachineShopControlChartsService.RangeToday or MachineShopControlChartsService.RangeCustom))
            return BadRequest("range must be shift, today or custom.");
        DateTime? day = null;
        if (range == MachineShopControlChartsService.RangeCustom)
        {
            if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return BadRequest("date must be yyyy-MM-dd.");
            day = d;
        }
        try
        {
            return Ok(await _controlCharts.GetCellAsync(machine, range, day));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts CELL failed for {Machine} {Range}", machine, range);
            return Problem(ex.Message);
        }
    }

    private bool TryRange(string? range, string? date, out string normalized, out DateTime? day, out string error)
    {
        normalized = (range ?? MachineShopControlChartsService.RangeShift).Trim().ToLowerInvariant();
        day = null;
        error = "";
        if (normalized is not (MachineShopControlChartsService.RangeShift or MachineShopControlChartsService.RangeToday or MachineShopControlChartsService.RangeCustom))
        {
            error = "range must be shift, today or custom.";
            return false;
        }
        if (normalized != MachineShopControlChartsService.RangeCustom) return true;
        if (!TryDay(date, out var d)) { error = "date must be yyyy-MM-dd."; return false; }
        day = d;
        return true;
    }

    private static bool TryDay(string? value, out DateTime day) =>
        DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);

    // Online Control Charts OPERATION view (ThingWorx getCELLPercentageData): NOK % per cell, Operator / Inspector,
    // Critical / Non-Critical, with the process-code shares. range / date as the CELL view.
    [HttpGet("controlcharts/operation")]
    public async Task<ActionResult<MachineShopOccOperation>> GetControlChartsOperation([FromQuery] string? machine, [FromQuery] string? range, [FromQuery] string? date)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        if (!TryRange(range, date, out var r, out var day, out var error)) return BadRequest(error);
        try
        {
            return Ok(await _controlCharts.GetOperationAsync(machine, r, day));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts OPERATION failed for {Machine} {Range}", machine, r);
            return Problem(ex.Message);
        }
    }

    // SPC LIVE / SPC MONTHLY dropdowns of one machine: cells, roles, SPC parameters (CriticalPartParameter SPC = 1).
    [HttpGet("controlcharts/spc/options")]
    public async Task<ActionResult<MachineShopOccSpcOptions>> GetControlChartsSpcOptions([FromQuery] string? machine)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        try
        {
            return Ok(await _spc.GetOptionsAsync(machine));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts SPC options failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // Process codes of a role read between the production days from .. to (yyyy-MM-dd; SPC LIVE: from = to).
    // code empty = every SPC parameter (Report pop-up); cell empty = all cells.
    [HttpGet("controlcharts/spc/processcodes")]
    public async Task<ActionResult<List<string>>> GetControlChartsSpcProcessCodes([FromQuery] string? machine, [FromQuery] string? role,
        [FromQuery] string? code, [FromQuery] string? cell, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        if (!_spc.IsRole(role)) return BadRequest("role must be OPERATOR or INSPECTOR.");
        if (!string.IsNullOrWhiteSpace(cell) && !_spc.IsCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
        if (!TryDay(from, out var fromDay) || !TryDay(to, out var toDay)) return BadRequest("from and to must be yyyy-MM-dd.");
        if (_spc.CheckRange(fromDay, toDay) is string rangeError) return BadRequest(rangeError);
        try
        {
            return Ok(await _spc.GetProcessCodesAsync(machine, role!, code, cell, fromDay, toDay));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts SPC process codes failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // SPC LIVE (ThingWorx QualityFunctionChartOriginal): every reading of one parameter + process code on one
    // production day (date = yyyy-MM-dd), with the day's control limits. cell empty = all cells.
    [HttpGet("controlcharts/spc/live")]
    public async Task<ActionResult<MachineShopOccSpcLive>> GetControlChartsSpcLive([FromQuery] string? machine, [FromQuery] string? code,
        [FromQuery] string? processCode, [FromQuery] string? cell, [FromQuery] string? date)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(processCode)) return BadRequest("code and processCode are required.");
        if (!string.IsNullOrWhiteSpace(cell) && !_spc.IsCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
        if (!TryDay(date, out var day)) return BadRequest("date must be yyyy-MM-dd.");
        try
        {
            return Ok(await _spc.GetLiveAsync(machine, code.Trim(), processCode.Trim(), cell, day));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts SPC LIVE failed for {Machine} {Code}", machine, code);
            return Problem(ex.Message);
        }
    }

    // SPC MONTHLY (ThingWorx QualityFunctionMonthly_MU): one sub-group of 7 readings per finished shift between the
    // production days from .. to (yyyy-MM-dd, at most MaxRangeDays apart), X-bar / Range chart data and limits.
    [HttpGet("controlcharts/spc/monthly")]
    public async Task<ActionResult<MachineShopOccSpcMonthly>> GetControlChartsSpcMonthly([FromQuery] string? machine, [FromQuery] string? cell,
        [FromQuery] string? role, [FromQuery] string? code, [FromQuery] string? processCode, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        if (!_spc.IsCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
        if (!_spc.IsRole(role)) return BadRequest("role must be OPERATOR or INSPECTOR.");
        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(processCode)) return BadRequest("code and processCode are required.");
        if (!TryDay(from, out var fromDay) || !TryDay(to, out var toDay)) return BadRequest("from and to must be yyyy-MM-dd.");
        if (_spc.CheckRange(fromDay, toDay) is string rangeError) return BadRequest(rangeError);
        try
        {
            return Ok(await _spc.GetMonthlyAsync(machine, cell!.ToUpperInvariant(), role!, code.Trim(), processCode.Trim(), fromDay, toDay));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts SPC MONTHLY failed for {Machine} {Code}", machine, code);
            return Problem(ex.Message);
        }
    }

    // SPC MONTHLY Report pop-up (ThingWorx generateSPCReport): every SPC parameter x the process codes (comma list).
    [HttpGet("controlcharts/spc/report")]
    public async Task<ActionResult<MachineShopOccSpcReport>> GetControlChartsSpcReport([FromQuery] string? machine, [FromQuery] string? cell,
        [FromQuery] string? role, [FromQuery] string? processCodes, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (string.IsNullOrWhiteSpace(machine) || !_controlCharts.HasMachine(machine)) return NotFound($"Unknown machine '{machine}'.");
        if (!_spc.IsCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
        if (!_spc.IsRole(role)) return BadRequest("role must be OPERATOR or INSPECTOR.");
        var opns = Split(processCodes);
        if (opns.Count == 0) return BadRequest("Select at least one process code.");
        if (!TryDay(from, out var fromDay) || !TryDay(to, out var toDay)) return BadRequest("from and to must be yyyy-MM-dd.");
        if (_spc.CheckRange(fromDay, toDay) is string rangeError) return BadRequest(rangeError);
        try
        {
            return Ok(await _spc.GetReportAsync(machine, cell!.ToUpperInvariant(), role!, opns, fromDay, toDay));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Control charts SPC report failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // ---- Gauge Inspection Data (ThingWorx QF_OnlineInspection_MU) ----

    [HttpGet("gaugeinspection/options")]
    public ActionResult<MachineShopGidOptions> GetGaugeInspectionOptions() => Ok(_gauge.GetOptions());

    [HttpGet("gaugeinspection/processcodes")]
    public async Task<ActionResult<List<string>>> GetGaugeInspectionProcessCodes([FromQuery] string? machine)
    {
        if (_gauge.FindMachine(machine) == null) return NotFound($"Unknown machine '{machine}'.");
        try
        {
            return Ok(await _gauge.GetProcessCodesAsync(machine!));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Gauge inspection process codes failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    // range = today | custom (from / to = production days yyyy-MM-dd); shifts / processCodes = comma lists.
    [HttpGet("gaugeinspection/data")]
    public async Task<ActionResult<MachineShopGidData>> GetGaugeInspectionData([FromQuery] string? machine, [FromQuery] string? cell,
        [FromQuery] string? shifts, [FromQuery] string? processCodes, [FromQuery] string? range, [FromQuery] string? from, [FromQuery] string? to)
    {
        if (_gauge.FindMachine(machine) == null) return NotFound($"Unknown machine '{machine}'.");
        if (!_gauge.IsCell(cell)) return BadRequest($"Unknown cell '{cell}'.");
        var shiftList = Split(shifts).Select(s => s.StartsWith("Shift ", StringComparison.OrdinalIgnoreCase) ? s[6..].Trim() : s).ToList();
        if (shiftList.Count == 0 || shiftList.Any(s => !_gauge.IsShift(s))) return BadRequest("Select at least one valid shift.");
        var codes = Split(processCodes);
        if (codes.Count == 0) return BadRequest("Select at least one process code.");
        DateTime? fromDay = null, toDay = null;
        if (range == MachineShopGaugeInspectionService.RangeCustom)
        {
            if (!TryDay(from, out var f) || !TryDay(to, out var t)) return BadRequest("from and to must be yyyy-MM-dd.");
            if (_gauge.CheckRange(f, t, DateTime.Now) is string rangeError) return BadRequest(rangeError);
            fromDay = f;
            toDay = t;
        }
        else if (range != MachineShopGaugeInspectionService.RangeToday) return BadRequest("range must be today or custom.");
        try
        {
            return Ok(await _gauge.GetDataAsync(machine!, cell!.ToUpperInvariant(), shiftList, codes, range!, fromDay, toDay));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Gauge inspection data failed for {Machine}", machine);
            return Problem(ex.Message);
        }
    }

    private static bool TryLocal(string? value, out DateTime result) =>
        DateTime.TryParseExact(value, new[] { "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out result);

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
