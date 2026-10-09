namespace ControlTower.Models;

// One logged row from [ControlTowerVLM].[dbo].[EbCMonitoring] - a full snapshot of the meter,
// logged on a fixed interval (see EbRtmReadingLogger). Used both to seed the logger's slot state
// after a restart and to build the trend charts (Voltage/Frequency/PF/Current/Max Demand).
public class EbRtmReadingDto
{
    public DateTime Timestamp { get; set; }
    public double? AvgVoltage { get; set; }
    public double? AvgCurrent { get; set; }
    public double? Frequency { get; set; }
    public double? ActivePower { get; set; }
    public double? PowerFactorSigned { get; set; }
    public double? MaxDemand { get; set; }
    public double? PresentDemand { get; set; }
    public double? RealEnergyIntoLoad { get; set; }
}

// One row of the Energy Consumption sidebar card: Shift = "All" | "A" | "B" | "C".
// CurrentDay/PreviousDay are null when there isn't enough logged history to compute a delta
// (e.g. app was started partway through the window, so no reading exists at/near its start).
public class EbRtmEnergyConsumptionDto
{
    public string Shift { get; set; } = "";
    public double? CurrentDay { get; set; }
    public double? PreviousDay { get; set; }
}

// One day of the "Energy Consumption" tab's historical chart. Consumption is the raw
// RealEnergyIntoLoad delta over that production day (Shift A start -> next day's Shift A start,
// same window as the sidebar's "All" row); null when there isn't logged data at both ends.
// Kept in the raw unit like EbRtmEnergyConsumptionDto - the frontend divides by 1000 for kWh.
public class EbRtmDailyEnergyDto
{
    public DateTime Date { get; set; }
    public double? Consumption { get; set; }
}

// One day of the "Power Failure Count" / "Power Failure Duration" tabs' bar charts. Count is the
// number of failure sessions that started that calendar day; DurationMinutes is the total time
// spent in failure within that calendar day (sessions are clipped to the day, and a still-open
// session counts up to now).
public class EbRtmDailyPowerFailureDto
{
    public DateTime Date { get; set; }
    public int Count { get; set; }
    public double DurationMinutes { get; set; }
}
