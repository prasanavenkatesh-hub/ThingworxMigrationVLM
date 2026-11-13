using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace ControlTower.Services;

// Engine Station reports: Leak Station, PDI Station and Engine Test Bed (+ its Bed Wise view).
// Port of the "ThingWorx Migration Quality Reports Merge" MVC app (EngineAssemblyAPIController ->
// EngineAssemblyConfigRepository): read-only EXECUTEs of the FACTREPRDETL stored procedures
//   dbo.Get_EngineTestBed_EA0x_{OverAll|Distinct|Duplicates|FilterData}
//   dbo.Get_EngineLeak_Report_EA0x_{...}
//   dbo.Get_PDI_Report_EA0x_{...}
// (bodies in Sql/, ConnectionStrings:EngineStationConnection, settings EngineStationReports:*).
// As in the source: the line x mode picks the proc, each multi-select filter is passed comma-joined
// (NULL when nothing is selected), and the engine-number list is a TOP-n SELECT on the master table.
public class EngineStationReportService
{
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;

    public EngineStationReportService(IConfiguration configuration, IMemoryCache cache)
    {
        _configuration = configuration;
        _cache = cache;
    }

    private IConfigurationSection Settings => _configuration.GetSection("EngineStationReports");
    private int CommandTimeoutSeconds => Settings.GetValue("CommandTimeoutSeconds", 480);
    private int LookupTimeoutSeconds => Settings.GetValue("LookupTimeoutSeconds", 60);
    public int MaxRangeDays => Settings.GetValue("MaxRangeDays", 31);
    private int TopEngineNumbers => Settings.GetValue("TopEngineNumbers", 500);
    private int FilterCacheSeconds => Settings.GetValue("FilterCacheSeconds", 300);
    public int MaxFilterValues => Settings.GetValue("MaxFilterValues", 1000);
    public int MaxValueLength => Settings.GetValue("MaxValueLength", 200);

    // ---------------------------------------------------------------- validation

    // null = valid. from / to are server-local (ApiDateTime.ToLocal).
    public string? ValidateRange(DateTime? from, DateTime? to)
    {
        if (from == null || to == null) return "from and to are required date-times.";
        if (from >= to) return "from must be before to.";
        if ((to.Value - from.Value).TotalDays > MaxRangeDays) return $"Date range is limited to {MaxRangeDays} days.";
        return null;
    }

    // Validates the request filters against the report's whitelist and builds the proc argument per
    // filter key: values comma-joined, null when nothing is selected. null error = valid.
    public string? BuildFilterValues(EngineStationReportDef def, Dictionary<string, List<string?>?>? filters,
        out Dictionary<string, string?> joined)
    {
        joined = def.Filters.ToDictionary(f => f.Key, _ => (string?)null);
        if (filters == null) return null;

        foreach (var (key, values) in filters)
        {
            var f = def.Filters.FirstOrDefault(x => x.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
            if (f == null)
            {
                return $"Unknown filter '{key}' for {def.Key}. Allowed: {string.Join(", ", def.Filters.Select(x => x.Key))}.";
            }
            var list = (values ?? new List<string?>())
                .Select(v => v?.Trim())
                .Where(v => !string.IsNullOrEmpty(v))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (list.Count > MaxFilterValues)
            {
                return $"Filter '{f.Key}' has {list.Count} values; at most {MaxFilterValues} are allowed.";
            }
            foreach (var v in list)
            {
                if (v!.Contains(','))
                    return $"Filter '{f.Key}' value '{v}' contains a comma; the report splits values on commas.";
                if (v.Length > MaxValueLength)
                    return $"Filter '{f.Key}' has a value longer than {MaxValueLength} characters.";
            }
            if (list.Count == 0) continue;

            var value = string.Join(",", list);
            if (f.MaxLength > 0 && value.Length > f.MaxLength)
            {
                return $"Filter '{f.Key}': the selected values total {value.Length} characters, more than the {f.MaxLength} that {f.Parameter} accepts - select fewer values.";
            }
            joined[f.Key] = value;
        }
        return null;
    }

    // ---------------------------------------------------------------- data

    public async Task<EngineStationReportData> GetDataAsync(EngineStationReportDef def, string line, string mode,
        DateTime from, DateTime to, Dictionary<string, string?> filterValues, CancellationToken ct)
    {
        var procedure = def.DataProcedure(line, mode);
        var parameters = new DynamicParameters();
        parameters.Add("@FromDate", from, DbType.DateTime);
        parameters.Add("@ToDate", to, DbType.DateTime);
        foreach (var f in def.Filters)
        {
            parameters.Add(f.Parameter, filterValues.GetValueOrDefault(f.Key), DbType.String,
                ParameterDirection.Input, f.MaxLength);
        }

        var sw = Stopwatch.StartNew();
        await using var connection = new SqlConnection(ConnectionString());
        var rows = (await connection.QueryAsync(def.RowType, new CommandDefinition(
            procedure, parameters, commandType: CommandType.StoredProcedure,
            commandTimeout: CommandTimeoutSeconds, cancellationToken: ct))).ToList();
        sw.Stop();
        TrimStrings(def.RowType, rows);

        return new EngineStationReportData
        {
            Report = def.Key,
            Line = line,
            Mode = mode,
            Procedure = procedure,
            Notice = Notice(def, line),
            RowCount = rows.Count,
            DurationMs = sw.ElapsedMilliseconds,
            Rows = rows
        };
    }

    // ---------------------------------------------------------------- filter options

    // Runs the line's ..._FilterData proc and returns the distinct, trimmed, ordinal-sorted values per
    // filter key (the source's JS did [...new Set(...)].sort() per dropdown). Cached per range.
    public async Task<EngineStationFilterOptions> GetFilterOptionsAsync(EngineStationReportDef def, string line,
        DateTime from, DateTime to, CancellationToken ct)
    {
        var cacheKey = $"esr:filters:{def.Key}:{line}:{from:O}:{to:O}";
        if (!_cache.TryGetValue(cacheKey, out Dictionary<string, List<string>>? filters) || filters == null)
        {
            filters = await QueryFilterOptionsAsync(def, line, from, to, ct);
            _cache.Set(cacheKey, filters, TimeSpan.FromSeconds(FilterCacheSeconds));
        }

        var result = new EngineStationFilterOptions
        {
            Report = def.Key,
            Line = line,
            Filters = filters,
            Notice = Notice(def, line)
        };
        if (def == EngineStationReportDefinitions.TestBed)
        {
            var bedWise = Settings.GetSection("BedWise");
            result.BedWiseLine = bedWise.GetValue<string>("Line");
            result.Beds = bedWise.GetSection("Beds").GetChildren()
                .Where(c => !string.IsNullOrWhiteSpace(c.Value))
                .ToDictionary(c => c.Key, c => c.Value!);
        }
        return result;
    }

    private async Task<Dictionary<string, List<string>>> QueryFilterOptionsAsync(EngineStationReportDef def,
        string line, DateTime from, DateTime to, CancellationToken ct)
    {
        var columns = def.Filters.Where(f => f.FilterDataColumn != null).ToList();
        var sets = columns.ToDictionary(f => f.Key, _ => new HashSet<string>(StringComparer.Ordinal));

        var parameters = new DynamicParameters();
        parameters.Add("@FromDate", from, DbType.DateTime);
        parameters.Add("@ToDate", to, DbType.DateTime);

        await using var connection = new SqlConnection(ConnectionString());
        await using var reader = (DbDataReader)await connection.ExecuteReaderAsync(new CommandDefinition(
            def.FilterDataProcedure(line), parameters, commandType: CommandType.StoredProcedure,
            commandTimeout: LookupTimeoutSeconds, cancellationToken: ct));

        // Filter key -> result-set ordinal (a column missing from the proc just leaves its list empty).
        var ordinals = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < reader.FieldCount; i++) ordinals.TryAdd(reader.GetName(i), i);
        var map = new List<(string Key, int Ordinal)>();
        foreach (var f in columns)
        {
            if (ordinals.TryGetValue(f.FilterDataColumn!, out var ordinal)) map.Add((f.Key, ordinal));
        }

        while (await reader.ReadAsync(ct))
        {
            foreach (var (key, ordinal) in map)
            {
                if (reader.IsDBNull(ordinal)) continue;
                var s = Convert.ToString(reader.GetValue(ordinal), CultureInfo.InvariantCulture)?.Trim();
                if (!string.IsNullOrEmpty(s)) sets[key].Add(s);
            }
        }

        return sets.ToDictionary(kv => kv.Key, kv => kv.Value.OrderBy(v => v, StringComparer.Ordinal).ToList());
    }

    // ---------------------------------------------------------------- engine numbers

    // Port of SQLQueryConstants.fetchEngineNumber_{EALeak|PDI|ETR}: the latest TopEngineNumbers engine
    // numbers in the range, most recent first. Needs only SELECT. Test Bed's DATE column is NVARCHAR ISO
    // text, so its dates are bound as "yyyy-MM-dd HH:mm:ss" strings (a text comparison that stays
    // index-friendly); Leak / PDI bind real DATETIME values.
    public async Task<EngineStationEngineNumbers> GetEngineNumbersAsync(EngineStationReportDef def, string line,
        DateTime from, DateTime to, CancellationToken ct)
    {
        var cacheKey = $"esr:engines:{def.Key}:{line}:{from:O}:{to:O}";
        if (!_cache.TryGetValue(cacheKey, out List<string>? engines) || engines == null)
        {
            var table = def.MasterTables[line]; // whitelisted name
            var sql = $@"SELECT TOP (@Top) ENGINE_NUMBER
FROM dbo.[{table}] WITH (NOLOCK)
WHERE [DATE] BETWEEN @FromDate AND @ToDate AND ENGINE_NUMBER IS NOT NULL AND ENGINE_NUMBER <> ''
GROUP BY ENGINE_NUMBER
ORDER BY MAX([DATE]) DESC;";

            var parameters = new DynamicParameters();
            parameters.Add("@Top", TopEngineNumbers, DbType.Int32);
            if (def.DateIsText)
            {
                parameters.Add("@FromDate", from.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture), DbType.String, size: 19);
                parameters.Add("@ToDate", to.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture), DbType.String, size: 19);
            }
            else
            {
                parameters.Add("@FromDate", from, DbType.DateTime);
                parameters.Add("@ToDate", to, DbType.DateTime);
            }

            await using var connection = new SqlConnection(ConnectionString());
            engines = (await connection.QueryAsync<string>(new CommandDefinition(
                    sql, parameters, commandTimeout: LookupTimeoutSeconds, cancellationToken: ct)))
                .Where(e => !string.IsNullOrWhiteSpace(e))
                .Select(e => e.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToList();
            _cache.Set(cacheKey, engines, TimeSpan.FromSeconds(FilterCacheSeconds));
        }

        return new EngineStationEngineNumbers { Report = def.Key, Line = line, EngineNumbers = engines };
    }

    // ---------------------------------------------------------------- helpers

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Type, System.Reflection.PropertyInfo[]> StringProps = new();

    // The master tables hold space-padded text (e.g. DEFECT_DETAILS padded to 120 chars). Trim it so the
    // values equal the trimmed /filters options and Bed Wise groups identical defects together.
    private static void TrimStrings(Type rowType, List<object> rows)
    {
        var props = StringProps.GetOrAdd(rowType, t => t.GetProperties()
            .Where(p => p.PropertyType == typeof(string) && p.CanRead && p.CanWrite).ToArray());
        foreach (var row in rows)
        {
            foreach (var p in props)
            {
                if (p.GetValue(row) is string s && s.Length > 0 && (char.IsWhiteSpace(s[0]) || char.IsWhiteSpace(s[^1])))
                    p.SetValue(row, s.Trim());
            }
        }
    }

    private string ConnectionString()
    {
        var cs = _configuration.GetConnectionString("EngineStationConnection");
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException("ConnectionStrings:EngineStationConnection is not configured.");
        return cs;
    }

    private string? Notice(EngineStationReportDef def, string line)
    {
        if (def.NoticeSection == null) return null;
        var text = Settings.GetValue<string>($"{def.NoticeSection}:{line}");
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }
}
