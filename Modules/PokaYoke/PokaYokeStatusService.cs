using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Live Poka Yoke station status (sidebar PokaYoke > JEA1 Line ...). Port of the ThingWorx service
// RE_JEA2_MSSQL_POKEYOKE_DB_TH.getPokeYokeLiveStatusForIndivisualStationForJEA1 (+ its tag list
// RE_JEA2_PostgresPokeYoke_DB.GetTagEntriesForOverallPokeYokeV2 and cache getJEA1PokeYokeData).
// JEA2 Line (PokaYoke:Lines:jea2) is the same logic: getPokeYokeLiveStatusForIndivisualStationForJEA2
// (+ GetTagEntriesForOverallPokeYokeJEA2V2, getJEA2PokeYokeData). The "JEA2" in the ThingWorx Thing names
// is only their name - they hold the services of both lines; each line has its own tag master and
// tables in its config entry.
//   1. Tag list: active Poka Yoke checkpoints of the line from the tag master
//      (PokeYokeCheckPoints = 'YES', FromDate <= now < ToDate), minus ExcludedHistoryCards / ExcludedStations.
//   2. Each checkpoint's value = its tag column in the LATEST record of the station's table
//      (latest with status OK where the table has a status column - see PokaYokeSourceSettings).
//   3. Per station: MI = checkpoints whose value is in MiValues (BYPASSED; gear train OFF),
//      OK = checkpoints with any other value; empty / "NA" values are skipped.
// So the counts are a live snapshot of the station's checkpoints on its last good engine, not
// engine counts over a period.
//
// Differences from ThingWorx (bugs there, not ported): its fixed per-station variables mapped
// several results to the wrong station (ML-13 <- ML-14, ML-19 / SA-40 / SA-41 <- ML-10, RW-02/03
// <- RW-04, OK_SA_13 <- NOK_SA_13), TB-QA1/2 OK always failed (OKTB_QA1 typo), SA-41 was never
// counted, and a checkpoint in an unlisted table reused the previous checkpoint's value. Here every
// station is counted by the same loop, and unlisted tables are reported, not read.
//
// Read-only. One SELECT TOP 1 per (table, station) fetches all of that station's tag columns
// (ThingWorx ran one query per tag). Table / column names come from the tag master, so only
// tables listed in Sources are queried and every name is validated before it is put in SQL.
// Results are cached per line for PokaYoke:RefreshSeconds; a refresh happens on the first request
// after that (nothing is queried while no one has the screen open).
public class PokaYokeStatusService
{
    // Database / schema / table / config column names.
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_\- ]{1,128}$", RegexOptions.Compiled);
    // Tag (column) names from the tag master, e.g. "SA12 LH CO/S BRG DEPTH (mm)": always used inside
    // [brackets], where only ']' (and control characters) could break out.
    private static readonly Regex SafeColumn = new(@"^[^\]\[\x00-\x1F]{1,128}$", RegexOptions.Compiled);

    private readonly PokaYokeSettings _settings;
    private readonly string _connectionString;
    private readonly ILogger<PokaYokeStatusService> _logger;
    private readonly Dictionary<string, SemaphoreSlim> _gates = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, PokaYokeLineStatus> _cache = new(StringComparer.OrdinalIgnoreCase);

    public PokaYokeStatusService(IConfiguration configuration, ILogger<PokaYokeStatusService> logger)
    {
        _settings = configuration.GetSection("PokaYoke").Get<PokaYokeSettings>() ?? new PokaYokeSettings();
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _logger = logger;
        foreach (var key in _settings.Lines.Keys) _gates[key] = new SemaphoreSlim(1, 1);
    }

    public bool HasLine(string line) => _settings.Lines.ContainsKey(line);

    // Cached snapshot. The first request waits for the first refresh; after that a stale snapshot
    // is returned at once and refreshed in the background (one refresh per line at a time).
    public async Task<PokaYokeLineStatus> GetStatusAsync(string line)
    {
        PokaYokeLineStatus? cached;
        lock (_cache) _cache.TryGetValue(line, out cached);
        if (cached == null) return await RefreshLineAsync(line);
        if (DateTime.Now - cached.UpdatedAt >= TimeSpan.FromSeconds(_settings.RefreshSeconds) && _gates[line].CurrentCount > 0)
            _ = Task.Run(() => RefreshLineAsync(line));
        return cached;
    }

    private async Task<PokaYokeLineStatus> RefreshLineAsync(string line)
    {
        var gate = _gates[line];
        await gate.WaitAsync();
        try
        {
            PokaYokeLineStatus? cached;
            lock (_cache) _cache.TryGetValue(line, out cached);
            if (cached != null && DateTime.Now - cached.UpdatedAt < TimeSpan.FromSeconds(_settings.RefreshSeconds))
                return cached;   // refreshed while this call waited

            var fresh = await RefreshAsync(line, _settings.Lines[line]);
            lock (_cache) _cache[line] = fresh;
            return fresh;
        }
        finally
        {
            gate.Release();
        }
    }

    // One station's checkpoints from the current snapshot (null when the line has no data yet).
    public async Task<PokaYokeStationDetail> GetStationAsync(string line, string station)
    {
        var status = await GetStatusAsync(line);
        status.Details.TryGetValue(station, out var checkpoints);
        status.Stations.TryGetValue(station, out var count);
        return new PokaYokeStationDetail
        {
            Line = line,
            Station = station,
            UpdatedAt = status.UpdatedAt,
            Ok = count?.Ok ?? 0,
            Mi = count?.Mi ?? 0,
            Checkpoints = checkpoints ?? new List<PokaYokeCheckpoint>(),
            Error = status.Error
        };
    }

    // Summary pop-up: the checkpoints of every station counted in Total, filtered by status
    // ("OK", "MI", or anything else = all), ordered by station then tag order.
    public async Task<PokaYokeLineCheckpoints> GetLineCheckpointsAsync(string line, string? statusFilter)
    {
        var status = await GetStatusAsync(line);
        var excluded = _settings.Lines[line].SummaryExcludedStations;
        var filter = statusFilter?.Trim().ToUpperInvariant();
        if (filter != "OK" && filter != "MI") filter = "ALL";
        return new PokaYokeLineCheckpoints
        {
            Line = line,
            Status = filter,
            UpdatedAt = status.UpdatedAt,
            Ok = status.Total.Ok,
            Mi = status.Total.Mi,
            Checkpoints = status.Details
                .Where(d => !excluded.Contains(d.Key, StringComparer.OrdinalIgnoreCase))
                .OrderBy(d => d.Key, StringComparer.OrdinalIgnoreCase)
                .SelectMany(d => d.Value)
                .Where(c => filter == "ALL" || c.Status == filter)
                .ToList(),
            Error = status.Error
        };
    }

    private sealed class TagRow
    {
        public string StationNumber { get; set; } = "";
        public string TagName { get; set; } = "";
        public string DatabaseName { get; set; } = "";
        public string DbName { get; set; } = "";
        public string HistoryCard { get; set; } = "";
        public string? Description { get; set; }
        public int? TagOrder { get; set; }
    }

    private sealed record TableRef(string Database, string Schema, string Table)
    {
        public string Key => $"{Database}.{Table}";
        public string Sql => $"[{Database}].[{Schema}].[{Table}]";
    }

    private async Task<PokaYokeLineStatus> RefreshAsync(string lineKey, PokaYokeLineSettings line)
    {
        var status = new PokaYokeLineStatus { Line = lineKey, RefreshSeconds = _settings.RefreshSeconds };
        try
        {
            using var conn = new SqlConnection(_connectionString);
            await conn.OpenAsync();

            var tags = await LoadTagsAsync(conn, line);
            var sources = BuildSourceIndex(line);

            // (table, station) -> tag columns
            var groups = new Dictionary<(string TableKey, string Station), (TableRef Table, PokaYokeSourceSettings Source, List<TagRow> Tags)>();
            var unmatched = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var tag in tags)
            {
                var table = ParseTable(tag.DatabaseName, tag.DbName);
                if (!SafeColumn.IsMatch(tag.TagName))
                {
                    status.Errors.Add($"{tag.StationNumber}: invalid tag name '{tag.TagName}'");
                    status.Ignored++;
                    continue;
                }
                if (table == null || !sources.TryGetValue(table.Key, out var source))
                {
                    unmatched.Add(table?.Key ?? $"{tag.DatabaseName}{tag.DbName}");
                    status.Ignored++;
                    continue;
                }
                var stationFilter = source.StationColumn == null ? "" : tag.StationNumber;
                var key = (table.Key, stationFilter);
                if (!groups.TryGetValue(key, out var group))
                    groups[key] = group = (table, source, new List<TagRow>());
                group.Tags.Add(tag);
            }
            status.UnmatchedTables = unmatched.ToList();

            // Read the groups' latest records, MaxParallelQueries at a time (own pooled connection each).
            using var throttle = new SemaphoreSlim(Math.Max(1, _settings.MaxParallelQueries));
            var reads = await Task.WhenAll(groups.Values.Select(async g =>
            {
                await throttle.WaitAsync();
                try { return (Group: g, Result: await ReadGroupAsync(g.Table, g.Source, g.Source.StationColumn == null ? "" : g.Tags[0].StationNumber, g.Tags)); }
                finally { throttle.Release(); }
            }));

            var counts = new Dictionary<string, PokaYokeCount>(StringComparer.OrdinalIgnoreCase);
            // Per-station checkpoint list for the station / summary pop-ups.
            var details = new Dictionary<string, List<(int Order, PokaYokeCheckpoint Checkpoint)>>(StringComparer.OrdinalIgnoreCase);
            foreach (var ((_, source, groupTags), (values, errors)) in reads)
            {
                status.Errors.AddRange(errors);
                if (values == null)
                {
                    status.Ignored += groupTags.Count;
                    continue;
                }

                var miValues = source.MiValues ?? line.MiValues;
                foreach (var tag in groupTags)
                {
                    values.TryGetValue(tag.TagName, out var raw);
                    var value = raw?.Trim();
                    if (string.IsNullOrEmpty(value) || line.IgnoredValues.Contains(value, StringComparer.OrdinalIgnoreCase))
                    {
                        status.Ignored++;
                        continue;
                    }

                    var station = line.StationAliases.TryGetValue(tag.StationNumber, out var alias) ? alias : tag.StationNumber;
                    if (!counts.TryGetValue(station, out var count)) counts[station] = count = new PokaYokeCount();
                    var isMi = miValues.Contains(value, StringComparer.OrdinalIgnoreCase);
                    if (isMi) count.Mi++;
                    else count.Ok++;
                    status.Checkpoints++;

                    if (!details.TryGetValue(station, out var list)) details[station] = list = new();
                    list.Add((tag.TagOrder ?? int.MaxValue, new PokaYokeCheckpoint
                    {
                        Station = station,
                        Description = string.IsNullOrWhiteSpace(tag.Description) ? tag.TagName : tag.Description.Trim(),
                        Status = isMi ? "MI" : "OK",
                        Value = value
                    }));
                }
            }

            status.Stations = counts;
            status.Details = details.ToDictionary(
                d => d.Key,
                d => d.Value.OrderBy(x => x.Order).ThenBy(x => x.Checkpoint.Description).Select(x => x.Checkpoint).ToList(),
                StringComparer.OrdinalIgnoreCase);
            foreach (var (station, count) in counts)
            {
                if (line.SummaryExcludedStations.Contains(station, StringComparer.OrdinalIgnoreCase)) continue;
                status.Total.Ok += count.Ok;
                status.Total.Mi += count.Mi;
            }
            if (status.Errors.Count > 0)
                _logger.LogWarning("PokaYoke {Line}: {Count} table queries failed, first: {Error}", lineKey, status.Errors.Count, status.Errors[0]);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PokaYoke {Line} status refresh failed", lineKey);
            status.Error = ex.Message;
        }
        status.UpdatedAt = DateTime.Now;
        return status;
    }

    // GetTagEntriesForOverallPokeYokeV2: active Poka Yoke checkpoints of the line. A tag-master row is
    // one version of a checkpoint, valid from FromDate to ToDate; only the version valid now counts
    // (ThingWorx checked only ToDate > now, so it also counted versions that start in the future).
    private async Task<List<TagRow>> LoadTagsAsync(SqlConnection conn, PokaYokeLineSettings line)
    {
        var parts = line.TagMasterTable.Split('.');
        if (parts.Length != 2 || !SafeName.IsMatch(line.TagMasterDatabase) || !parts.All(SafeName.IsMatch))
            throw new InvalidOperationException("PokaYoke TagMasterDatabase / TagMasterTable is not a valid name.");

        var sql = $@"
            SELECT StationNumber, TagName, DatabaseName, DbName, HistoryCard, Description, TagOrder
            FROM [{line.TagMasterDatabase}].[{parts[0]}].[{parts[1]}]
            WHERE Line = @Line AND PokeYokeCheckPoints = 'YES' AND FromDate <= GETDATE() AND ToDate > GETDATE()
            ORDER BY StationNumber, TagOrder";
        var rows = await conn.QueryAsync<TagRow>(sql, new { line.Line }, commandTimeout: _settings.QueryTimeoutSeconds);
        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.StationNumber) && !string.IsNullOrWhiteSpace(r.TagName))
            .Where(r => !line.ExcludedHistoryCards.Contains(r.HistoryCard ?? "", StringComparer.OrdinalIgnoreCase))
            .Where(r => !line.ExcludedStations.Contains(r.StationNumber, StringComparer.OrdinalIgnoreCase))
            .Select(r => { r.StationNumber = r.StationNumber.Trim(); r.TagName = r.TagName.Trim(); return r; })
            .ToList();
    }

    // Table key ("Database.Table") -> its source rule.
    private static Dictionary<string, PokaYokeSourceSettings> BuildSourceIndex(PokaYokeLineSettings line)
    {
        var index = new Dictionary<string, PokaYokeSourceSettings>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in line.Sources)
            foreach (var t in source.Tables)
            {
                var parts = t.Split('.');
                var key = parts.Length == 3 ? $"{parts[0]}.{parts[2]}" : t;
                index[key] = source;
            }
        return index;
    }

    // Tag master stores e.g. DatabaseName "[REJILINE]." + DbName "[dbo].[STN_data]".
    private static TableRef? ParseTable(string databaseName, string dbName)
    {
        var database = (databaseName ?? "").Replace("[", "").Replace("]", "").Trim().TrimEnd('.');
        var parts = (dbName ?? "").Replace("[", "").Replace("]", "").Trim().Split('.', StringSplitOptions.RemoveEmptyEntries);
        var (schema, table) = parts.Length switch
        {
            1 => ("dbo", parts[0]),
            2 => (parts[0], parts[1]),
            _ => ("", "")
        };
        if (!SafeName.IsMatch(database) || !SafeName.IsMatch(schema) || !SafeName.IsMatch(table)) return null;
        return new TableRef(database, schema, table);
    }

    // One group's tag values (null = the table could not be read) and its error messages.
    private async Task<(Dictionary<string, string?>? Values, List<string> Errors)> ReadGroupAsync(TableRef table, PokaYokeSourceSettings source, string station, List<TagRow> tags)
    {
        var where = $"{table.Key}{(station == "" ? "" : " / " + station)}";
        var errors = new List<string>();
        var columns = tags.Select(t => t.TagName).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        try
        {
            using var conn = new SqlConnection(_connectionString);
            await conn.OpenAsync();
            try
            {
                return (await ReadLatestAsync(conn, table, source, station, columns), errors);
            }
            catch (SqlException ex) when (ex.Number == 207)
            {
                // A tag-master column that does not exist in the table: read the columns one by
                // one so only the bad checkpoints are lost (ThingWorx queried tag by tag).
                var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                foreach (var column in columns)
                {
                    try
                    {
                        foreach (var (k, v) in await ReadLatestAsync(conn, table, source, station, new List<string> { column }))
                            values[k] = v;
                    }
                    catch (SqlException colEx) when (colEx.Number == 207)
                    {
                        // Also raised when a configured station / status / order column is wrong.
                        errors.Add($"{where}: tag [{column}]: {colEx.Message}");
                    }
                }
                return (values, errors);
            }
        }
        catch (Exception ex)
        {
            errors.Add($"{where}: {ex.Message}");
            return (null, errors);
        }
    }

    // getPokeYokevalue / getPokeYokevalue_Other / ...GearTrainJEA1: the tag columns of the latest
    // (OK) record of a table, for one station when the table holds several.
    private async Task<Dictionary<string, string?>> ReadLatestAsync(SqlConnection conn, TableRef table, PokaYokeSourceSettings source, string station, List<string> columns)
    {
        foreach (var name in new[] { source.StationColumn, source.StatusColumn, source.OrderByColumn })
            if (name != null && !SafeName.IsMatch(name))
                throw new InvalidOperationException($"Invalid column name '{name}' in PokaYoke Sources.");

        var select = string.Join(", ", columns.Select((c, i) => $"[{c}] AS [c{i}]"));
        var where = new List<string>();
        if (source.StationColumn != null) where.Add($"[{source.StationColumn}] = @Station");
        if (source.StatusColumn != null) where.Add($"[{source.StatusColumn}] = @Ok");
        // Only the newest ScanLastRows rows: a station that has not run for a long time would
        // otherwise scan millions of rows back (ThingWorx did, with a 360 s timeout behind its cache).
        if (source.ScanLastRows is > 0)
            where.Add($"[{source.OrderByColumn}] > (SELECT MAX([{source.OrderByColumn}]) FROM {table.Sql}) - @ScanLastRows");
        var sql = $"SELECT TOP 1 {select} FROM {table.Sql}"
                  + (where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : "")
                  + $" ORDER BY [{source.OrderByColumn}] DESC";

        using var cmd = new SqlCommand(sql, conn) { CommandTimeout = _settings.QueryTimeoutSeconds };
        cmd.Parameters.AddWithValue("@Station", station);
        cmd.Parameters.AddWithValue("@Ok", source.StatusOkValue);
        cmd.Parameters.AddWithValue("@ScanLastRows", source.ScanLastRows ?? 0);
        using var reader = await cmd.ExecuteReaderAsync();

        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        if (await reader.ReadAsync())
            for (var i = 0; i < columns.Count; i++)
                result[columns[i]] = reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i));
        return result;
    }
}
