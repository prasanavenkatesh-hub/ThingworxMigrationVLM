using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > PDI Dashboard > Hourly Screen. Port of the ThingWorx Things
//   MS_PDI_HourlyData_TH:  get_HourlyData (top grid), get_<Part>_Rejected_Reason -> <Part>_NOK_Reason_Details
//                          (Machine Shop Rejection Details pop-ups)
//   MS_PDI_SummaryPage_TH: MS_PDI_Overall_Count -> MS_PDI_Overall_Data (bottom grid)
// Source: [RE_VL_MachineShop].[dbo].[MachineShopData], one row per part checked at a part's PDI
// station (MachineShop:Pdi:Parts). Read-only.
//   Hourly grid:  rows of the station per hour of the shift (all statuses, as ThingWorx counted
//                 <Part>_Count_Produced); Total = all rows of the shift.
//   Summary grid: Total = all rows, Pass = OverallStation_Status OK, Fail = NOK.
//   Rejections:   NOK rows counted per reason in Checkpoints_5 and Checkpoints_7 (empty reasons skipped).
// Differences from ThingWorx (agreed with the user, 2026-10-27):
//   - Every grid and pop-up uses the ShiftConfiguration window. ThingWorx ended shift C at 23:59:59 in the
//     summary grid and used 15:44:00 - 00:14:00 in the rejection pop-ups.
//   - A reason found in both reason columns is one row (ThingWorx's UNION ALL listed it twice).
//   - One grouped query per request; ThingWorx ran 6-18 queries, filtered them in memory and capped each
//     part at 5000 rows (maxItems), which would cut the Total on a busy shift.
public class MachineShopPdiService
{
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_]{1,128}$", RegexOptions.Compiled);

    private readonly MachineShopSettings _settings;
    private readonly IConfiguration _configuration;
    private readonly string _connectionString;

    public MachineShopPdiService(IConfiguration configuration)
    {
        _configuration = configuration;
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
    }

    public IReadOnlyList<MachineShopPdiPartInfo> GetParts() =>
        _settings.Pdi.Parts.Select(p => new MachineShopPdiPartInfo(p.Id, p.Name, p.HourlyName, p.Station)).ToList();

    public bool HasPart(string id) => _settings.Pdi.Parts.Any(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));

    // ShiftConfiguration:Shifts names (A, B, C).
    public bool HasShift(string shift) => _configuration.GetSection($"ShiftConfiguration:Shifts:{shift}").Exists();

    // Shift window on a production day: date + Start .. date + End (+1 day when the shift wraps past
    // midnight, i.e. C). End is inclusive to the second ("00:14:59"), so the exclusive end is End + 1 s.
    public (DateTime Start, DateTime End) ShiftWindow(DateTime date, string shift)
    {
        var section = _configuration.GetSection($"ShiftConfiguration:Shifts:{shift}");
        var start = TimeSpan.Parse(section["Start"] ?? throw new InvalidOperationException($"Shift {shift} has no Start"), CultureInfo.InvariantCulture);
        var end = TimeSpan.Parse(section["End"] ?? throw new InvalidOperationException($"Shift {shift} has no End"), CultureInfo.InvariantCulture);
        var from = date.Date + start;
        var to = date.Date + end;
        if (to < from) to = to.AddDays(1);
        return (from, to.AddSeconds(1));
    }

    public async Task<MachineShopPdiHourly> GetHourlyAsync(DateTime date, string shift)
    {
        var (start, end) = ShiftWindow(date, shift);
        var columns = Math.Max(1, _settings.Pdi.HourColumns);
        // Hour columns used by this shift: one per started hour, the last one stretched to the shift end
        // (B / C: 7 hours + 14:15-15:44 / 22:45-00:14; A: 7 hours, Hour 8 unused) - as get_HourlyData.
        var used = Math.Min(columns, (int)Math.Ceiling((end - start).TotalMinutes / 60));
        var result = new MachineShopPdiHourly
        {
            Date = date.ToString("yyyy-MM-dd"), Shift = shift, Start = start, End = end, UpdatedAt = DateTime.Now
        };
        for (var i = 0; i < columns; i++)
        {
            if (i >= used) { result.Hours.Add("-"); continue; }
            var from = start.AddHours(i);
            var to = i == used - 1 ? end : start.AddHours(i + 1);
            result.Hours.Add($"{from:HH:mm} - {to.AddMinutes(-1):HH:mm}");
        }

        var parts = _settings.Pdi.Parts;
        var stations = parts.Select(p => p.Station.Trim()).Where(s => s.Length > 0).Distinct().ToList();
        var counts = new List<(string Station, int Bucket, string Status, int Count)>();
        if (stations.Count > 0)
        {
            var p = new DynamicParameters();
            p.Add("Start", start, DbType.DateTime);
            p.Add("End", end, DbType.DateTime);
            var names = new List<string>();
            for (var i = 0; i < stations.Count; i++)
            {
                names.Add($"@s{i}");
                p.Add($"s{i}", stations[i], DbType.AnsiString, size: 5);   // Station_Number is char(5)
            }
            // Bucket = whole hours since the shift start (folded into the last used column below).
            var sql = $@"
                SELECT RTRIM(d.Station_Number) AS Station, b.Bucket, ISNULL(RTRIM(d.OverallStation_Status), '') AS Status, COUNT(*) AS Count
                FROM {Source()} d
                CROSS APPLY (SELECT DATEDIFF(second, @Start, d.[DateTime]) / 3600 AS Bucket) b
                WHERE d.Station_Number IN ({string.Join(", ", names)})
                  AND d.[DateTime] >= @Start AND d.[DateTime] < @End
                GROUP BY RTRIM(d.Station_Number), b.Bucket, ISNULL(RTRIM(d.OverallStation_Status), '')";
            await using var conn = new SqlConnection(_connectionString);
            counts = (await conn.QueryAsync<(string Station, int Bucket, string Status, int Count)>(
                sql, p, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
        }

        foreach (var part in parts)
        {
            var station = part.Station.Trim();
            var rows = counts.Where(c => c.Station == station).ToList();
            var perHour = new List<int?>();
            for (var i = 0; i < columns; i++)
                perHour.Add(i >= used ? null : rows.Where(r => Math.Min(r.Bucket, used - 1) == i).Sum(r => r.Count));
            var total = rows.Sum(r => r.Count);
            result.Rows.Add(new MachineShopPdiHourlyRow { PartId = part.Id, Name = part.HourlyName, Counts = perHour, Total = total });
            result.Summary.Add(new MachineShopPdiSummaryRow
            {
                PartId = part.Id, Name = part.Name, Total = total,
                Pass = rows.Where(r => string.Equals(r.Status, _settings.Pdi.OkStatus, StringComparison.OrdinalIgnoreCase)).Sum(r => r.Count),
                Fail = rows.Where(r => string.Equals(r.Status, _settings.Pdi.NokStatus, StringComparison.OrdinalIgnoreCase)).Sum(r => r.Count)
            });
        }
        return result;
    }

    public async Task<MachineShopPdiRejections> GetRejectionsAsync(DateTime date, string shift, string partId)
    {
        var part = _settings.Pdi.Parts.First(p => string.Equals(p.Id, partId, StringComparison.OrdinalIgnoreCase));
        var (start, end) = ShiftWindow(date, shift);
        var result = new MachineShopPdiRejections
        {
            PartId = part.Id, Name = part.Name, Date = date.ToString("yyyy-MM-dd"), Shift = shift, Start = start, End = end
        };
        var reasonColumns = _settings.Pdi.RejectionReasonColumns.Select(Checked).ToList();
        if (reasonColumns.Count == 0) return result;
        var countColumn = Checked(_settings.Pdi.RejectionCountColumn);

        var p = new DynamicParameters();
        p.Add("Start", start, DbType.DateTime);
        p.Add("End", end, DbType.DateTime);
        p.Add("Station", part.Station.Trim(), DbType.AnsiString, size: 5);
        p.Add("Nok", _settings.Pdi.NokStatus);
        var branches = reasonColumns.Select(c => $@"
                    SELECT LTRIM(RTRIM(d.[{c}])) AS Reason
                    FROM {Source()} d
                    WHERE d.Station_Number = @Station AND d.OverallStation_Status = @Nok
                      AND d.[DateTime] >= @Start AND d.[DateTime] < @End
                      AND d.[{countColumn}] IS NOT NULL");
        var sql = $@"
                SELECT x.Reason, COUNT(*) AS Count
                FROM ({string.Join(" UNION ALL ", branches)}) x
                WHERE x.Reason <> ''
                GROUP BY x.Reason
                ORDER BY COUNT(*) DESC, x.Reason";
        await using var conn = new SqlConnection(_connectionString);
        result.Reasons = (await conn.QueryAsync<(string Reason, int Count)>(sql, p, commandTimeout: _settings.QueryTimeoutSeconds))
            .Select(r => new MachineShopPdiReason(r.Reason, r.Count)).ToList();
        return result;
    }

    // Part tab (ThingWorx MS_PDI_<Part>_MU, e.g. MS_PDI_Crankcase_TH): rows of the part's station on one
    // production day, per shift (ShiftConfiguration order) and per cell (MachineShop:Pdi:Parts:Cells):
    //   Produced = all rows, OK = OverallStation_Status OK, NOK = NOK   (<Cell>_<Part>_Count_Produced / _OK / _NOK)
    //   Total = the three shifts added up (get_TotalProducedPerDay); OK % / NOK % and the pies are worked out by
    //   the page from these counts (Total_MS_PDI_PieChart).
    // ThingWorx ended shifts A / B / C at 07:14:00 / 15:44:00 / 00:14:00 (the last minute of each shift was
    // missed); here every shift uses its ShiftConfiguration window. One grouped query instead of 54.
    // Parts with Sides (Crankshaft, MS_PDI_Crankshaft_TH get_Crankshaft<X>Data -> Cell_Crankshaft_Count): every
    // cell is split into the sides, a row counting for a side when that side's barcode column is not empty;
    // the totals are per side (Total_LH / Total_RH). ThingWorx counted Produced = OK + any other status there;
    // here Produced = all rows, as on the other part tabs (station 42 only logs OK / NOK).
    public async Task<MachineShopPdiPartDay> GetPartDayAsync(DateTime date, string partId)
    {
        var part = _settings.Pdi.Parts.First(p => string.Equals(p.Id, partId, StringComparison.OrdinalIgnoreCase));
        var cells = part.Cells.Select(c => c.Trim()).ToList();
        var sides = part.Sides.Select(s => (Name: s.Name.Trim(), Column: Checked(s.Column))).ToList();
        var keys = sides.Count == 0
            ? cells.Select(c => (Cell: c, Side: 0)).ToList()
            : cells.SelectMany(c => sides.Select((_, i) => (Cell: c, Side: i))).ToList();
        var result = new MachineShopPdiPartDay
        {
            PartId = part.Id, Title = string.IsNullOrWhiteSpace(part.Title) ? part.Name.ToUpperInvariant() : part.Title,
            Date = date.ToString("yyyy-MM-dd"), Cells = cells, Sides = sides.Select(s => s.Name).ToList(), Report = HasReport(part.Id),
            Columns = keys.Select(k => sides.Count == 0 ? $"CELL {k.Cell}" : $"CELL {k.Cell} {sides[k.Side].Name}").ToList(),
            UpdatedAt = DateTime.Now
        };
        var shifts = _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key).ToList();
        var windows = shifts.Select(s => (Shift: s, Window: ShiftWindow(date, s))).ToList();
        if (windows.Count == 0 || cells.Count == 0) return result;

        var cellColumn = Checked(_settings.Pdi.CellColumn);
        var station = string.IsNullOrWhiteSpace(part.TabStation) ? part.Station : part.TabStation;
        // One (Side, Code) row per side; without sides a single side 0 that every row belongs to.
        var sideApply = sides.Count == 0
            ? "CROSS APPLY (SELECT 0 AS Side, 'x' AS Code) s"
            : $"CROSS APPLY (VALUES {string.Join(", ", sides.Select((s, i) => $"({i}, d.[{s.Column}])"))}) s(Side, Code)";
        var p = new DynamicParameters();
        p.Add("Station", station.Trim(), DbType.AnsiString, size: 5);
        p.Add("DayStart", windows.Min(w => w.Window.Start), DbType.DateTime);
        p.Add("DayEnd", windows.Max(w => w.Window.End), DbType.DateTime);
        var cases = new List<string>();
        for (var i = 0; i < windows.Count; i++)
        {
            p.Add($"w{i}s", windows[i].Window.Start, DbType.DateTime);
            p.Add($"w{i}e", windows[i].Window.End, DbType.DateTime);
            cases.Add($"WHEN d.[DateTime] >= @w{i}s AND d.[DateTime] < @w{i}e THEN {i}");
        }
        var sql = $@"
                SELECT ISNULL(RTRIM(d.[{cellColumn}]), '') AS Cell, s.Side, w.Win, ISNULL(RTRIM(d.OverallStation_Status), '') AS Status, COUNT(*) AS Count
                FROM {Source()} d
                CROSS APPLY (SELECT CASE {string.Join(" ", cases)} END AS Win) w
                {sideApply}
                WHERE d.Station_Number = @Station
                  AND d.[DateTime] >= @DayStart AND d.[DateTime] < @DayEnd
                  AND w.Win IS NOT NULL
                  AND s.Code <> ''
                GROUP BY ISNULL(RTRIM(d.[{cellColumn}]), ''), s.Side, w.Win, ISNULL(RTRIM(d.OverallStation_Status), '')";
        await using var conn = new SqlConnection(_connectionString);
        var rows = (await conn.QueryAsync<(string Cell, int Side, int Win, string Status, int Count)>(
            sql, p, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();

        var now = DateTime.Now;
        for (var i = 0; i < windows.Count; i++)
        {
            var (shift, (start, end)) = windows[i];
            result.Shifts.Add(new MachineShopPdiShiftCounts
            {
                Shift = shift, Start = start, End = end, Current = now >= start && now < end,
                Range = $"[{ClockText(start)} - {ClockText(end.AddMinutes(-1))}]",
                Counts = Count(rows.Where(r => r.Win == i), keys, sides.Count)
            });
        }
        result.Total = Count(rows, keys, sides.Count);
        return result;
    }

    public bool HasReport(string partId) =>
        _settings.Pdi.Report.Parts.Any(id => string.Equals(id, partId, StringComparison.OrdinalIgnoreCase)) && HasPartTab(partId);

    public MachineShopPdiReportSettings ReportSettings => _settings.Pdi.Report;

    // OkStatus / NokStatus (the report's Status filter).
    public bool IsStatus(string status) => status == _settings.Pdi.OkStatus || status == _settings.Pdi.NokStatus;

    public IReadOnlyList<string> PartCells(string partId) =>
        _settings.Pdi.Parts.First(p => string.Equals(p.Id, partId, StringComparison.OrdinalIgnoreCase)).Cells.Select(c => c.Trim()).ToList();

    // PDI Report pop-up (ThingWorx RE_MS_PDI_Report_MU -> MS_PDI_CoverLH_TH.generateReport + getReportData): the rows
    // of one cell of the part's tab station from `from` 00:00 to `to` 23:59:59 (calendar days, as ThingWorx), oldest
    // first, kept when the status is one of `statuses` and the time of day falls in one of `shifts` (ShiftConfiguration
    // clock times). Remarks = the RemarkColumns joined with ": " for NOK rows, empty otherwise.
    // Differences from ThingWorx: the shift filter uses the ShiftConfiguration clock times for every day (ThingWorx
    // walked A/B/C windows from 00:15 on the first day, so the first day's 00:00-00:15 rows were dropped when not all
    // shifts were picked); all filters run in SQL and MaxRows is applied after them (ThingWorx cut the raw rows at
    // 5000 first and then filtered), and the page is told when the list was cut.
    public async Task<MachineShopPdiReport> GetReportAsync(string partId, DateTime from, DateTime to, string cell,
        IReadOnlyList<string> shifts, IReadOnlyList<string> statuses)
    {
        var part = _settings.Pdi.Parts.First(x => string.Equals(x.Id, partId, StringComparison.OrdinalIgnoreCase));
        var report = _settings.Pdi.Report;
        var maxRows = Math.Max(1, report.MaxRows);
        var station = string.IsNullOrWhiteSpace(part.TabStation) ? part.Station : part.TabStation;
        var result = new MachineShopPdiReport
        {
            PartId = part.Id, Name = part.Name, Cell = cell, From = from.ToString("yyyy-MM-dd"), To = to.ToString("yyyy-MM-dd"),
            Shifts = shifts.ToList(), Statuses = statuses.ToList(), MaxRows = maxRows
        };

        var p = new DynamicParameters();
        p.Add("Station", station.Trim(), DbType.AnsiString, size: 5);
        p.Add("Cell", cell, DbType.AnsiString, size: 5);
        p.Add("From", from.Date, DbType.DateTime);
        p.Add("To", to.Date.AddDays(1), DbType.DateTime);
        p.Add("Take", maxRows + 1);
        var statusNames = new List<string>();
        for (var i = 0; i < statuses.Count; i++)
        {
            statusNames.Add($"@st{i}");
            p.Add($"st{i}", statuses[i]);
        }
        // Time-of-day test per shift; a shift that wraps past midnight (C) is "after start OR before end".
        var shiftTests = new List<string>();
        var allShifts = _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key).ToList();
        if (shifts.Count < allShifts.Count)
        {
            for (var i = 0; i < shifts.Count; i++)
            {
                var (start, end) = ShiftWindow(DateTime.Today, shifts[i]);
                var startTime = start.TimeOfDay;
                var endTime = end - start >= TimeSpan.FromDays(1) ? TimeSpan.Zero : end.TimeOfDay;   // exclusive
                p.Add($"sh{i}s", startTime, DbType.Time);
                p.Add($"sh{i}e", endTime, DbType.Time);
                shiftTests.Add(end.Date > start.Date
                    ? $"(t.Tod >= @sh{i}s OR t.Tod < @sh{i}e)"
                    : $"(t.Tod >= @sh{i}s AND t.Tod < @sh{i}e)");
            }
        }
        var cellColumn = Checked(_settings.Pdi.CellColumn);
        var barcode = Checked(report.BarcodeColumn);
        var oper = Checked(report.OperatorColumn);
        var remarkColumns = report.RemarkColumns.Select(Checked).ToList();
        var remarkSelect = string.Concat(remarkColumns.Select((c, i) => $", d.[{c}] AS R{i}"));
        var sql = $@"
                SELECT TOP (@Take) d.[DateTime] AS Timestamp, d.[{barcode}] AS Barcode, d.OverallStation_Status AS Status,
                       d.[{oper}] AS OperatorId{remarkSelect}
                FROM {Source()} d
                CROSS APPLY (SELECT CAST(d.[DateTime] AS time) AS Tod) t
                WHERE d.Station_Number = @Station AND d.[{cellColumn}] = @Cell
                  AND d.[DateTime] >= @From AND d.[DateTime] < @To
                  AND d.OverallStation_Status IN ({string.Join(", ", statusNames)})
                  {(shiftTests.Count > 0 ? $"AND ({string.Join(" OR ", shiftTests)})" : "")}
                ORDER BY d.[DateTime]";
        await using var conn = new SqlConnection(_connectionString);
        var rows = (await conn.QueryAsync(sql, p, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
        result.Truncated = rows.Count > maxRows;
        foreach (IDictionary<string, object?> r in rows.Take(maxRows))
        {
            string Text(string key) => Convert.ToString(r[key])?.Trim() ?? "";
            var status = Text("Status");
            var remarks = string.Equals(status, _settings.Pdi.NokStatus, StringComparison.OrdinalIgnoreCase)
                ? string.Join(": ", remarkColumns.Select((_, i) => Text($"R{i}")))
                : "";
            result.Rows.Add(new MachineShopPdiReportRow((DateTime)r["Timestamp"]!, Text("Barcode"), status, remarks, Text("OperatorId")));
        }
        return result;
    }

    // PDI Summary tab (ThingWorx MS_PDI_Summary_MU -> MS_PDI_SummaryPage_TH):
    //   grids  get_Shift<X>_MS_PDI_Summary_Count -> Shift<X>_MS_PDI_Summary: Produced (all rows) / OK / NOK of each
    //          part's station (all cells) per shift
    //   pies   <Part>_Chart -> get_<Part>_OK_NOK_Percentage: OK / NOK % of the production day per part (the page
    //          works them out from Total)
    // Parts in MachineShop:Pdi:Summary:Parts order, each on its Station (as the Hourly Screen). ThingWorx ended
    // the shifts at 07:14:00 / 15:44:00 / 00:14:00; the ShiftConfiguration windows are used. One query instead of 54.
    public async Task<MachineShopPdiSummaryDay> GetSummaryDayAsync(DateTime date)
    {
        var parts = _settings.Pdi.Summary.Parts
            .Select(id => _settings.Pdi.Parts.FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase)))
            .Where(x => x != null).Select(x => x!).ToList();
        var result = new MachineShopPdiSummaryDay
        {
            Title = _settings.Pdi.Summary.Title, Date = date.ToString("yyyy-MM-dd"), UpdatedAt = DateTime.Now,
            Parts = parts.Select(x => new MachineShopPdiSummaryPart(x.Id,
                string.IsNullOrWhiteSpace(x.SummaryName) ? x.Name : x.SummaryName,
                string.IsNullOrWhiteSpace(x.Title) ? x.Name.ToUpperInvariant() : x.Title, x.Station.Trim())).ToList()
        };
        var shifts = _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key).ToList();
        var windows = shifts.Select(s => (Shift: s, Window: ShiftWindow(date, s))).ToList();
        var stations = result.Parts.Select(x => x.Station).Where(s => s.Length > 0).Distinct().ToList();
        if (windows.Count == 0 || stations.Count == 0) return result;

        var p = new DynamicParameters();
        p.Add("DayStart", windows.Min(w => w.Window.Start), DbType.DateTime);
        p.Add("DayEnd", windows.Max(w => w.Window.End), DbType.DateTime);
        var cases = new List<string>();
        for (var i = 0; i < windows.Count; i++)
        {
            p.Add($"w{i}s", windows[i].Window.Start, DbType.DateTime);
            p.Add($"w{i}e", windows[i].Window.End, DbType.DateTime);
            cases.Add($"WHEN d.[DateTime] >= @w{i}s AND d.[DateTime] < @w{i}e THEN {i}");
        }
        var names = new List<string>();
        for (var i = 0; i < stations.Count; i++)
        {
            names.Add($"@s{i}");
            p.Add($"s{i}", stations[i], DbType.AnsiString, size: 5);   // Station_Number is char(5)
        }
        var sql = $@"
                SELECT RTRIM(d.Station_Number) AS Station, 0 AS Side, w.Win, ISNULL(RTRIM(d.OverallStation_Status), '') AS Status, COUNT(*) AS Count
                FROM {Source()} d
                CROSS APPLY (SELECT CASE {string.Join(" ", cases)} END AS Win) w
                WHERE d.Station_Number IN ({string.Join(", ", names)})
                  AND d.[DateTime] >= @DayStart AND d.[DateTime] < @DayEnd
                  AND w.Win IS NOT NULL
                GROUP BY RTRIM(d.Station_Number), w.Win, ISNULL(RTRIM(d.OverallStation_Status), '')";
        await using var conn = new SqlConnection(_connectionString);
        var rows = (await conn.QueryAsync<(string Cell, int Side, int Win, string Status, int Count)>(
            sql, p, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();

        // One "column" per part, keyed by its station (Count() groups by Cell = station here).
        var keys = result.Parts.Select(x => (Cell: x.Station, Side: 0)).ToList();
        var now = DateTime.Now;
        for (var i = 0; i < windows.Count; i++)
        {
            var (shift, (start, end)) = windows[i];
            result.Shifts.Add(new MachineShopPdiShiftCounts
            {
                Shift = shift, Start = start, End = end, Current = now >= start && now < end,
                Range = $"[{ClockText(start)} - {ClockText(end.AddMinutes(-1))}]",
                Counts = Count(rows.Where(r => r.Win == i), keys, 0)
            });
        }
        result.Total = Count(rows, keys, 0);
        return result;
    }

    private MachineShopPdiCounts Count(IEnumerable<(string Cell, int Side, int Win, string Status, int Count)> rows,
        List<(string Cell, int Side)> keys, int sideCount)
    {
        var list = rows.ToList();
        bool IsStatus(string s, string want) => string.Equals(s, want, StringComparison.OrdinalIgnoreCase);
        var c = new MachineShopPdiCounts();
        foreach (var key in keys)
        {
            var mine = list.Where(r => r.Cell == key.Cell && r.Side == key.Side).ToList();
            c.Produced.Add(mine.Sum(r => r.Count));
            c.Ok.Add(mine.Where(r => IsStatus(r.Status, _settings.Pdi.OkStatus)).Sum(r => r.Count));
            c.Nok.Add(mine.Where(r => IsStatus(r.Status, _settings.Pdi.NokStatus)).Sum(r => r.Count));
        }
        c.ProducedTotal = c.Produced.Sum();
        c.OkTotal = c.Ok.Sum();
        c.NokTotal = c.Nok.Sum();
        for (var side = 0; side < sideCount; side++)
        {
            var idx = keys.Select((k, i) => (k, i)).Where(x => x.k.Side == side).Select(x => x.i).ToList();
            c.ProducedBySide.Add(idx.Sum(i => c.Produced[i]));
            c.OkBySide.Add(idx.Sum(i => c.Ok[i]));
            c.NokBySide.Add(idx.Sum(i => c.Nok[i]));
        }
        return c;
    }

    // 00:15 -> "12:15am", 15:44 -> "03:44pm" (ThingWorx shift labels).
    private static string ClockText(DateTime t) =>
        t.ToString("hh:mm", CultureInfo.InvariantCulture) + (t.Hour < 12 ? "am" : "pm");

    public bool HasPartTab(string id) =>
        _settings.Pdi.Parts.Any(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase) && p.Cells.Count > 0);

    private string Source() =>$"[{Checked(_settings.Database)}].[dbo].[{Checked(_settings.Table)}]";

    private static string Checked(string name) =>
        SafeName.IsMatch(name ?? "") ? name! : throw new InvalidOperationException($"MachineShop: invalid database / table / column name '{name}'");
}
