using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > Online Control Charts, SPC LIVE and SPC MONTHLY views (read-only). Ports of the ThingWorx mashups
// QualityFunction_MU (SPC LIVE), QualityFunctionMonthly_MU (SPC MONTHLY) + RE_SPCMonthlyReadingPopup_MU (Readings) and
// RE_SPCReportTable_MU (Report), and their Things:
//   RE_CrankCase_Helper_DB_TH
//     PartParaDescriptionfromConfigurationPage   parameters = CriticalPartParameter codes with SPC = 1 -> GetOptionsAsync
//     QualityLiveProcessCode / QualityFunctionTestingMonthlyProcessCode / getAllDistinctProcessCodes
//                                                process codes of the readings in the window, OPN* / QF_* -> GetProcessCodesAsync
//     QualityFunctionSQLQuery[CoverLH] + QualityFunctionChartOriginal + QualityTranspose -> GetLiveAsync
//     generateSPCReport                          -> GetReportAsync
//   RE_MS_SPCMonthlyHelper_TH
//     store7RandomValuesCoverLH (subscriptions shiftAEndEvent / shiftBEndEvent / dayEndEvent) + get7RandomSPCDataCoverLH /
//     getSPCDataCoverLH: one sub-group of 7 random readings per shift, cell, role, parameter and process code, stored in
//     the stream RE_MS_RandomXValues_Stream with XBar, Range and the Nelson-rule Remarks
//     querySPCData + calculateStaticSPCValuesForTag[WithData] + calculateXBarChart + calculateSPCRangeChart -> GetMonthlyAsync
// Differences from ThingWorx (agreed 2026-11-11, see README):
//   - No stream: the 7 readings of each finished shift are picked from the database on every request with a fixed
//     pseudo-random order (a hash of the reading), so a chart never changes between refreshes and any past month
//     works without the "Past Data" back-fill (storeBulkHistoricData). The picks differ from ThingWorx's random ones.
//   - Job and JobParameter are matched on JobSerialno (+ LineName where the machine has cells) with one JobParameter
//     row per reading, and the cell filter is on the reading's own LineName. ThingWorx joined JobParameter on process
//     code + parameter only and filtered JobParameter.LineName, so every reading came ~3 times and a "CELL1" chart held
//     about half Cell-2 readings.
//   - Nelson rules use the limits of the selected range (the ones on the chart); ThingWorx used limits fixed from the
//     April 2024 stream data (staticValueStartDate / EndDate). Rules 3 and 4 count the first step too (in ThingWorx
//     they could never fire: the counter could not reach 6 / 14).
//   - Windows follow ShiftConfiguration: a SPC LIVE day and the SPC MONTHLY From / To days are production days
//     (first shift start .. last shift end); ThingWorx used calendar days. The SPC MONTHLY end day is included
//     (ThingWorx querySPCData cut it off at 00:00).
//   - SPC LIVE: limits copied from ThingWorx (R-bar = max - min of the whole day's readings, sample size = Part
//     Parameter Config Sample Size). Its Cell dropdown filters the readings (ThingWorx ignored it).
public class MachineShopControlChartsSpcService
{
    public const string RoleOperator = "OPERATOR";
    public const string RoleInspector = "INSPECTOR";

    private readonly MachineShopSettings _settings;
    private readonly MachineShopControlChartsSettings _cc;
    private readonly MachineShopOccSpcSettings _spc;
    private readonly string _connectionString;
    private readonly MachineShopControlChartsService _occ;
    private readonly MachineShopPdiService _pdi;
    private readonly MachineShopPartParamService _partParam;

    public MachineShopControlChartsSpcService(IConfiguration configuration, MachineShopControlChartsService occ,
        MachineShopPdiService pdi, MachineShopPartParamService partParam)
    {
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _cc = _settings.ControlCharts;
        _spc = _cc.Spc;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _occ = occ;
        _pdi = pdi;
        _partParam = partParam;
    }

    public bool IsRole(string? role) => role is RoleOperator or RoleInspector;

    // CELL1 .. CELLn (ThingWorx RE_GaugingReport_DB_TH.cell).
    private List<string> CellNames() => Enumerable.Range(1, Math.Max(1, _spc.CellCount)).Select(n => $"CELL{n}").ToList();

    public bool IsCell(string? cell) => CellNames().Contains(cell ?? "", StringComparer.OrdinalIgnoreCase);

    private string CellPattern(string cell)
    {
        var digits = Regex.Match(cell ?? "", @"\d+").Value;
        return string.Format(CultureInfo.InvariantCulture, _cc.CellLinePattern, digits);
    }

    private string RolePattern(string role) => role == RoleOperator ? _spc.OperatorProcessPattern : _spc.InspectorProcessPattern;

    private MachineShopPartParamMachine Machine(string name) =>
        _occ.FindMachine(name) ?? throw new ArgumentException($"Unknown machine '{name}'.");

    private static bool HasSource(MachineShopPartParamMachine m) => !string.IsNullOrWhiteSpace(m.Database);

    // Production day window(s): first shift start of `fromDay` .. last shift end of `toDay`.
    private (DateTime From, DateTime To) Window(DateTime fromDay, DateTime toDay)
    {
        var from = _occ.DayWindow(fromDay.Date).Start;
        var to = _occ.DayWindow(toDay.Date).End;
        return (DateTime.SpecifyKind(from, DateTimeKind.Unspecified), DateTime.SpecifyKind(to, DateTimeKind.Unspecified));
    }

    // Longest SPC MONTHLY / Report range (ThingWorx QualityDateRangeLimit message).
    public string? CheckRange(DateTime fromDay, DateTime toDay)
    {
        if (toDay.Date < fromDay.Date) return "From must not be after To.";
        if ((toDay.Date - fromDay.Date).TotalDays > _spc.MaxRangeDays)
            return $"Days selected exceeds {_spc.MaxRangeDays} days ! Please Choose a range between {_spc.MaxRangeDays} days.";
        return null;
    }

    public async Task<MachineShopOccSpcOptions> GetOptionsAsync(string machineName)
    {
        var machine = Machine(machineName);
        var result = new MachineShopOccSpcOptions
        {
            Machine = machine.Name, HasSource = HasSource(machine), HasCells = _occ.IsCellMachine(machine.Name),
            Cells = CellNames(), Roles = new List<string> { RoleOperator, RoleInspector },
            SubgroupSize = _spc.SubgroupSize, MaxRangeDays = _spc.MaxRangeDays, MonthlyDefaultDays = _spc.MonthlyDefaultDays
        };
        if (!result.HasSource) return result;
        await using var conn = new SqlConnection(_connectionString);
        result.Parameters = await ParametersAsync(conn, machine);
        return result;
    }

    private async Task<List<MachineShopOccSpcParameter>> ParametersAsync(SqlConnection conn, MachineShopPartParamMachine machine)
    {
        var db = Db(machine);
        var rows = await conn.QueryAsync<(string Code, string Description)>($@"
SELECT PartParaCode, MAX(ISNULL(PartParaDescription, '')) FROM {db}.[CriticalPartParameter]
WHERE SPC = 1 AND PartParaCode IS NOT NULL
GROUP BY PartParaCode ORDER BY PartParaCode", commandTimeout: _settings.QueryTimeoutSeconds);
        return rows.Select(r => new MachineShopOccSpcParameter(r.Code.Trim(), (r.Description ?? "").Trim())).ToList();
    }

    private static string Db(MachineShopPartParamMachine machine) =>
        $"[{MachineShopControlChartsService.Checked(machine.Database.Trim())}].[dbo]";

    private record ReadingRow(string Code, string ProcessCode, DateTime ReadTime, double Reading, double? Lsl, double? Usl,
        double? LclXBar, double? UclXBar, string? QrCode);

    // The readings behind every SPC view: JobReading + its Job (process code) + one JobParameter row with Cp / Cpk
    // (limits), parameter in PartParameter (as the ThingWorx inner join). `codes` null = every SPC = 1 parameter.
    private async Task<List<ReadingRow>> ReadingsAsync(SqlConnection conn, MachineShopPartParamMachine machine,
        IReadOnlyCollection<string>? codes, string rolePattern, IReadOnlyCollection<string>? processCodes, string? cellPattern,
        DateTime from, DateTime to, bool distinctProcessCodesOnly = false)
    {
        var db = Db(machine);
        var cells = _occ.IsCellMachine(machine.Name);
        var lineJoin = cells ? " AND j.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT" : "";
        var lineParam = cells ? " AND jp.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT" : "";
        var where = new StringBuilder(@"j.ProcessCode LIKE @rolePattern
    AND r.ReadingDate >= @dayFrom AND r.ReadingDate <= @dayTo
    AND (CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME)) BETWEEN @from AND @to");
        where.Append(codes == null
            ? $"\n    AND r.PartParaCode COLLATE DATABASE_DEFAULT IN (SELECT c.PartParaCode COLLATE DATABASE_DEFAULT FROM {db}.[CriticalPartParameter] c WHERE c.SPC = 1)"
            : "\n    AND r.PartParaCode IN @codes");
        if (processCodes != null) where.Append("\n    AND j.ProcessCode IN @processCodes");
        if (cellPattern != null && cells) where.Append("\n    AND r.LineName LIKE @cellPattern");

        var select = distinctProcessCodesOnly
            ? "SELECT DISTINCT j.ProcessCode"
            : @"SELECT r.PartParaCode AS Code, j.ProcessCode,
       (CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME)) AS ReadTime, r.Reading,
       p.LSLValue AS Lsl, p.USLValue AS Usl, p.LCLXBar AS LclXBar, p.UCLXBar AS UclXBar, r.QRCode AS QrCode";
        var order = distinctProcessCodesOnly ? "ORDER BY j.ProcessCode" : "ORDER BY ReadTime, r.SampleNo, r.ReadingSerialNo";
        var sql = $@"
{select}
FROM {db}.[JobReading] r
JOIN {db}.[Job] j ON j.JobSerialno = r.JobSerialno{lineJoin}
CROSS APPLY (SELECT TOP 1 jp.LSLValue, jp.USLValue, jp.LCLXBar, jp.UCLXBar FROM {db}.[JobParameter] jp
             WHERE jp.JobSerialno = r.JobSerialno
               AND jp.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT{lineParam}
               AND jp.Cp IS NOT NULL AND jp.Cpk IS NOT NULL) p
WHERE r.Reading IS NOT NULL
    AND EXISTS (SELECT 1 FROM {db}.[PartParameter] pp WHERE pp.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT)
    AND {where}
{order};";
        var args = new
        {
            rolePattern, codes, processCodes, cellPattern, from, to, dayFrom = from.Date, dayTo = to.Date
        };
        if (distinctProcessCodesOnly)
        {
            var list = await conn.QueryAsync<string>(sql, args, commandTimeout: _settings.QueryTimeoutSeconds);
            return list.Where(c => !string.IsNullOrWhiteSpace(c))
                .Select(c => new ReadingRow("", c.Trim(), default, 0, null, null, null, null, null)).ToList();
        }
        return (await conn.QueryAsync<ReadingRow>(sql, args, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
    }

    // Process-code dropdown: codes of the role read in the window (one parameter, or every SPC parameter for the
    // Report pop-up). SPC LIVE passes one day (fromDay = toDay).
    public async Task<List<string>> GetProcessCodesAsync(string machineName, string role, string? code, string? cell,
        DateTime fromDay, DateTime toDay)
    {
        var machine = Machine(machineName);
        if (!HasSource(machine)) return new List<string>();
        var (from, to) = Window(fromDay, toDay);
        await using var conn = new SqlConnection(_connectionString);
        var rows = await ReadingsAsync(conn, machine, string.IsNullOrWhiteSpace(code) ? null : new[] { code.Trim() },
            RolePattern(role), null, string.IsNullOrWhiteSpace(cell) ? null : CellPattern(cell), from, to, distinctProcessCodesOnly: true);
        return rows.Select(r => r.ProcessCode).Distinct(StringComparer.Ordinal).OrderBy(c => c, StringComparer.Ordinal).ToList();
    }

    private async Task<MachineShopSpcConstants?> ConstantsAsync(int sampleSize) =>
        sampleSize > 0 ? await _partParam.GetSpcConstantsAsync(sampleSize) : null;

    // ---- SPC LIVE (QualityFunctionChartOriginal / QualityTranspose) ----
    public async Task<MachineShopOccSpcLive> GetLiveAsync(string machineName, string code, string processCode, string? cell, DateTime day)
    {
        var machine = Machine(machineName);
        var (from, to) = Window(day, day);
        var result = new MachineShopOccSpcLive
        {
            Machine = machine.Name, Code = code, ProcessCode = processCode, Cell = string.IsNullOrWhiteSpace(cell) ? null : cell,
            From = from, To = to
        };
        var configured = (await _partParam.GetPageSettingsAsync()).SampleSize;
        result.Stats.SampleSize = configured > 0 ? configured : _spc.DefaultSampleSize;
        if (!HasSource(machine)) return result;

        await using var conn = new SqlConnection(_connectionString);
        result.Description = (await ParametersAsync(conn, machine)).FirstOrDefault(p => p.Code == code)?.Description ?? "";
        var rows = await ReadingsAsync(conn, machine, new[] { code }, "%", new[] { processCode },
            result.Cell == null ? null : CellPattern(result.Cell), from, to);
        result.Points = rows.Select(r => new MachineShopOccSpcLivePoint
        {
            Time = DateTime.SpecifyKind(r.ReadTime, DateTimeKind.Unspecified), Reading = r.Reading,
            Cl = r.LclXBar is double l && r.UclXBar is double u ? (l + u) / 2 : null
        }).ToList();
        if (rows.Count == 0) return result;

        // ThingWorx: X-double-bar = average reading, R-bar = max - min of all the day's readings, USL / LSL = averages.
        var k = await ConstantsAsync(result.Stats.SampleSize);
        var xbb = rows.Average(r => r.Reading);
        var rbar = rows.Max(r => r.Reading) - rows.Min(r => r.Reading);
        Fill(result.Stats, xbb, rbar, Avg(rows.Select(r => r.Lsl)), Avg(rows.Select(r => r.Usl)), k, lclrZero: true);
        return result;
    }

    private static double? Avg(IEnumerable<double?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return list.Count == 0 ? null : list.Average();
    }

    // Control limits and capability (ThingWorx calculateStaticSPCValuesForTag / QualityFunctionChartOriginal):
    // sigma = R-bar / d2; X-bar limits = X-double-bar -+ A2 x R-bar; R limits = D3 / D4 x R-bar; warning limits = X-double-bar -+ 2 sigma;
    // Cp = (USL - LSL) / 6 sigma; Cpk = min((X-double-bar - LSL) / 3 sigma, (USL - X-double-bar) / 3 sigma); both 0 when sigma = 0.
    private static void Fill(MachineShopOccSpcStats s, double xbb, double rbar, double? lsl, double? usl,
        MachineShopSpcConstants? k, bool lclrZero)
    {
        s.XDoubleBar = xbb;
        s.RBar = rbar;
        s.Lsl = lsl;
        s.Usl = usl;
        if (k == null || k.D2 == 0) return;
        var sd = rbar / k.D2;
        s.StdDev = sd;
        s.Lcl = xbb - k.A2 * rbar;
        s.Ucl = xbb + k.A2 * rbar;
        s.Lclr = lclrZero ? 0 : k.D3 * rbar;
        s.Uclr = k.D4 * rbar;
        s.Lwl = xbb - 2 * sd;
        s.Uwl = xbb + 2 * sd;
        if (lsl is double l && usl is double u)
        {
            s.Cp = sd != 0 ? (u - l) / (6 * sd) : 0;
            s.Cpk = sd != 0 ? Math.Min((xbb - l) / (3 * sd), (u - xbb) / (3 * sd)) : 0;
        }
    }

    // ---- SPC MONTHLY sub-groups (store7RandomValuesCoverLH, picked on request) ----

    // One sub-group per finished ShiftConfiguration shift with at least SubgroupSize readings (ThingWorx skipped
    // shifts with fewer); the readings are taken in a fixed pseudo-random order and listed X1..Xn by time.
    private List<MachineShopOccSpcSubgroup> Subgroups(IEnumerable<ReadingRow> rows, DateTime now)
    {
        var size = Math.Max(2, _spc.SubgroupSize);
        var windows = new Dictionary<DateTime, List<(string Shift, DateTime Start, DateTime End)>>();
        List<(string Shift, DateTime Start, DateTime End)> DayShifts(DateTime day)
        {
            if (!windows.TryGetValue(day, out var list))
            {
                list = _occ.ShiftNames().Select(s => { var (a, b) = _pdi.ShiftWindow(day, s); return (s, a, b); }).ToList();
                windows[day] = list;
            }
            return list;
        }

        var groups = new Dictionary<DateTime, (string Shift, DateTime End, List<ReadingRow> Rows)>();
        foreach (var r in rows)
        {
            (string Shift, DateTime Start, DateTime End)? hit = null;
            foreach (var day in new[] { r.ReadTime.Date, r.ReadTime.Date.AddDays(-1) })
            {
                foreach (var w in DayShifts(day))
                    if (r.ReadTime >= w.Start && r.ReadTime < w.End) { hit = w; break; }
                if (hit != null) break;
            }
            if (hit is not { } h) continue;
            if (!groups.TryGetValue(h.Start, out var g)) groups[h.Start] = g = (h.Shift, h.End, new List<ReadingRow>());
            g.Rows.Add(r);
        }

        var result = new List<MachineShopOccSpcSubgroup>();
        foreach (var (start, g) in groups.OrderBy(x => x.Key))
        {
            if (g.End > now || g.Rows.Count < size) continue;   // ThingWorx stored a shift at its end, only with >= 7 readings
            var seen = new Dictionary<string, int>();
            var picked = g.Rows
                .Select(r =>
                {
                    var key = $"{r.ReadTime:yyyyMMddHHmmss}|{r.Reading.ToString("R", CultureInfo.InvariantCulture)}|{r.QrCode}";
                    seen[key] = seen.TryGetValue(key, out var c) ? c + 1 : 1;
                    return (Row: r, Hash: Fnv($"{key}|{seen[key]}"));
                })
                .OrderBy(x => x.Hash).Take(size).Select(x => x.Row)
                .OrderBy(r => r.ReadTime).ToList();
            var xs = picked.Select(r => r.Reading).ToList();
            result.Add(new MachineShopOccSpcSubgroup
            {
                Date = DateTime.SpecifyKind(start, DateTimeKind.Unspecified), Shift = $"Shift {g.Shift}",
                Lsl = picked[0].Lsl, Usl = picked[0].Usl, X = xs, XBar = xs.Average(), Range = xs.Max() - xs.Min()
            });
        }
        return result;
    }

    private static ulong Fnv(string s)
    {
        var h = 14695981039346656037UL;
        foreach (var b in Encoding.UTF8.GetBytes(s)) { h ^= b; h *= 1099511628211UL; }
        return h;
    }

    // calculateStaticSPCValuesForTagWithData: averages of LSL, USL, XBar and Range over the sub-groups.
    private async Task<MachineShopOccSpcStats> SubgroupStatsAsync(IReadOnlyCollection<MachineShopOccSpcSubgroup> groups)
    {
        var stats = new MachineShopOccSpcStats { SampleSize = _spc.SubgroupSize };
        if (groups.Count == 0) return stats;
        var k = await ConstantsAsync(_spc.SubgroupSize);
        Fill(stats, groups.Average(g => g.XBar), groups.Average(g => g.Range),
            Avg(groups.Select(g => g.Lsl)), Avg(groups.Select(g => g.Usl)), k, lclrZero: false);
        return stats;
    }

    public async Task<MachineShopOccSpcMonthly> GetMonthlyAsync(string machineName, string cell, string role, string code,
        string processCode, DateTime fromDay, DateTime toDay)
    {
        var machine = Machine(machineName);
        var (from, to) = Window(fromDay, toDay);
        var result = new MachineShopOccSpcMonthly
        {
            Machine = machine.Name, Cell = cell, Role = role, Code = code, ProcessCode = processCode, From = from, To = to
        };
        result.Stats.SampleSize = _spc.SubgroupSize;
        if (!HasSource(machine) || !_occ.IsCellMachine(machine.Name)) return result;

        var now = DateTime.Now;
        await using var conn = new SqlConnection(_connectionString);
        result.Description = (await ParametersAsync(conn, machine)).FirstOrDefault(p => p.Code == code)?.Description ?? "";
        var readTo = to < now ? to : now;
        var rows = await ReadingsAsync(conn, machine, new[] { code }, RolePattern(role), new[] { processCode }, CellPattern(cell),
            from.AddDays(-Math.Max(0, _spc.RuleLookbackDays)), readTo);
        var all = Subgroups(rows, now);
        var inRange = all.Where(g => g.Date >= from && g.Date < to).ToList();
        result.Stats = await SubgroupStatsAsync(inRange);
        result.Readings = inRange.Count * _spc.SubgroupSize;

        // Nelson rules against the range's limits, each sub-group with up to 14 earlier ones (newest first).
        foreach (var g in inRange)
        {
            var index = all.IndexOf(g);
            var past = all.Take(index).Reverse().Take(14).Select(p => p.XBar).ToList();
            var rules = NelsonRules(g.XBar, past, result.Stats);
            g.Rule = rules.Count > 0;
            g.Remarks = RuleText(rules);
        }
        result.Subgroups = inRange;
        return result;
    }

    // Port of the rule block in store7RandomValuesCoverLH. Zones: SD1 / SD2 / SD3 = X-double-bar + 1/3, 2/3, 3/3 of
    // (UCL - X-double-bar), SD1m / SD2m / SD3m the same below. `past` = earlier sub-group XBars, newest first.
    //   1  beyond UCL / LCL                       5  this and the previous one beyond 2 sigma on the same side
    //   2  this + 8 before on one side of X-double-bar   6  this and the 3 before beyond 1 sigma on the same side
    //   3  6 in a row rising or falling            7  this and the 14 before within 1 sigma
    //   4  14 in a row alternating up and down     8  this and the 7 before outside 1 sigma (either side)
    private static List<int> NelsonRules(double x, List<double> past, MachineShopOccSpcStats s)
    {
        var rules = new List<int>();
        if (s.XDoubleBar is not double c || s.Ucl is not double ucl || s.Lcl is not double lcl) return rules;
        var sd1 = c + (ucl - c) / 3; var sd2 = c + (ucl - c) * 2 / 3;
        var sd1m = c - (c - lcl) / 3; var sd2m = c - (c - lcl) * 2 / 3;
        var n = past.Count;

        if (x > ucl || x < lcl) rules.Add(1);
        if (n >= 8 && x != c && past.Take(8).All(v => x > c ? v > c : v < c)) rules.Add(2);
        if (n >= 5)
        {
            var seq = new List<double> { x }; seq.AddRange(past.Take(5));   // newest first
            var falling = Enumerable.Range(0, 5).All(i => seq[i + 1] < seq[i]);   // older lower = rising over time
            var rising = Enumerable.Range(0, 5).All(i => seq[i + 1] > seq[i]);
            if (falling || rising) rules.Add(3);
        }
        if (n >= 13)
        {
            var seq = new List<double> { x }; seq.AddRange(past.Take(13));
            var diffs = Enumerable.Range(0, 13).Select(i => Math.Sign(seq[i] - seq[i + 1])).ToList();
            if (diffs.All(d => d != 0) && Enumerable.Range(1, 12).All(i => diffs[i] == -diffs[i - 1])) rules.Add(4);
        }
        if (n >= 1 && ((x > sd2 && past[0] > sd2) || (x < sd2m && past[0] < sd2m))) rules.Add(5);
        if (n >= 3 && ((x > sd1 && past.Take(3).All(v => v > sd1)) || (x < sd1m && past.Take(3).All(v => v < sd1m)))) rules.Add(6);
        if (n >= 14 && x < sd1 && x > sd1m && past.Take(14).All(v => v < sd1 && v > sd1m)) rules.Add(7);
        if (n >= 7 && (x > sd1 || x < sd1m) && past.Take(7).All(v => v > sd1 || v < sd1m)) rules.Add(8);
        return rules;
    }

    // ThingWorx remarks: "Rule 1 failed", "Rule 1 & 5 failed", "Rule 1, 2 & 5 failed"; "All Rules OK".
    private static string RuleText(List<int> rules)
    {
        if (rules.Count == 0) return "All Rules OK";
        var sb = new StringBuilder("Rule ").Append(rules[0]);
        for (var i = 1; i < rules.Count; i++) sb.Append(i != rules.Count - 1 ? ", " : " & ").Append(rules[i]);
        return sb.Append(" failed").ToString();
    }

    // ---- Report pop-up (generateSPCReport): every SPC parameter x the selected process codes ----
    public async Task<MachineShopOccSpcReport> GetReportAsync(string machineName, string cell, string role,
        IReadOnlyCollection<string> processCodes, DateTime fromDay, DateTime toDay)
    {
        var machine = Machine(machineName);
        var (from, to) = Window(fromDay, toDay);
        var result = new MachineShopOccSpcReport { Machine = machine.Name, Cell = cell, Role = role, From = from, To = to };
        if (!HasSource(machine) || !_occ.IsCellMachine(machine.Name) || processCodes.Count == 0) return result;

        var now = DateTime.Now;
        await using var conn = new SqlConnection(_connectionString);
        var parameters = await ParametersAsync(conn, machine);
        var rows = await ReadingsAsync(conn, machine, null, RolePattern(role), processCodes, CellPattern(cell), from, to < now ? to : now);
        var byKey = rows.GroupBy(r => (Code: r.Code.Trim(), Opn: r.ProcessCode.Trim())).ToDictionary(g => g.Key, g => g.ToList());
        var slNo = 1;
        foreach (var p in parameters)
            foreach (var opn in processCodes)
            {
                if (!byKey.TryGetValue((p.Code, opn), out var list)) continue;
                var groups = Subgroups(list, now).Where(g => g.Date >= from && g.Date < to).ToList();
                if (groups.Count == 0) continue;   // ThingWorx: only rows with readings
                var stats = await SubgroupStatsAsync(groups);
                var xs = groups.SelectMany(g => g.X).ToList();
                result.Rows.Add(new MachineShopOccSpcReportRow
                {
                    SlNo = slNo++, Parameter = p.Code, Description = p.Description, OperationNo = opn,
                    Lsl = stats.Lsl, Usl = stats.Usl, Cp = stats.Cp, Cpk = stats.Cpk, Lcl = stats.Lcl, Ucl = stats.Ucl,
                    XMax = xs.Max(), XMin = xs.Min(), XBar = stats.XDoubleBar, NoOfReadings = xs.Count
                });
            }
        return result;
    }
}
