namespace ControlTower.Models;

// One energy meter offered in the EB-RTM Reports meter dropdown (appsettings EbRtm:Meters).
// SourceId / MeterId / Device / MeterModel are the descriptive columns every report row carries,
// mirroring the ThingWorx RE_EMSRTMReports_MU grids.
public class EbRtmMeterInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int SourceId { get; set; }
    public int MeterId { get; set; }
    public string Device { get; set; } = "NA";
    public string MeterModel { get; set; } = "NA";
}

public abstract class EbRtmReportRowBase
{
    public string Date { get; set; } = "";       // production day, yyyy-MM-dd
    public int SourceId { get; set; }
    public int MeterId { get; set; }
    public string Device { get; set; } = "";
    public string MeterModel { get; set; } = "";
}

// Energy Consumption tab: kWh per production day and per shift (null = fewer than two readings).
// Partial: for a value that covers only part of its window (logging gap, or the window is still in
// progress), the key of that value (dayConsumption / shiftAConsumption / ...) maps to the time span
// actually covered, e.g. "09:33-11:32". Complete values have no entry.
public class EbRtmEnergyReportRow : EbRtmReportRowBase
{
    public double? DayConsumption { get; set; }
    public double? ShiftAConsumption { get; set; }
    public double? ShiftBConsumption { get; set; }
    public double? ShiftCConsumption { get; set; }
    public Dictionary<string, string> Partial { get; set; } = new();
}

// Power Failure tab: one row per failure session. PowerOffTo / duration are null while ongoing.
public class EbRtmPowerFailureReportRow : EbRtmReportRowBase
{
    public DateTime PowerOffFrom { get; set; }
    public DateTime? PowerOffTo { get; set; }
    public double? PowerOffDurationMinutes { get; set; }
}

// Alerts tab: one row per alert in [EbCAlerts] (columns of the ThingWorx RE_EMRTMAlerts_DS grid).
// Device / MeterModel are as stored with the alert. Priority is derived from Type the way the
// ThingWorx sendAlertEmail did (1 LOW, 2 MEDIUM, 3 / 6 / other HIGH).
public class EbRtmAlertReportRow
{
    public DateTime Timestamp { get; set; }
    public int SourceId { get; set; }
    public int MeterId { get; set; }
    public string Device { get; set; } = "";
    public string MeterModel { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public int Type { get; set; }
    public string Priority { get; set; } = "";
}

// Max Demand / Voltage / Power Factor / Frequency tabs: min / max / average per production day.
public class EbRtmMmaReportRow : EbRtmReportRowBase
{
    public double? Min { get; set; }
    public double? Max { get; set; }
    public double? Avg { get; set; }
}
