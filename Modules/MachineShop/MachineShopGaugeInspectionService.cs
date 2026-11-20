using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > Gauge Inspection Data (read-only). Port of the ThingWorx mashup QF_OnlineInspection_MU and its Thing
// "QF_Online _Inspection _DB_TH":
//   getProcessCodeByMachineName (getAllProcessCode / getAllProcessCodeCoverLH)       -> GetProcessCodesAsync
//   getOnlineInspData + getReportDataView{OPE,INSP}[CoverLH]                         -> GetDataAsync
// Per day, selected process code and selected shift one row: Operator Plan / Actual for operator operations,
// Inspector Plan / Actual for inspector operations (code starting with QF), the other pair 0; then a Cumulative row.
// Actual = distinct parts checked in the shift: QRCode for operators, BatchNo for inspectors.
// Differences from ThingWorx (agreed 2026-11-13, see README):
//   - Shift C actuals are counted (ThingWorx read never-set variables, so Shift C Actual was always blank).
//   - Cover LH: a reading's job is matched on JobSerialno + LineName (ThingWorx joined JobParameter on JobSerialno only;
//     job numbers repeat across cells, so readings were counted under the other cell's operation as well) and the
//     query is aggregated in SQL (ThingWorx fetched every reading x every JobParameter row of its job and stopped at
//     maxItems = 50 000 rows - about half a day - so later shifts were under-counted, e.g. 12 Nov 2026 CELL1 OPN_20L1
//     shift B: 3 instead of 6).
//   - Cover LH Inspector Actual = distinct BatchNo (ThingWorx counted a BatchNo column its query did not return: 1 or 0).
//   - Shift windows from ShiftConfiguration (ThingWorx left out 07:14-07:15 and 15:44-15:45); TODAY = the current
//     production day; a shift that has not started has no Actual (ThingWorx showed 0).
//   - Process Code dropdown = codes read in the last ProcessCodeDays days (ThingWorx: fixed 2022 / 2024 windows).
//   - Process codes are matched exactly (ThingWorx LIKE, where '_' is a wildcard).
public class MachineShopGaugeInspectionService
{
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_\- ]{1,128}$", RegexOptions.Compiled);
    public const string SourceJobReading = "JobReading";
    public const string SourceCheckSheet = "CheckSheet";
    public const string RangeToday = "today";
    public const string RangeCustom = "custom";

    private readonly MachineShopSettings _settings;
    private readonly MachineShopGaugeInspectionSettings _gi;
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly MachineShopPdiService _pdi;
    private readonly object _cacheLock = new();
    private readonly Dictionary<string, (DateTime At, List<string> Codes)> _codeCache = new(StringComparer.OrdinalIgnoreCase);

    public MachineShopGaugeInspectionService(IConfiguration configuration, MachineShopPdiService pdi)
    {
        _configuration = configuration;
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _gi = _settings.GaugeInspection;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _pdi = pdi;
    }

    private List<string> ShiftNames() =>
        _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key).ToList();

    private List<string> CellNames() => Enumerable.Range(1, Math.Max(1, _gi.CellCount)).Select(n => $"CELL{n}").ToList();

    public MachineShopGidMachine? FindMachine(string? name) =>
        _gi.Machines.FirstOrDefault(m => string.Equals(m.Name, name?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static bool HasSource(MachineShopGidMachine m) =>
        !string.IsNullOrWhiteSpace(m.Database) && (m.Source == SourceJobReading || m.Source == SourceCheckSheet);

    private bool HasCells(MachineShopGidMachine m) =>
        m.Source == SourceJobReading && _gi.CellMachines.Any(c => string.Equals(c, m.Name, StringComparison.OrdinalIgnoreCase));

    public bool IsCell(string? cell) => CellNames().Contains(cell ?? "", StringComparer.OrdinalIgnoreCase);
    public bool IsShift(string shift) => ShiftNames().Contains(shift);

    public MachineShopGidOptions GetOptions() => new()
    {
        Machines = _gi.Machines.Select(m => new MachineShopGidMachineInfo(m.Name, HasSource(m), HasCells(m))).ToList(),
        Cells = CellNames(),
        Shifts = ShiftNames(),
        MaxRangeDays = _gi.MaxRangeDays,
        CustomDefaultDaysBack = _gi.CustomDefaultDaysBack
    };

    private static string Checked(string name) =>
        SafeName.IsMatch(name) ? name : throw new InvalidOperationException($"Invalid database / table name '{name}'.");

    private static string Db(MachineShopGidMachine m) => $"[{Checked(m.Database.Trim())}].[dbo]";

    private bool IsInspectorCode(string code) => SqlLike(code, _gi.InspectorProcessPattern);

    // SQL LIKE with % and _ only (the configured pattern), case-insensitive.
    private static bool SqlLike(string value, string pattern)
    {
        var regex = "^" + Regex.Escape(pattern).Replace("%", ".*").Replace("_", ".") + "$";
        return Regex.IsMatch(value, regex, RegexOptions.IgnoreCase);
    }

    // Production day window: first shift start .. last shift end.
    private (DateTime Start, DateTime End) DayWindow(DateTime day)
    {
        var shifts = ShiftNames();
        return (_pdi.ShiftWindow(day, shifts[0]).Start, _pdi.ShiftWindow(day, shifts[^1]).End);
    }

    // The production day `now` belongs to (00:00 - 00:14 still belongs to yesterday).
    public DateTime ProductionDay(DateTime now) => now >= DayWindow(now.Date).Start ? now.Date : now.Date.AddDays(-1);

    public string? CheckRange(DateTime fromDay, DateTime toDay, DateTime now)
    {
        if (toDay.Date < fromDay.Date) return "From must not be after To.";
        if (fromDay.Date > ProductionDay(now)) return "From must not be in the future.";
        if ((toDay.Date - fromDay.Date).TotalDays >= _gi.MaxRangeDays)
            return $"Select at most {_gi.MaxRangeDays} days.";
        return null;
    }

    // ---- Process Code dropdown (ThingWorx getProcessCodeByMachineName) ----
    public async Task<List<string>> GetProcessCodesAsync(string machineName)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        if (!HasSource(machine)) return new List<string>();
        lock (_cacheLock)
        {
            if (_codeCache.TryGetValue(machine.Name, out var hit) && DateTime.Now - hit.At < TimeSpan.FromMinutes(Math.Max(0, _gi.ProcessCodeCacheMinutes)))
                return hit.Codes.ToList();
        }

        var db = Db(machine);
        var lineJoin = HasCells(machine) ? " AND j.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT" : "";
        await using var conn = new SqlConnection(_connectionString);
        var since = DateTime.Today.AddDays(-Math.Max(1, _gi.ProcessCodeDays));
        var codes = (await conn.QueryAsync<string>($@"
SELECT DISTINCT j.ProcessCode FROM {db}.[JobReading] r
JOIN {db}.[Job] j ON j.JobSerialno = r.JobSerialno{lineJoin}
WHERE r.ReadingDate >= @since AND j.ProcessCode IS NOT NULL", new { since }, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
        if (codes.Count == 0)   // nothing read lately (Crank Case LH: no readings since 2024): every job's process code
            codes = (await conn.QueryAsync<string>($"SELECT DISTINCT ProcessCode FROM {db}.[Job] WHERE ProcessCode IS NOT NULL",
                commandTimeout: _settings.QueryTimeoutSeconds)).ToList();

        var result = codes.Select(c => c.Trim()).Where(c => c.Length > 0)
            .Where(c => !_gi.ExcludeProcessCodes.Contains(c, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(c => c, StringComparer.Ordinal).ToList();
        lock (_cacheLock) _codeCache[machine.Name] = (DateTime.Now, result);
        return result.ToList();
    }

    // ---- Grid (ThingWorx getOnlineInspData) ----
    public async Task<MachineShopGidData> GetDataAsync(string machineName, string? cell, IReadOnlyList<string> shifts,
        IReadOnlyList<string> processCodes, string range, DateTime? fromDay, DateTime? toDay)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        var now = DateTime.Now;
        DateTime first, last;
        if (range == RangeToday) first = last = ProductionDay(now);
        else { first = fromDay!.Value.Date; last = toDay!.Value.Date; }

        var hasCells = HasCells(machine);
        var result = new MachineShopGidData
        {
            Machine = machine.Name, HasSource = HasSource(machine), HasCells = hasCells, Cell = hasCells ? cell : null,
            From = DateTime.SpecifyKind(DayWindow(first).Start, DateTimeKind.Unspecified),
            To = DateTime.SpecifyKind(DayWindow(last).End, DateTimeKind.Unspecified)
        };

        // Shift windows in row order: day -> code -> shift (ThingWorx generateReportForDay).
        var shiftOrder = ShiftNames().Where(shifts.Contains).ToList();
        var windows = new List<(DateTime Day, string Shift, DateTime Start, DateTime End)>();
        for (var day = first; day <= last; day = day.AddDays(1))
            foreach (var s in shiftOrder)
            {
                var (start, end) = _pdi.ShiftWindow(day, s);
                windows.Add((day, s, start, end));
            }

        var counts = new Dictionary<(int Window, string Code), int>();
        var started = windows.Select((w, i) => (w, i)).Where(x => x.w.Start <= now).Select(x => x.i).ToList();
        if (result.HasSource && started.Count > 0 && processCodes.Count > 0)
        {
            await using var conn = new SqlConnection(_connectionString);
            foreach (var row in await CountAsync(conn, machine, hasCells ? cell : null, windows, started, processCodes, now))
                counts[(row.Idx, row.ProcessCode.Trim())] = row.N;
        }

        foreach (var day in windows.Select(w => w.Day).Distinct())
            foreach (var code in processCodes)
                for (var i = 0; i < windows.Count; i++)
                {
                    var w = windows[i];
                    if (w.Day != day) continue;
                    var inspector = IsInspectorCode(code);
                    int? actual = !result.HasSource || w.Start > now ? null : counts.GetValueOrDefault((i, code), 0);
                    result.Rows.Add(new MachineShopGidRow
                    {
                        Date = DateTime.SpecifyKind(w.Start, DateTimeKind.Unspecified), Shift = $"Shift {w.Shift}", Operation = code,
                        Inspector = inspector, Finished = result.HasSource && w.End <= now,
                        OperatorPlan = inspector ? 0 : _gi.OperatorPlan.GetValueOrDefault(w.Shift),
                        OperatorActual = inspector ? 0 : actual,
                        InspectorPlan = inspector ? _gi.InspectorPlan.GetValueOrDefault(w.Shift) : 0,
                        InspectorActual = inspector ? actual : 0
                    });
                }

        result.Cumulative = new MachineShopGidRow
        {
            Operation = "Cumulative",
            OperatorPlan = result.Rows.Sum(r => r.OperatorPlan),
            OperatorActual = result.Rows.Sum(r => r.OperatorActual ?? 0),
            InspectorPlan = result.Rows.Sum(r => r.InspectorPlan),
            InspectorActual = result.Rows.Sum(r => r.InspectorActual ?? 0)
        };
        return result;
    }

    private record CountRow(int Idx, string ProcessCode, int N);

    // Distinct parts per shift window and process code, aggregated in SQL. The windows are passed as a VALUES list.
    private async Task<IEnumerable<CountRow>> CountAsync(SqlConnection conn, MachineShopGidMachine machine, string? cell,
        List<(DateTime Day, string Shift, DateTime Start, DateTime End)> windows, List<int> started,
        IReadOnlyList<string> processCodes, DateTime now)
    {
        var p = new DynamicParameters();
        var values = new StringBuilder();
        foreach (var i in started)
        {
            if (values.Length > 0) values.Append(", ");
            values.Append($"({i}, @s{i}, @e{i})");
            p.Add($"s{i}", windows[i].Start);
            p.Add($"e{i}", windows[i].End < now ? windows[i].End : now);
        }
        var dayFrom = windows[started[0]].Start.Date;
        var dayTo = started.Max(i => windows[i].End).Date;
        p.Add("dayFrom", dayFrom);
        p.Add("dayTo", dayTo);
        var db = Db(machine);
        const string time = "(CAST({0}.ReadingDate AS DATETIME) + CAST({0}.ReadingTime AS DATETIME))";
        string Win(string alias) =>
            $"JOIN (VALUES {values}) w(Idx, S, E) ON {string.Format(time, alias)} >= w.S AND {string.Format(time, alias)} < w.E";

        string sql;
        if (machine.Source == SourceJobReading)
        {
            var lineJoin = cell != null ? " AND j.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT" : "";
            var cellFilter = cell != null ? "\n  AND r.LineName LIKE @cellPattern" : "";
            if (cell != null)
                p.Add("cellPattern", string.Format(CultureInfo.InvariantCulture, _gi.CellLinePattern, Regex.Match(cell, @"\d+").Value));
            p.Add("codes", processCodes);
            p.Add("inspectorPattern", _gi.InspectorProcessPattern);
            sql = $@"
SELECT w.Idx, j.ProcessCode, COUNT(DISTINCT CASE WHEN j.ProcessCode LIKE @inspectorPattern THEN r.BatchNo ELSE r.QRCode END) AS N
FROM {db}.[JobReading] r
JOIN {db}.[Job] j ON j.JobSerialno = r.JobSerialno{lineJoin}
{Win("r")}
WHERE r.ReadingDate >= @dayFrom AND r.ReadingDate <= @dayTo
  AND j.ProcessCode IN @codes{cellFilter}
GROUP BY w.Idx, j.ProcessCode;";
        }
        else
        {
            // Crank Case LH check-sheet views: operator codes from OperatorCheckSheet (QRCode), inspector codes from
            // InspectorCheckSheet (BatchNo). The views have no cell column (ThingWorx ignored the cell here too).
            var opCodes = processCodes.Where(c => !IsInspectorCode(c)).ToList();
            var inCodes = processCodes.Where(IsInspectorCode).ToList();
            var parts = new List<string>();
            if (opCodes.Count > 0)
            {
                p.Add("opCodes", opCodes);
                parts.Add($@"SELECT w.Idx, o.ProcessCode, COUNT(DISTINCT o.QRCode) AS N
FROM {db}.[{Checked(_gi.OperatorCheckSheet)}] o
{Win("o")}
WHERE o.ReadingDate >= @dayFrom AND o.ReadingDate <= @dayTo AND o.ProcessCode IN @opCodes
GROUP BY w.Idx, o.ProcessCode");
            }
            if (inCodes.Count > 0)
            {
                p.Add("inCodes", inCodes);
                parts.Add($@"SELECT w.Idx, i.ProcessCode, COUNT(DISTINCT i.BatchNo) AS N
FROM {db}.[{Checked(_gi.InspectorCheckSheet)}] i
{Win("i")}
WHERE i.ReadingDate >= @dayFrom AND i.ReadingDate <= @dayTo AND i.ProcessCode IN @inCodes
GROUP BY w.Idx, i.ProcessCode");
            }
            sql = string.Join("\nUNION ALL\n", parts) + ";";
        }
        return await conn.QueryAsync<CountRow>(sql, p, commandTimeout: _settings.QueryTimeoutSeconds);
    }
}
