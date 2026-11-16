using System.Globalization;
using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > Online Control Charts, CELL and OPERATION views (SPC views: MachineShopControlChartsSpcService).
// CELL: port of the ThingWorx mashup RE_Crank_case_Dashboard_MU
// ("CELL LEVEL DASHBOARD", cards RE_Crank_case_Loader_MU) and its Things:
//   RE_Machine_name_DT (machine tabs)               -> MachineShop:ControlCharts:Machines
//   RE_Crank_case_TH.getMachinePercentageData       -> GetCellAsync (range) +
//     getLHpercentageByDate (Crank Case LH) / getCoverLHPercentageByDate (Cover LH) -> CardsAsync
//   RE_CrankCase_Helper_DB_TH SQL services:
//     SQLOPComponentList[CoverLH]      Operator components = distinct JobReading.QRCode read in the range
//     SQLINSPComponentList[CoverLH]    Inspector components = distinct JobReading.BatchNo read in the range on a
//                                      Job.MachineNo LIKE '%QF%', OPERATOR in Users, code in PartParameter / JobParameter
//     SQLgetStatic{OPE,INSP}[Non]Critical...   required parameters = distinct CriticalPartParameter codes with
//                                      Operator / Inspector = 1 and CriticalParameter = 1 / 0
//     SQLget{OP,IN}...{Non}Critical...  parameters read for a component = distinct JobReading codes of that QRCode /
//                                      BatchNo (any date, as ThingWorx) that are required
//     SQLget{OP,QF}...BarCode          chart x = first reading of the component in the range
//   RE_Crank_case_TH.noncritcal (NON CRITICAL tab) -> Part Parameter Config setting NonCritical
// Card % = parameters read / (required x components) x 100, max 100; chart point = read / required x 100.
// Differences from ThingWorx (see README):
//   - THIS SHIFT / TODAY / CUSTOM use ShiftConfiguration: the shift running now, the production day so far (first
//     shift start .. now) and one whole production day. ThingWorx: hard-coded shift times (empty 00:00-00:15),
//     calendar day 00:00 .. now and calendar day 00:00 .. 23:59:59.
//   - Three set-based queries per card instead of three queries per component; components with a NULL BatchNo /
//     QRCode are skipped (ThingWorx failed on them).
public class MachineShopControlChartsService
{
    private static readonly Regex SafeDatabase = new(@"^[A-Za-z0-9_\- ]{1,128}$", RegexOptions.Compiled);

    public const string RangeShift = "shift";
    public const string RangeToday = "today";
    public const string RangeCustom = "custom";

    private readonly MachineShopSettings _settings;
    private readonly MachineShopControlChartsSettings _cc;
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly MachineShopPdiService _pdi;
    private readonly MachineShopPartParamService _partParam;

    public MachineShopControlChartsService(IConfiguration configuration, MachineShopPdiService pdi, MachineShopPartParamService partParam)
    {
        _configuration = configuration;
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _cc = _settings.ControlCharts;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _pdi = pdi;
        _partParam = partParam;
    }

    public MachineShopOccOptions GetOptions() => new()
    {
        Machines = _cc.Machines.Select(m => new MachineShopOccMachine(m.Name, !string.IsNullOrWhiteSpace(m.Database))).ToList(),
        CustomDefaultDaysBack = _cc.CustomDefaultDaysBack
    };

    public bool HasMachine(string name) => FindMachine(name) != null;

    public bool IsCellMachine(string name) =>
        _cc.CellMachines.Any(m => string.Equals(m, name?.Trim(), StringComparison.OrdinalIgnoreCase));

    public MachineShopPartParamMachine? FindMachine(string name) =>
        _cc.Machines.FirstOrDefault(m => string.Equals(m.Name, name?.Trim(), StringComparison.OrdinalIgnoreCase));

    public List<string> ShiftNames() =>
        _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key).ToList();

    // Production day window: first shift start .. last shift end (ShiftConfiguration order).
    public (DateTime Start, DateTime End) DayWindow(DateTime day)
    {
        var shifts = ShiftNames();
        return (_pdi.ShiftWindow(day, shifts[0]).Start, _pdi.ShiftWindow(day, shifts[^1]).End);
    }

    // The ShiftConfiguration shift running at `now` (a shift that wraps past midnight belongs to the day it started).
    public (string Shift, DateTime Start, DateTime End)? CurrentShift(DateTime now)
    {
        foreach (var day in new[] { now.Date, now.Date.AddDays(-1) })
            foreach (var shift in ShiftNames())
            {
                var (start, end) = _pdi.ShiftWindow(day, shift);
                if (now >= start && now < end) return (shift, start, end);
            }
        return null;
    }

    // range: shift | today | custom (custom needs `day`). Times are plain server-local (no offset in the JSON).
    private (string? Shift, DateTime From, DateTime To) ResolveRange(string range, DateTime? day, DateTime now)
    {
        string? shift = null;
        DateTime from, to;
        switch (range)
        {
            case RangeShift:
                var current = CurrentShift(now);
                if (current is { } c) { shift = c.Shift; from = c.Start; to = c.End; }
                else { from = now; to = now; }
                break;
            case RangeToday:
                // Production day so far: 00:00-00:14 still belongs to yesterday's production day.
                var dayStart = DayWindow(now.Date).Start;
                from = now >= dayStart ? dayStart : DayWindow(now.Date.AddDays(-1)).Start;
                to = now;
                break;
            case RangeCustom:
                (from, to) = DayWindow((day ?? now).Date);
                break;
            default:
                throw new ArgumentException($"Unknown range '{range}'.");
        }
        return (shift, DateTime.SpecifyKind(from, DateTimeKind.Unspecified), DateTime.SpecifyKind(to, DateTimeKind.Unspecified));
    }

    public async Task<MachineShopOccCell> GetCellAsync(string machineName, string range, DateTime? day)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        var now = DateTime.Now;
        var result = new MachineShopOccCell
        {
            Machine = machine.Name, HasSource = !string.IsNullOrWhiteSpace(machine.Database), Range = range,
            UpdatedAt = DateTime.SpecifyKind(now, DateTimeKind.Unspecified)
        };
        (result.Shift, result.From, result.To) = ResolveRange(range, day, now);

        result.NonCriticalTab = (await _partParam.GetPageSettingsAsync()).NonCritical;
        if (!result.HasSource || result.To <= result.From)
        {
            result.Cards = new List<MachineShopOccCard> { new() { Name = "Operator" }, new() { Name = "Inspector" } };
            return result;
        }

        await using var conn = new SqlConnection(_connectionString);
        result.Cards = new List<MachineShopOccCard>
        {
            await CardAsync(conn, machine.Database.Trim(), inspector: false, result.From, result.To),
            await CardAsync(conn, machine.Database.Trim(), inspector: true, result.From, result.To)
        };
        return result;
    }

    private record ComponentRow(string Component, DateTime FirstRead, int Crit, int NonCrit);

    private async Task<MachineShopOccCard> CardAsync(SqlConnection conn, string database, bool inspector, DateTime from, DateTime to)
    {
        var db = $"[{Checked(database)}].[dbo]";
        var users = $"[{Checked(_cc.UsersDatabase)}].[dbo].[{Checked(_cc.UsersTable)}]";
        var role = inspector ? "Inspector" : "Operator";
        var key = inspector ? "BatchNo" : "QRCode";
        // Reading time as ThingWorx built it; the ReadingDate pre-filter lets SQL Server use the (QRCode, ReadingDate) index.
        const string readTime = "(CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME))";
        const string inRange = "r.ReadingDate >= @dayFrom AND r.ReadingDate <= @dayTo AND " + readTime + " BETWEEN @from AND @to";
        // Components + their first reading in the range, in one pass over the range. Inspector: a BatchNo counts when at
        // least one of its readings in the range passes the ThingWorx joins (QF machine, OPERATOR in Users, code in
        // PartParameter / JobParameter, any CriticalPartParameter row); its first reading is over all its readings
        // in the range (SQLgetQFCrankLHBarCode).
        var componentSql = inspector
            ? $@"SELECT x.BatchNo, MIN(x.ReadTime)
    FROM (
        SELECT r.BatchNo, {readTime} AS ReadTime,
            CASE WHEN j.MachineNo LIKE @pattern
                AND EXISTS (SELECT 1 FROM {users} u WHERE u.UserCode COLLATE DATABASE_DEFAULT = r.OPERATOR COLLATE DATABASE_DEFAULT)
                AND EXISTS (SELECT 1 FROM {db}.[PartParameter] pp WHERE pp.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT)
                AND EXISTS (SELECT 1 FROM {db}.[JobParameter] jp WHERE jp.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT)
                AND EXISTS (SELECT 1 FROM {db}.[CriticalPartParameter]) THEN 1 ELSE 0 END AS Qualifies
        FROM {db}.[JobReading] r LEFT JOIN {db}.[Job] j ON j.JobSerialno = r.JobSerialno
        WHERE r.BatchNo IS NOT NULL AND {inRange}) x
    GROUP BY x.BatchNo
    HAVING MAX(x.Qualifies) = 1"
            : $@"SELECT r.QRCode, MIN({readTime})
    FROM {db}.[JobReading] r
    WHERE r.QRCode IS NOT NULL AND {inRange}
    GROUP BY r.QRCode";

        // Table variable (factreread cannot create tables in tempdb). Parameters read per component: any date, as ThingWorx.
        var sql = $@"
SET NOCOUNT ON;
SELECT
  (SELECT COUNT(DISTINCT PartParaCode) FROM {db}.[CriticalPartParameter] WHERE CriticalParameter = 1 AND [{role}] = 1),
  (SELECT COUNT(DISTINCT PartParaCode) FROM {db}.[CriticalPartParameter] WHERE CriticalParameter = 0 AND [{role}] = 1);

DECLARE @c TABLE (Component nvarchar(200) COLLATE DATABASE_DEFAULT PRIMARY KEY, FirstRead datetime);
INSERT INTO @c (Component, FirstRead)
{componentSql};

WITH hits AS (
    SELECT r.[{key}] AS Component, p.CriticalParameter AS Crit, COUNT(DISTINCT r.PartParaCode) AS N
    FROM {db}.[JobReading] r
    JOIN @c c ON c.Component = r.[{key}] COLLATE DATABASE_DEFAULT
    JOIN {db}.[CriticalPartParameter] p ON p.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT
    WHERE p.[{role}] = 1 AND p.CriticalParameter IS NOT NULL
    GROUP BY r.[{key}], p.CriticalParameter)
SELECT c.Component, c.FirstRead,
       ISNULL(MAX(CASE WHEN h.Crit = 1 THEN h.N END), 0) AS Crit,
       ISNULL(MAX(CASE WHEN h.Crit = 0 THEN h.N END), 0) AS NonCrit
FROM @c c LEFT JOIN hits h ON h.Component COLLATE DATABASE_DEFAULT = c.Component
GROUP BY c.Component, c.FirstRead
ORDER BY c.FirstRead;";

        using var grid = await conn.QueryMultipleAsync(sql, new
        {
            from, to, dayFrom = from.Date, dayTo = to.Date, pattern = _cc.InspectorMachinePattern
        }, commandTimeout: _settings.QueryTimeoutSeconds);
        var (requiredCrit, requiredNonCrit) = await grid.ReadSingleAsync<(int, int)>();
        var rows = (await grid.ReadAsync<ComponentRow>()).ToList();

        return new MachineShopOccCard
        {
            Name = role,
            Components = rows.Count,
            Critical = Series(rows, requiredCrit, r => r.Crit),
            NonCritical = Series(rows, requiredNonCrit, r => r.NonCrit)
        };
    }

    // ThingWorx: % = sum read / (required x components) x 100, 100 when above; 0 when nothing was read.
    private static MachineShopOccSeries Series(List<ComponentRow> rows, int required, Func<ComponentRow, int> read)
    {
        var total = rows.Sum(read);
        var possible = required * rows.Count;
        return new MachineShopOccSeries
        {
            RequiredParameters = required,
            ReadParameters = total,
            Percentage = total > 0 && possible > 0 ? Math.Round(Math.Min(100.0, 100.0 * total / possible), 2) : 0,
            Points = rows.Select(r => new MachineShopOccPoint
            {
                Component = r.Component,
                ReadingDate = r.FirstRead,
                ReadingPercentage = required > 0 ? Math.Round(100.0 * read(r) / required, 2) : null
            }).ToList()
        };
    }

    // ---- OPERATION (ThingWorx RE_Crank_case_TH.getCELLPercentageData -> getCellCoverLHPercentageByDate) ----
    // Per cell and role: NOK readings (Reading > USL or < LSL of the reading's JobParameter) x 100 / all readings of the
    // role (Operator: Job.ProcessCode LIKE 'OPN%', Inspector: 'QF%'), split by CriticalPartParameter.CriticalParameter
    // (CRITICAL / NON CRITICAL tab); chips = each process code's share of the NOK readings (first MaxProcessCodes, by
    // process code). Differences from ThingWorx (see README):
    //   - ShiftConfiguration windows (as CELL).
    //   - Job and JobParameter are matched on JobSerialno AND LineName, and one JobParameter row per reading is used:
    //     job numbers repeat across the two cells and JobParameter holds identical duplicate rows, so ThingWorx counted
    //     NOK readings up to 3 times.
    //   - Crank Case LH has no cell column: ThingWorx showed its machine-wide getCELLLHpercentageByDate figures in every
    //     cell; here the machine says "no cell data" (HasCells = false). Machines without a source stay empty (as ThingWorx).
    public async Task<MachineShopOccOperation> GetOperationAsync(string machineName, string range, DateTime? day)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        var now = DateTime.Now;
        var op = _cc.Operation;
        var result = new MachineShopOccOperation
        {
            Machine = machine.Name, HasSource = !string.IsNullOrWhiteSpace(machine.Database), HasCells = IsCellMachine(machine.Name),
            Range = range, UpdatedAt = DateTime.SpecifyKind(now, DateTimeKind.Unspecified)
        };
        (result.Shift, result.From, result.To) = ResolveRange(range, day, now);
        result.NonCriticalTab = (await _partParam.GetPageSettingsAsync()).NonCritical;

        var totals = new List<(string Line, string Role, int N)>();
        var noks = new List<(string Line, string Role, string ProcessCode, bool Crit, int N)>();
        if (result.HasSource && result.HasCells && result.To > result.From)
        {
            var db = $"[{Checked(machine.Database.Trim())}].[dbo]";
            const string readTime = "(CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME))";
            const string role = "CASE WHEN j.ProcessCode LIKE @opPattern THEN 'O' ELSE 'I' END";
            var from = $@"FROM {db}.[JobReading] r
    JOIN {db}.[Job] j ON j.JobSerialno = r.JobSerialno AND j.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT";
            var where = $@"WHERE (j.ProcessCode LIKE @opPattern OR j.ProcessCode LIKE @inPattern)
    AND r.ReadingDate >= @dayFrom AND r.ReadingDate <= @dayTo AND {readTime} BETWEEN @from AND @to";
            var sql = $@"
SELECT r.LineName AS Line, {role} AS Role, COUNT(*) AS N
{from}
{where}
GROUP BY r.LineName, {role};

SELECT r.LineName AS Line, {role} AS Role, j.ProcessCode, c.CriticalParameter AS Crit, COUNT(*) AS N
{from}
    JOIN {db}.[CriticalPartParameter] c ON c.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT
    CROSS APPLY (SELECT TOP 1 jp.LSLValue, jp.USLValue FROM {db}.[JobParameter] jp
                 WHERE jp.JobSerialno = r.JobSerialno
                   AND jp.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT
                   AND jp.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT) p
{where}
    AND c.CriticalParameter IS NOT NULL AND (r.Reading > p.USLValue OR r.Reading < p.LSLValue)
GROUP BY r.LineName, {role}, j.ProcessCode, c.CriticalParameter;";
            await using var conn = new SqlConnection(_connectionString);
            using var grid = await conn.QueryMultipleAsync(sql, new
            {
                from = result.From, to = result.To, dayFrom = result.From.Date, dayTo = result.To.Date,
                opPattern = op.OperatorProcessPattern, inPattern = op.InspectorProcessPattern
            }, commandTimeout: _settings.QueryTimeoutSeconds);
            totals = (await grid.ReadAsync<(string, string, int)>()).ToList();
            noks = (await grid.ReadAsync<(string, string, string, bool, int)>()).ToList();
        }

        for (var n = 1; n <= Math.Max(1, op.CellCount); n++)
        {
            var linePattern = SqlLike(string.Format(CultureInfo.InvariantCulture, _cc.CellLinePattern, n));
            var cell = new MachineShopOccOpCell { Name = $"CELL {n}" };
            foreach (var (code, name) in new[] { ("O", "OPERATOR"), ("I", "INSPECTOR") })
            {
                var readings = totals.Where(t => t.Role == code && linePattern.IsMatch(t.Line ?? "")).Sum(t => t.N);
                var rows = noks.Where(x => x.Role == code && linePattern.IsMatch(x.Line ?? "")).ToList();
                cell.Cards.Add(new MachineShopOccOpCard
                {
                    Name = name, Readings = readings,
                    Critical = OpSeries(rows.Where(x => x.Crit), readings, op.MaxProcessCodes),
                    NonCritical = OpSeries(rows.Where(x => !x.Crit), readings, op.MaxProcessCodes)
                });
            }
            result.Cells.Add(cell);
        }
        return result;
    }

    private static MachineShopOccOpSeries OpSeries(IEnumerable<(string Line, string Role, string ProcessCode, bool Crit, int N)> rows,
        int readings, int maxChips)
    {
        var byCode = rows.GroupBy(x => x.ProcessCode ?? "").Select(g => (Code: g.Key, N: g.Sum(x => x.N)))
            .OrderBy(x => x.Code, StringComparer.Ordinal).ToList();
        var nok = byCode.Sum(x => x.N);
        return new MachineShopOccOpSeries
        {
            NokReadings = nok,
            // ThingWorx: Math.round(x * 100) / 100 of NOK x 100 / readings (NaN when nothing was read -> 0 here).
            Percentage = readings > 0 ? Math.Round(100.0 * nok / readings, 2, MidpointRounding.AwayFromZero) : 0,
            Chips = byCode.Take(Math.Max(0, maxChips)).Select(x => new MachineShopOccOpChip
            {
                ProcessCode = x.Code, NokReadings = x.N,
                Share = nok > 0 ? (int)Math.Round(100.0 * x.N / nok, MidpointRounding.AwayFromZero) : 0
            }).ToList()
        };
    }

    // SQL LIKE pattern (%, _, [..]) -> anchored, case-insensitive regex (to sort LineName values into cells).
    public static Regex SqlLike(string pattern)
    {
        var sb = new System.Text.StringBuilder("^");
        for (var i = 0; i < pattern.Length; i++)
        {
            var ch = pattern[i];
            if (ch == '%') sb.Append(".*");
            else if (ch == '_') sb.Append('.');
            else if (ch == '[')
            {
                var close = pattern.IndexOf(']', i + 1);
                if (close < 0) { sb.Append(Regex.Escape("[")); continue; }
                sb.Append('[').Append(pattern.Substring(i + 1, close - i - 1).Replace("\\", "\\\\")).Append(']');
                i = close;
            }
            else sb.Append(Regex.Escape(ch.ToString()));
        }
        return new Regex(sb.Append('$').ToString(), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    public static string Checked(string name) =>
        SafeDatabase.IsMatch(name ?? "") ? name! : throw new InvalidOperationException($"Invalid database / table name '{name}'.");
}
