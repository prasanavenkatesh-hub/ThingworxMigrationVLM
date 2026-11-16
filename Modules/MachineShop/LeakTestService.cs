using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace ControlTower.Services;

// Machine Shop > Leak Test (port of the ThingWorx Thing RE_MS_LeakTest_TH, mashups RE_MS_LT_CoverLH_MU,
// RE_MS_LT_CoverRH_MU, RE_MS_CylinderHead_MU, RE_MS_CylinderBarrel_MU, RE_MS_Crankshaft_MU, RE_MS_Crankcase_MU).
// Read-only: counts leak-test results in [MachineShop:Database].[dbo].[MachineShopData]
// (SharedDataConnection). A component = a set of Station_Number values + a cell count
// (MachineShop:LeakTest:Components; stations from the Thing's SQL services, e.g. Cover LH = 25 in
// Cell1_CoverLH_Count_*, Crankcase = 6/7 in AllCell_Crankcase_Count_Produced).
//
// Status classes (Cell*_CoverLH_Count_*, CellN_<Part>_Count_*): Produced = every row (incl. other values
// such as NA or 0/1/2 on Cylinder Head station 12), OK = OverallStation_Status 'OK', NOK = 'NOK' or
// 'NOTOK' (the collation is case-insensitive, so 'NOk' counts too).
//
// ThingWorx called one SQL service per cell / status / day / shift in loops; here one grouped query
// feeds the whole screen (plus one for the year trend), with an in-memory result cache.
// Differences from ThingWorx (on purpose):
//   - windows are half-open (>= start AND < end); ThingWorx used <= / BETWEEN, so a row stamped exactly
//     on a shift or bucket boundary was counted twice;
//   - a percentage with a 0 denominator is null (ThingWorx produced NaN / Infinity);
//   - reads use WITH (NOLOCK): the stations write to MachineShopData continuously and these
//     aggregate scans were picked as deadlock victims (SQL error 1205) - a count that includes an
//     uncommitted row is acceptable here. A 1205 that still happens is retried once.
public class LeakTestService
{
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;
    private readonly string _connectionString;
    private readonly string _database;      // MachineShop:Database
    private readonly int _timeoutSeconds;    // MachineShop:LeakTest:QueryTimeoutSeconds
    private readonly int _bucketStep, _bucketMax, _bucketCap;
    private readonly TimeSpan _historyCache, _todayCache, _yearCache;   // MachineShop:LeakTest:Cache

    public int MaxRangeDays { get; }

    public LeakTestService(IConfiguration configuration, IMemoryCache cache)
    {
        _configuration = configuration;
        _cache = cache;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _database = configuration["MachineShop:Database"] ?? "RE_VL_MachineShop";
        _timeoutSeconds = configuration.GetValue("MachineShop:LeakTest:QueryTimeoutSeconds", 120);
        MaxRangeDays = configuration.GetValue("MachineShop:LeakTest:MaxRangeDays", 93);
        _bucketStep = configuration.GetValue("MachineShop:LeakTest:LeakBuckets:Step", 10);
        _bucketMax = configuration.GetValue("MachineShop:LeakTest:LeakBuckets:Max", 300);
        _bucketCap = configuration.GetValue("MachineShop:LeakTest:LeakBuckets:Cap", 1000);
        _historyCache = TimeSpan.FromMinutes(configuration.GetValue("MachineShop:LeakTest:Cache:HistoryMinutes", 60));
        _todayCache = TimeSpan.FromSeconds(configuration.GetValue("MachineShop:LeakTest:Cache:TodaySeconds", 60));
        _yearCache = TimeSpan.FromMinutes(configuration.GetValue("MachineShop:LeakTest:Cache:YearTrendMinutes", 15));
    }

    public LeakTestComponentSettings? FindComponent(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        var c = _configuration.GetSection($"MachineShop:LeakTest:Components:{id}").Get<LeakTestComponentSettings>();
        if (c == null || c.Stations.Count == 0 || c.Cells <= 0) return null;
        c.Id = id;
        return c;
    }

    // Everything the screen loads for one date range (from / to = dates, inclusive). A range that ends
    // before today cannot change any more and is cached for Cache:HistoryMinutes; one that includes today
    // for Cache:TodaySeconds (absorbs repeated clicks / several viewers without hiding new rows for long).
    public Task<LeakTestData> GetDataAsync(LeakTestComponentSettings component, DateTime from, DateTime to)
    {
        var ttl = to.Date < DateTime.Today ? _historyCache : _todayCache;
        return Cached($"mlt:data:{component.Id}:{from:yyyyMMdd}:{to:yyyyMMdd}", ttl, () => LoadDataAsync(component, from, to));
    }

    // One scan feeds every widget (it replaced three queries: shift counts, daily counts, leak buckets).
    // Window: `from` 00:00 up to Shift A start of the day after `to` - the union of the production-day
    // window (shift grids: `from` Shift A -> `to`+1 Shift A) and the calendar-day window (summary, week
    // trend, leak chart: `from` 00:00 -> `to`+1 00:00). Rows are grouped by calendar day + time slot
    // (E = 00:00..Shift A start, i.e. Shift C of the previous production day; A; B; C) + cell + status
    // class; a second grouping set counts the leak buckets of the calendar-day rows.
    // Performance (measured on 10.130.1.73, Oct 2026): Cell_Number is NOT filtered in SQL - a Cell_Number
    // predicate made SQL Server full-scan the 865k-page barcode index (~8 s CPU per query) instead of
    // seeking pdi25092025 (Station_Number, OverallStation_Status, DateTime); cells outside 1..Cells are
    // dropped below. One month of Cover LH: ~0.3 s instead of ~2.2 s (26 s CPU) for the three old queries.
    private async Task<LeakTestData> LoadDataAsync(LeakTestComponentSettings component, DateTime from, DateTime to)
    {
        var a = ShiftStart("A");
        var sql = $@"
            SELECT D, Slot, Cell, Cls, B, GROUPING(B) AS GB, COUNT(*) AS N FROM (
                SELECT CAST(m.[DateTime] AS date) AS D,
                       CASE WHEN x.t < @AStart THEN 'E' WHEN x.t < @BStart THEN 'A' WHEN x.t < @CStart THEN 'B' ELSE 'C' END AS Slot,
                       m.Cell_Number AS Cell,
                       {StatusClassSql} AS Cls,
                       CASE WHEN m.[DateTime] < @DayEnd AND x.v >= 0 AND x.v <= @Cap
                            THEN CASE WHEN x.v < @Max THEN CAST(FLOOR(x.v / @Step) AS int) ELSE -1 END END AS B
                FROM [{_database}].[dbo].[MachineShopData] m WITH (NOLOCK)
                CROSS APPLY (SELECT CAST(m.[DateTime] AS time) AS t, TRY_CAST(m.IPV_1_Value AS float) AS v) x
                WHERE m.Station_Number IN @Stations
                  AND m.[DateTime] >= @From AND m.[DateTime] < @To
            ) q
            GROUP BY GROUPING SETS ((D, Slot, Cell, Cls), (B))";
        var p = Params(component, from.Date, to.Date.AddDays(1) + a);
        p.Add("AStart", a);
        p.Add("BStart", ShiftStart("B"));
        p.Add("CStart", ShiftStart("C"));
        p.Add("DayEnd", to.Date.AddDays(1));
        p.Add("Step", (double)_bucketStep);
        p.Add("Max", (double)_bucketMax);
        p.Add("Cap", (double)_bucketCap);

        var shiftCounts = new Dictionary<(string Shift, int Cell), Counts>();
        var daily = new Dictionary<DateTime, Counts>();
        var bucketCounts = new Dictionary<int, int>();
        foreach (var r in await QueryAsync<(DateTime? D, string? Slot, string? Cell, string? Cls, int? B, int GB, int N)>(sql, p))
        {
            if (r.GB == 0)                                    // leak-bucket grouping set (B NULL = not counted)
            {
                if (r.B.HasValue) bucketCounts[r.B.Value] = r.N;
                continue;
            }
            if (r.D == null || r.Slot == null || r.Cls == null) continue;
            if (!int.TryParse(r.Cell, out var cell) || cell < 1 || cell > component.Cells) continue;
            var day = r.D.Value;

            // Shift grids: production days from..to. Slot E of day D is Shift C of production day D-1.
            var productionDay = r.Slot == "E" ? day.AddDays(-1) : day;
            if (productionDay >= from.Date && productionDay <= to.Date)
            {
                var shift = r.Slot == "E" ? "C" : r.Slot;
                if (!shiftCounts.TryGetValue((shift, cell), out var sc)) shiftCounts[(shift, cell)] = sc = new Counts();
                sc.Add(r.Cls, r.N);
            }
            // Summary / week trend: calendar days from..to.
            if (day <= to.Date)
            {
                if (!daily.TryGetValue(day, out var dc)) daily[day] = dc = new Counts();
                dc.Add(r.Cls, r.N);
            }
        }

        var data = new LeakTestData { Cells = component.Cells, Leak = Buckets(bucketCounts) };

        // Shift grids (get_ShiftA/B/C_Count -> get_<Part>Data_ShiftX): Produced / OK / NOK; only the OK
        // row carries the shift label.
        var total = new Counts[component.Cells];
        for (var i = 0; i < component.Cells; i++) total[i] = new Counts();
        foreach (var shift in new[] { "A", "B", "C" })
        {
            var cells = Enumerable.Range(1, component.Cells)
                .Select(n => shiftCounts.TryGetValue((shift, n), out var c) ? c : new Counts()).ToArray();
            for (var i = 0; i < cells.Length; i++) total[i].Add(cells[i]);
            data.Shifts[shift] = new List<LeakTestGridRow>
            {
                CountRow(null, "Produced", cells, c => c.Produced),
                CountRow("Shift-" + shift, "OK", cells, c => c.Ok),
                CountRow(null, "NOK", cells, c => c.Nok)
            };
            data.Pies[shift] = PercentPie(Sum(cells));
        }

        // Totals grid (get_TotalValues): sums of the three shifts + OK % / NOK % of Produced.
        data.Totals = new List<LeakTestGridRow>
        {
            CountRow(null, "Total Produced", total, c => c.Produced),
            CountRow(null, "Total OK", total, c => c.Ok),
            CountRow(null, "Total NOK", total, c => c.Nok),
            PercentRow("Total OK %", total, c => c.Ok),
            PercentRow("Total NOK %", total, c => c.Nok)
        };
        var sum = Sum(total);
        data.Pies["total"] = PercentPie(sum);                       // getPercentPieChart(get_TotalValues)
        data.Pies["qty"] = new LeakTestPie { Ok = sum.Ok, Nok = sum.Nok }; // get_OKvsNOKQty

        // Summary pop-up (getOKNOKSummary -> get_Total_OK_NOK_Perday<Part>) and week trend
        // (get_OK/NOK_TrendForWeek): one row per calendar day; ProducedQty = OK + NOK, percentages of all
        // rows of the day.
        for (var d = from.Date; d <= to.Date; d = d.AddDays(1))
        {
            var c = daily.TryGetValue(d, out var v) ? v : new Counts();
            data.Summary.Add(new LeakTestSummaryRow
            {
                Date = d,
                ProducedQty = c.Ok + c.Nok,
                OkQty = c.Ok,
                OkPercent = Pct(c.Ok, c.Produced),
                NokQty = c.Nok,
                NokPercent = Pct(c.Nok, c.Produced)
            });
            data.Week.Ok.Add(new LeakTestTrendPoint { Date = d, Percentage = Math.Round(Pct(c.Ok, c.Produced)), Qty = c.Ok });
            data.Week.Nok.Add(new LeakTestTrendPoint { Date = d, Percentage = Math.Round(Pct(c.Nok, c.Produced)), Qty = c.Nok });
        }
        return data;
    }

    // get_OK/NOK_TrendForYear: one point per calendar month of the current financial year (1 April
    // onwards), Percentage = round(count * 100 / produced). Counts every cell of the component's stations
    // (ThingWorx summed Cell 1..6): no Cell_Number in SQL keeps this an index-only read of pdi25092025
    // (~0.3 s for 7 months of Cover LH instead of ~1.6 s / 9.6 s CPU). Cached for Cache:YearTrendMinutes.
    public Task<LeakTestTrend> GetYearTrendAsync(LeakTestComponentSettings component) =>
        Cached($"mlt:year:{component.Id}", _yearCache, () => LoadYearTrendAsync(component));

    private async Task<LeakTestTrend> LoadYearTrendAsync(LeakTestComponentSettings component)
    {
        var now = DateTime.Now;
        var fyStart = new DateTime(now.Month >= 4 ? now.Year : now.Year - 1, 4, 1);
        var sql = $@"
            SELECT YEAR([DateTime]) AS Y, MONTH([DateTime]) AS M, {StatusClassSql} AS Cls, COUNT(*) AS N
            FROM [{_database}].[dbo].[MachineShopData] WITH (NOLOCK)
            WHERE Station_Number IN @Stations
              AND [DateTime] >= @From AND [DateTime] < @To
            GROUP BY YEAR([DateTime]), MONTH([DateTime]), {StatusClassSql}";
        var rows = await QueryAsync<(int Y, int M, string Cls, int N)>(sql, Params(component, fyStart, now));
        var byMonth = new Dictionary<DateTime, Counts>();
        foreach (var r in rows)
        {
            var key = new DateTime(r.Y, r.M, 1);
            if (!byMonth.TryGetValue(key, out var c)) byMonth[key] = c = new Counts();
            c.Add(r.Cls, r.N);
        }

        var trend = new LeakTestTrend();
        for (var m = fyStart; m <= now; m = m.AddMonths(1))
        {
            var c = byMonth.TryGetValue(m, out var v) ? v : new Counts();
            trend.Ok.Add(new LeakTestTrendPoint { Date = m, Percentage = Math.Round(Pct(c.Ok, c.Produced)), Qty = c.Ok });
            trend.Nok.Add(new LeakTestTrendPoint { Date = m, Percentage = Math.Round(Pct(c.Nok, c.Produced)), Qty = c.Nok });
        }
        return trend;
    }

    // Leak value distribution (getLeakValueChart / getLeakValueData_<Part>): IPV_1_Value of the
    // component's stations, all cells, calendar days, Step-wide buckets 0..Max plus ">Max" up to Cap.
    // Non-numeric values (Crankcase / Cylinder Head log text such as "PRESSU", "-106 P") and negatives
    // are skipped. ThingWorx bug not copied: RE_MS_CylinderHead_MU and RE_MS_CylinderBarrel_MU called
    // getLeakValueChart without MachineDesc, so they showed the Cover LH (station 25) distribution.
    private List<LeakTestBucket> Buckets(Dictionary<int, int> counts)
    {
        var buckets = new List<LeakTestBucket>();
        for (var low = 0; low < _bucketMax; low += _bucketStep)
            buckets.Add(new LeakTestBucket { LeakValue = $"{low}-{low + _bucketStep}", Count = counts.GetValueOrDefault(low / _bucketStep) });
        buckets.Add(new LeakTestBucket { LeakValue = $">{_bucketMax}", Count = counts.GetValueOrDefault(-1) });
        return buckets;
    }

    // Results are immutable once built, so cached instances are shared between requests.
    private async Task<T> Cached<T>(string key, TimeSpan ttl, Func<Task<T>> load) where T : class
    {
        if (ttl <= TimeSpan.Zero) return await load();
        if (_cache.TryGetValue(key, out T? hit) && hit != null) return hit;
        var value = await load();
        _cache.Set(key, value, ttl);
        return value;
    }

    private const string StatusClassSql =
        "CASE WHEN OverallStation_Status = 'OK' THEN 'O' WHEN OverallStation_Status IN ('NOK', 'NOTOK') THEN 'N' ELSE 'X' END";

    private static DynamicParameters Params(LeakTestComponentSettings component, DateTime from, DateTime to)
    {
        var p = new DynamicParameters();
        p.Add("Stations", component.Stations);
        p.Add("From", from);
        p.Add("To", to);
        return p;
    }

    private async Task<IEnumerable<T>> QueryAsync<T>(string sql, DynamicParameters p)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var connection = new SqlConnection(_connectionString);
                return await connection.QueryAsync<T>(sql, p, commandTimeout: _timeoutSeconds);
            }
            catch (SqlException ex) when (ex.Number == 1205 && attempt < 2)
            {
                // deadlock victim - retry once
            }
        }
    }

    private TimeSpan ShiftStart(string shift) =>
        TimeSpan.TryParse(_configuration[$"ShiftConfiguration:Shifts:{shift}:Start"], out var t)
            ? t
            : shift switch { "B" => new TimeSpan(7, 15, 0), "C" => new TimeSpan(15, 45, 0), _ => new TimeSpan(0, 15, 0) };

    private static double Pct(int part, int whole) => whole > 0 ? part * 100.0 / whole : 0;

    private static LeakTestPie PercentPie(Counts c) =>
        new() { Ok = Pct(c.Ok, c.Produced), Nok = Pct(c.Nok, c.Produced) };

    private static Counts Sum(IEnumerable<Counts> cells)
    {
        var s = new Counts();
        foreach (var c in cells) s.Add(c);
        return s;
    }

    private static LeakTestGridRow CountRow(string? shift, string description, Counts[] cells, Func<Counts, int> pick) => new()
    {
        Shift = shift,
        Description = description,
        Cells = cells.Select(c => (double?)pick(c)).ToList(),
        Total = cells.Sum(pick)
    };

    private static LeakTestGridRow PercentRow(string description, Counts[] cells, Func<Counts, int> pick)
    {
        static double? P(int part, int whole) => whole > 0 ? part * 100.0 / whole : null;
        var sum = Sum(cells);
        return new LeakTestGridRow
        {
            Description = description,
            Cells = cells.Select(c => P(pick(c), c.Produced)).ToList(),
            Total = P(pick(sum), sum.Produced)
        };
    }

    private class Counts
    {
        public int Produced, Ok, Nok;

        public void Add(string cls, int n)
        {
            Produced += n;
            if (cls == "O") Ok += n;
            else if (cls == "N") Nok += n;
        }

        public void Add(Counts c)
        {
            Produced += c.Produced;
            Ok += c.Ok;
            Nok += c.Nok;
        }
    }
}
