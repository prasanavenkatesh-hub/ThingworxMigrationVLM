using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// EB-RTM Reports (port of the ThingWorx RE_EMSRTMReports_MU mashup). Read-only views of what the
// EB-RTM dashboard logs: [EbRtm:Database].[dbo].[EbCMonitoring] (one meter snapshot per
// EbRtm:LogIntervalMinutes), [EbCPowerFailureEvents] (one row per failure session) and
// [EbCAlerts] (one row per alert, written by EbRtmAlertMonitor - has a SourceId column, so the
// Alerts tab is already filtered by meter).
//
// Days are production days (Shift A start -> next day's Shift A start, 00:15 -> 00:15 by default),
// the same window the dashboard's Energy Consumption table uses.
//
// Meters: the dropdown lists EbRtm:Meters. The logging tables have no meter column yet (only the
// 33KV EB Incomer | Source_7 meter is logged), so the meter only selects the descriptive columns;
// once a second meter is logged, add a MeterId column to both tables and filter on it here.
public class EbRtmReportService
{
    public const int MaxRangeDays = 93;

    // Report key -> EbCMonitoring column. Whitelisted: the column name is put into SQL text.
    private static readonly Dictionary<string, string> MmaColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["maxdemand"] = "MaxDemand",
        ["voltage"] = "AvgVoltage",
        ["powerfactor"] = "PowerFactorSigned",
        ["frequency"] = "Frequency"
    };

    private readonly IConfiguration _configuration;
    private readonly string _connectionString;
    private readonly string _database; // EbRtm:Database (appsettings.json)

    public EbRtmReportService(IConfiguration configuration)
    {
        _configuration = configuration;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _database = configuration["EbRtm:Database"] ?? "ControlTowerVLM";
    }

    public List<EbRtmMeterInfo> GetMeters() =>
        _configuration.GetSection("EbRtm:Meters").Get<List<EbRtmMeterInfo>>() ?? new List<EbRtmMeterInfo>();

    public EbRtmMeterInfo? FindMeter(string? id) =>
        GetMeters().FirstOrDefault(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase));

    public static bool IsMmaParameter(string? parameter) =>
        !string.IsNullOrWhiteSpace(parameter) && MmaColumns.ContainsKey(parameter);

    // Min / max / average of one logged value per production day.
    public async Task<List<EbRtmMmaReportRow>> GetMmaAsync(EbRtmMeterInfo meter, string parameter, DateTime from, DateTime to)
    {
        var column = MmaColumns[parameter];
        var dayStart = ShiftStart("A");
        var sql = $@"
            SELECT CAST(DATEADD(minute, -@OffsetMinutes, [Timestamp]) AS date) AS [Day],
                   MIN([{column}]) AS MinValue, MAX([{column}]) AS MaxValue, AVG([{column}]) AS AvgValue
            FROM [{_database}].[dbo].[EbCMonitoring]
            WHERE [Timestamp] >= @Start AND [Timestamp] < @End AND [{column}] IS NOT NULL
            GROUP BY CAST(DATEADD(minute, -@OffsetMinutes, [Timestamp]) AS date)
            ORDER BY [Day]";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<MmaRow>(sql, new
        {
            OffsetMinutes = (int)dayStart.TotalMinutes,
            Start = from.Date + dayStart,
            End = to.Date.AddDays(1) + dayStart
        });

        return rows.Select(r => Fill(new EbRtmMmaReportRow
        {
            Min = r.MinValue,
            Max = r.MaxValue,
            Avg = r.AvgValue
        }, meter, r.Day)).ToList();
    }

    // Alerts raised for the meter in the range (port of queryAlertsReport), oldest first.
    public async Task<List<EbRtmAlertReportRow>> GetAlertsAsync(EbRtmMeterInfo meter, DateTime from, DateTime to)
    {
        var dayStart = ShiftStart("A");
        var sql = $@"
            SELECT [AlertTime] AS [Timestamp], [SourceId], [MeterId], [Device], [MeterModel], [Title], [Description], [Type]
            FROM [{_database}].[dbo].[EbCAlerts]
            WHERE [SourceId] = @SourceId AND [AlertTime] >= @Start AND [AlertTime] < @End
            ORDER BY [AlertTime], [Id]";
        using var conn = new SqlConnection(_connectionString);
        var rows = (await conn.QueryAsync<EbRtmAlertReportRow>(sql, new
        {
            meter.SourceId,
            Start = from.Date + dayStart,
            End = to.Date.AddDays(1) + dayStart
        })).ToList();
        rows.ForEach(r => r.Priority = r.Type switch { 1 => "LOW", 2 => "MEDIUM", _ => "HIGH" });
        return rows;
    }

    // One row per power failure session that started in the range.
    public async Task<List<EbRtmPowerFailureReportRow>> GetPowerFailuresAsync(EbRtmMeterInfo meter, DateTime from, DateTime to)
    {
        var dayStart = ShiftStart("A");
        var sql = $@"
            SELECT [StartTime], [EndTime]
            FROM [{_database}].[dbo].[EbCPowerFailureEvents]
            WHERE [StartTime] >= @Start AND [StartTime] < @End
            ORDER BY [StartTime]";
        using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<SessionRow>(sql, new
        {
            Start = from.Date + dayStart,
            End = to.Date.AddDays(1) + dayStart
        });

        return rows.Select(r => Fill(new EbRtmPowerFailureReportRow
        {
            PowerOffFrom = r.StartTime,
            PowerOffTo = r.EndTime,
            PowerOffDurationMinutes = r.EndTime.HasValue ? Math.Round((r.EndTime.Value - r.StartTime).TotalMinutes, 2) : null
        }, meter, (r.StartTime - dayStart).Date)).ToList();
    }

    // kWh per production day and per shift: difference of the FWD Real Energy register between the
    // window's start and end (value at or before each boundary), divided by 1000 like the dashboard.
    // A window that hasn't started yet is null; the current one runs up to the latest reading.
    public async Task<List<EbRtmEnergyReportRow>> GetEnergyConsumptionAsync(EbRtmMeterInfo meter, DateTime from, DateTime to)
    {
        var a = ShiftStart("A");
        var b = ShiftStart("B");
        var c = ShiftStart("C");
        var rangeStart = from.Date + a;
        var rangeEnd = to.Date.AddDays(1) + a;

        // All register readings in the range plus the last one before it - one round trip, then the
        // boundaries are resolved in memory (a 93-day range at 15-minute logging is ~9k rows).
        var sql = $@"
            SELECT [Timestamp], [RealEnergyIntoLoad] FROM (
                SELECT TOP 1 [Timestamp], [RealEnergyIntoLoad] FROM [{_database}].[dbo].[EbCMonitoring]
                WHERE [Timestamp] < @Start AND [RealEnergyIntoLoad] IS NOT NULL
                ORDER BY [Timestamp] DESC
            ) seed
            UNION ALL
            SELECT [Timestamp], [RealEnergyIntoLoad] FROM [{_database}].[dbo].[EbCMonitoring]
            WHERE [Timestamp] >= @Start AND [Timestamp] <= @End AND [RealEnergyIntoLoad] IS NOT NULL
            ORDER BY [Timestamp]";
        List<ReadingRow> readings;
        using (var conn = new SqlConnection(_connectionString))
        {
            readings = (await conn.QueryAsync<ReadingRow>(sql, new { Start = rangeStart, End = rangeEnd })).ToList();
        }

        var now = DateTime.Now;
        // A boundary reading only counts if it was logged close to the boundary - otherwise (app/feed
        // down) the energy used during the gap would be attributed to whichever window the gap ends in.
        var logInterval = _configuration.GetValue<double?>("EbRtm:LogIntervalMinutes") ?? 15;
        var tolerance = TimeSpan.FromMinutes(Math.Max(30, logInterval * 2));

        int IndexAt(DateTime t)
        {
            // Last reading at or before t (readings are sorted by time); -1 if none.
            int lo = 0, hi = readings.Count - 1, found = -1;
            while (lo <= hi)
            {
                var mid = (lo + hi) / 2;
                if (readings[mid].Timestamp <= t) { found = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            return found;
        }

        // Energy used in [start, end): from the reading at the window start (or, if none was logged near
        // it, the first reading inside the window) to the last reading inside the window. Partial when
        // the readings don't reach both boundaries or the window is still in progress; the covered span
        // is returned so the page can mark the value. Null when there are fewer than two readings.
        (double? Value, string? Partial) Consumption(DateTime start, DateTime end)
        {
            if (start > now) return (null, null);                   // window hasn't started yet
            var endAt = end < now ? end : now;                      // current window: up to now
            int s = IndexAt(start), e = IndexAt(endAt);
            if (e < 0 || readings[e].Timestamp <= start) return (null, null);   // nothing logged inside the window

            var startOk = s >= 0 && start - readings[s].Timestamp <= tolerance;
            var endOk = endAt - readings[e].Timestamp <= tolerance && end <= now;
            var first = startOk ? s : s + 1;                        // s + 1 = first reading inside the window
            if (first >= e) return (null, null);                    // a single reading - no difference to take

            var value = Math.Round((readings[e].RealEnergyIntoLoad - readings[first].RealEnergyIntoLoad) / 1000.0, 2);
            var partial = startOk && endOk ? null : $"{readings[first].Timestamp:HH:mm}-{readings[e].Timestamp:HH:mm}";
            return (value, partial);
        }

        var result = new List<EbRtmEnergyReportRow>();
        for (var day = from.Date; day <= to.Date; day = day.AddDays(1))
        {
            var aStart = day + a;
            var bStart = day + (b >= a ? b : b.Add(TimeSpan.FromDays(1)));
            var cStart = day + (c >= a ? c : c.Add(TimeSpan.FromDays(1)));
            var next = day.AddDays(1) + a;
            var row = new EbRtmEnergyReportRow();
            void Set(string key, (double? Value, string? Partial) c, Action<double?> assign)
            {
                assign(c.Value);
                if (c.Value.HasValue && c.Partial != null) row.Partial[key] = c.Partial;
            }
            Set("dayConsumption", Consumption(aStart, next), v => row.DayConsumption = v);
            Set("shiftAConsumption", Consumption(aStart, bStart), v => row.ShiftAConsumption = v);
            Set("shiftBConsumption", Consumption(bStart, cStart), v => row.ShiftBConsumption = v);
            Set("shiftCConsumption", Consumption(cStart, next), v => row.ShiftCConsumption = v);
            result.Add(Fill(row, meter, day));
        }
        return result;
    }

    private static T Fill<T>(T row, EbRtmMeterInfo meter, DateTime day) where T : EbRtmReportRowBase
    {
        row.Date = day.ToString("yyyy-MM-dd");
        row.SourceId = meter.SourceId;
        row.MeterId = meter.MeterId;
        row.Device = meter.Device;
        row.MeterModel = meter.MeterModel;
        return row;
    }

    // Query row shapes (classes rather than tuples so Dapper converts float/decimal columns).
    private sealed class MmaRow { public DateTime Day { get; set; } public double? MinValue { get; set; } public double? MaxValue { get; set; } public double? AvgValue { get; set; } }
    private sealed class SessionRow { public DateTime StartTime { get; set; } public DateTime? EndTime { get; set; } }
    private sealed class ReadingRow { public DateTime Timestamp { get; set; } public double RealEnergyIntoLoad { get; set; } }

    private TimeSpan ShiftStart(string shift) =>
        TimeSpan.TryParse(_configuration[$"ShiftConfiguration:Shifts:{shift}:Start"], out var t)
            ? t
            : shift switch { "B" => new TimeSpan(7, 15, 0), "C" => new TimeSpan(15, 45, 0), _ => new TimeSpan(0, 15, 0) };
}
