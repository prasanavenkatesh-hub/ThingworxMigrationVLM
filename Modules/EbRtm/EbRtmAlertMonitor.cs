using System.Globalization;
using ControlTower.Models;

namespace ControlTower.Services;

// EB-RTM alerts: port of the ThingWorx subscriptions on RE_EnergyMeterRealTimeMonitoring_TS that
// call addAlert (which wrote to the RE_EMRTMAlerts_ST stream). Rows go to [EbCAlerts]
// (EbRtmAlertRepository) and are shown by the EB-RTM Reports "Alerts" tab. Titles, descriptions
// and Type values are copied from the ThingWorx scripts; thresholds come from EbRtm:Alerts.
//
//   changeInMaxDemand   - Max Demand rises above MaxDemandYellowKva (7690)  -> "Yellow Alert: Maximum Demand Reached", Type 6
//                         Max Demand rises above MaxDemandRedKva (7700)     -> "Red Alert: Maximum Demand Reached", Type 3
//   changeInPowerFactor - PF (rounded to 4 dp) drops below 0.97             -> "YELLOW ALERT: DURING EB POWER - POWER FACTOR (PF) LOW < 0.97", Type 2
//                         PF drops below 0.96                               -> "RED ALERT: ... LOW < 0.96", Type 6
//   changeInPowerStatus - power failure starts / ends                       -> "EB Power Failure" / "EB Power Returns", Type 3
//   changeInTagQuality  - AvgVoltage tag quality bad for 15 s / good again  -> "Kepware Tag Quality Lost" (Type 6) / "... Retained" (Type 2)
//
// Like ThingWorx, alerts fire only on the transition (old value on one side of a threshold, new
// value on the other); the "back to normal" Max Demand / PF alerts were commented out in
// ThingWorx and are not raised here either. Differences from ThingWorx:
//   * PF is only evaluated while EB power is on (AvgVoltage > 0) - the alert titles say
//     "DURING EB POWER"; ThingWorx would also raise a RED PF alert when PF fell to 0 on a failure.
//   * Power failure uses the dashboard's existing rule (EbRtmPowerFailureMonitor: AvgVoltage < 0),
//     so the alerts match the Power Failure report.
//   * After an app restart Max Demand / PF start from the first reading (no alert for it); tag
//     quality state is seeded from the newest TagQuality alert so a restart doesn't repeat one.
//   * The alert e-mails (sendAlertEmail, MailNotificationsEnabled) are not ported.
public class EbRtmAlertMonitor
{
    public const string CategoryMaxDemand = "MaxDemand";
    public const string CategoryPowerFactor = "PowerFactor";
    public const string CategoryPowerFailure = "PowerFailure";
    public const string CategoryTagQuality = "TagQuality";

    private const string TitleTagQualityLost = "Kepware Tag Quality Lost";
    private const string TitleTagQualityRetained = "Kepware Tag Quality Retained";

    private readonly EbRtmAlertRepository _repo;
    private readonly ILogger<EbRtmAlertMonitor> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private readonly bool _enabled;
    private readonly MeterInfo? _meter;
    private readonly double _maxDemandYellowKva;
    private readonly double _maxDemandRedKva;
    private readonly double _pfYellowBelow;
    private readonly double _pfRedBelow;
    private readonly TimeSpan _tagQualityConfirm;

    private bool _seeded;
    private double? _prevMaxDemand;
    private double? _prevPowerFactor;
    private bool _tagQualityGood = true;
    private DateTime? _tagQualityBadSince;

    // The meter the live feed belongs to (EbRtm:Alerts:MeterId -> its EbRtm:Meters entry).
    private sealed class MeterInfo
    {
        public string Id { get; set; } = "";
        public int SourceId { get; set; }
        public int MeterId { get; set; }
        public string Device { get; set; } = "NA";
        public string MeterModel { get; set; } = "NA";
    }

    public EbRtmAlertMonitor(EbRtmAlertRepository repo, IConfiguration config, ILogger<EbRtmAlertMonitor> logger)
    {
        _repo = repo;
        _logger = logger;

        var section = config.GetSection("EbRtm:Alerts");
        _enabled = section.GetValue<bool?>("Enabled") ?? true;
        _maxDemandYellowKva = section.GetValue<double?>("MaxDemandYellowKva") ?? 7690;
        _maxDemandRedKva = section.GetValue<double?>("MaxDemandRedKva") ?? 7700;
        _pfYellowBelow = section.GetValue<double?>("PowerFactorYellowBelow") ?? 0.97;
        _pfRedBelow = section.GetValue<double?>("PowerFactorRedBelow") ?? 0.96;
        _tagQualityConfirm = TimeSpan.FromSeconds(section.GetValue<double?>("TagQualityConfirmSeconds") ?? 15);

        var meterId = section["MeterId"];
        var meters = config.GetSection("EbRtm:Meters").Get<List<MeterInfo>>() ?? new List<MeterInfo>();
        _meter = meters.FirstOrDefault(m => string.Equals(m.Id, meterId, StringComparison.OrdinalIgnoreCase));
        if (_enabled && _meter == null)
            _logger.LogWarning("EB-RTM alerts disabled: EbRtm:Alerts:MeterId '{MeterId}' is not in EbRtm:Meters", meterId);
    }

    // Called for every MQTT payload. avgVoltageQualityGood: quality of the AvgVoltage tag
    // (null until it has been received).
    public async Task EvaluateAsync(EbRtmReadingDto reading, bool? avgVoltageQualityGood)
    {
        if (!_enabled || _meter == null) return;
        await _gate.WaitAsync();
        try
        {
            if (!_seeded)
            {
                await SeedAsync();
                _seeded = true;
            }

            await EvaluateMaxDemandAsync(reading.MaxDemand);
            if (reading.AvgVoltage > 0) await EvaluatePowerFactorAsync(reading.PowerFactorSigned);
            if (avgVoltageQualityGood.HasValue) await EvaluateTagQualityAsync(avgVoltageQualityGood.Value);
        }
        finally
        {
            _gate.Release();
        }
    }

    // Called by EbRtmPowerFailureMonitor when a failure session starts (true) or ends (false).
    public async Task RaisePowerFailureAsync(bool failed)
    {
        if (!_enabled || _meter == null) return;
        await _gate.WaitAsync();
        try
        {
            if (failed)
                await AddAlertAsync(CategoryPowerFailure, "EB Power Failure", "EB Power Failure due to Incoming Voltage low 415V - 0V.", 3, null);
            else
                await AddAlertAsync(CategoryPowerFailure, "EB Power Returns", "EB Power Resumed Incoming Voltage Healthy 0V - 415V.", 3, null);
        }
        finally
        {
            _gate.Release();
        }
    }

    // changeInMaxDemand: lvl1Val = 7690, lvl2Val = 7700 (kVA).
    private async Task EvaluateMaxDemandAsync(double? value)
    {
        if (value is not { } v) return;
        var old = _prevMaxDemand;
        _prevMaxDemand = v;
        if (old is not { } o) return;

        var description = $"MD - Maximum Demand Reached FTM;Actual Reading: {Format(v, 2)}";
        if (v > _maxDemandYellowKva && v <= _maxDemandRedKva && o <= _maxDemandYellowKva)
            await AddAlertAsync(CategoryMaxDemand, "Yellow Alert: Maximum Demand Reached", description, 6, v);
        else if (v > _maxDemandRedKva && o <= _maxDemandRedKva)
            await AddAlertAsync(CategoryMaxDemand, "Red Alert: Maximum Demand Reached", description, 3, v);
    }

    // changeInPowerFactor: values rounded to 4 dp, thresh1 = 0.97, thresh2 = 0.96.
    private async Task EvaluatePowerFactorAsync(double? value)
    {
        if (value is not { } raw) return;
        var v = Math.Round(raw, 4);
        var old = _prevPowerFactor;
        _prevPowerFactor = v;
        if (old is not { } o) return;

        if (v < _pfYellowBelow && v >= _pfRedBelow && o >= _pfYellowBelow)
        {
            var t = Format(_pfYellowBelow, 4);
            await AddAlertAsync(CategoryPowerFactor, $"YELLOW ALERT: DURING EB POWER - POWER FACTOR (PF) LOW < {t}",
                $"During EB Power - Power Factor Low < {t};Actual Reading: {Format(v, 4)}", 2, v);
        }
        else if (v < _pfRedBelow && o >= _pfRedBelow)
        {
            var t = Format(_pfRedBelow, 4);
            await AddAlertAsync(CategoryPowerFactor, $"RED ALERT: DURING EB POWER - POWER FACTOR (PF) LOW < {t}",
                $"During EB Power - Power Factor Low < {t};Actual Reading: {Format(v, 4)}", 6, v);
        }
    }

    // checkTagQuality + changeInTagQuality: quality NOT GOOD is re-checked after 15 s before it counts.
    private async Task EvaluateTagQualityAsync(bool good)
    {
        var now = DateTime.Now;
        if (good)
        {
            _tagQualityBadSince = null;
            if (_tagQualityGood) return;
            _tagQualityGood = true;
            await AddAlertAsync(CategoryTagQuality, TitleTagQualityRetained, "Tag Quality GOOD.", 2, null);
            return;
        }

        _tagQualityBadSince ??= now;
        if (!_tagQualityGood || now - _tagQualityBadSince.Value < _tagQualityConfirm) return;
        _tagQualityGood = false;
        await AddAlertAsync(CategoryTagQuality, TitleTagQualityLost, "Tag Quality NOT GOOD.", 6, null);
    }

    private async Task SeedAsync()
    {
        try
        {
            var last = await _repo.GetLastTitleAsync(_meter!.SourceId, CategoryTagQuality);
            _tagQualityGood = last != TitleTagQualityLost;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to seed EB-RTM alert state from EbCAlerts (does the table exist? see Modules/EbRtm/Sql/EbCAlerts.sql)");
        }
    }

    private async Task AddAlertAsync(string category, string title, string description, int type, double? actualValue)
    {
        var meter = _meter!;
        try
        {
            await _repo.InsertAsync(new EbRtmAlertRepository.NewAlert
            {
                AlertTime = DateTime.Now,
                SourceId = meter.SourceId,
                MeterId = meter.MeterId,
                Device = meter.Device,
                MeterModel = meter.MeterModel,
                Category = category,
                Title = title,
                Description = description,
                Type = type,
                ActualValue = actualValue
            });
            _logger.LogInformation("EB-RTM alert ({Meter}): {Title}", meter.Id, title);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write EB-RTM alert '{Title}' to EbCAlerts (does the table exist? see Modules/EbRtm/Sql/EbCAlerts.sql)", title);
        }
    }

    private static string Format(double value, int maxDecimals) =>
        value.ToString("0." + new string('#', maxDecimals), CultureInfo.InvariantCulture);
}
