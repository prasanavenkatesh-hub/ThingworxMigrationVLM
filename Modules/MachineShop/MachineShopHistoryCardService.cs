using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > History Card. Port of the ThingWorx mashups QF_MachineShopBarcode_MU (barcode list) and
// QF_MachineShop_HistoryCardMU (the card, opened in a new browser tab) and their Thing RE_GeneologyDB_Thing:
//   getMSCardsName / getCellNumber -> GetOptionsAsync (cards from the layout tables, cells from config)
//   getBarcodeList                 -> GetBarcodesAsync: rows of the card's PDI station, by cell + time range
//                                     (SQL_getBarcode) or by barcode (SQL_searchBarcode)
//   getHistoryCardDataTable1       -> GetCardAsync Lines: one line per layout row (RE_MSConfiguration) with
//                                     the TagValue column of the latest MachineShopData row of the barcode at
//                                     the row's station
//   getHistoryCardDataTable2       -> GetCardAsync Spc (Cover LH / RH): readings of the barcode and of the
//                                     previous / next barcode of the SPC job (PocSpcHCD) from the SPC database
// Card layouts: the tables [LayoutDatabase].[dbo].[LineTable] / [SpcTable] (copies of the ThingWorx data tables
// RE_MSConfigurationDT / SPCMSconfiguration_DT, Modules/MachineShop/Sql/HistoryCard_*.sql), cached for
// LayoutCacheMinutes; a card = its CardDisplayName rows in ID order.
// The PDI station of a card = the layout row whose description has "PDI" but not "Intermediate PDI" and whose
// station name has "PDI" (getStationNumber). Rework stations are shown only when the PDI status is NOK.
// Differences from ThingWorx (see README):
//   - A station row is matched on the card's MatchColumns only. ThingWorx also matched Barcode_2 / _3 / _4 =
//     '' for every card but Crank Case, so it showed the latest row of the station whatever the barcode.
//   - Crank Case: the defect / reason rows of the Intermediate PDI (per side) and the PDI station are hidden
//     when their status is OK (HideWhenOk). ThingWorx removed rows by fixed offsets and its code failed on
//     the new layout, so the Crank Case card came back empty.
//   - Shift = the shift of the PDI time (ThingWorx showed the shift running when the card was opened).
//   - SPC: the cell of the previous / next search is the part's cell (PDI row), not the list's Cell dropdown;
//     the reading time accepts AM / PM; Cover RH uses its own job codes (OPN_10 ... OPN_70).
// Read-only.
public class MachineShopHistoryCardService
{
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_]{1,128}$", RegexOptions.Compiled);
    private static readonly Regex SafeDatabase = new(@"^[A-Za-z0-9_\-]{1,128}$", RegexOptions.Compiled);

    private readonly MachineShopSettings _settings;
    private readonly MachineShopHistoryCardSettings _hc;
    private readonly IConfiguration _configuration;
    private readonly MachineShopPdiService _pdi;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _layoutLock = new(1, 1);
    private Layout? _layout;
    private DateTime _layoutLoadedUtc;
    private HashSet<string>? _columns;

    private record LayoutRow(int Id, string SerialNo, string Description, string Tag, string StationName, int Station);
    private record SpcRow(int Id, string SerialNo, string Description, string Specification, string Gauge, string Method,
        string Code, string BeforeCode, string AfterCode, string StationName);
    // Cards / Spc keyed by CardDisplayName.
    private record Layout(Dictionary<string, List<LayoutRow>> Cards, Dictionary<string, List<SpcRow>> Spc);

    public MachineShopHistoryCardService(IConfiguration configuration, MachineShopPdiService pdi)
    {
        _configuration = configuration;
        _pdi = pdi;
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _hc = _settings.HistoryCard;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
    }

    // Both layout tables, reloaded after LayoutCacheMinutes (edits to the tables show up without a restart).
    private async Task<Layout> LayoutAsync()
    {
        if (_layout != null && DateTime.UtcNow - _layoutLoadedUtc < TimeSpan.FromMinutes(Math.Max(0, _hc.LayoutCacheMinutes))) return _layout;
        await _layoutLock.WaitAsync();
        try
        {
            if (_layout != null && DateTime.UtcNow - _layoutLoadedUtc < TimeSpan.FromMinutes(Math.Max(0, _hc.LayoutCacheMinutes))) return _layout;
            var db = SafeName.IsMatch(_hc.LayoutDatabase) ? _hc.LayoutDatabase : throw new InvalidOperationException($"Invalid MachineShop:HistoryCard:LayoutDatabase '{_hc.LayoutDatabase}'.");
            var lineTable = $"[{db}].[dbo].[{Checked(_hc.LineTable)}]";
            var spcTable = $"[{db}].[dbo].[{Checked(_hc.SpcTable)}]";
            await using var conn = new SqlConnection(_connectionString);
            var lines = await conn.QueryAsync<(string Card, int Id, string SerialNo, string Desc, string Tag, string Station, int StationNo)>($@"
                SELECT LTRIM(RTRIM(CardDisplayName)), ID, ISNULL(SerialNo, N''), ISNULL(DescVal, N''), ISNULL(LTRIM(RTRIM(TagValue)), N''),
                       ISNULL(StationName, N''), ISNULL(StationNumber, 0)
                FROM {lineTable}", commandTimeout: _settings.QueryTimeoutSeconds);
            var spc = await conn.QueryAsync<(string Card, int Id, string SerialNo, string Desc, string Spec, string Gauge, string Method,
                string Code, string Before, string After, string Station)>($@"
                SELECT LTRIM(RTRIM(CardDisplayName)), ID, ISNULL(SerialNo, N''), ISNULL(DescVal, N''), ISNULL(Specification, N''),
                       ISNULL(GaugeNumber, N''), ISNULL(CheckingMethod, N''),
                       ISNULL(LTRIM(RTRIM(TAGVALUE_CURRENT_INSPECTION_REPORT)), N''), ISNULL(LTRIM(RTRIM(TAGVALUE_BEFORE_INSPECTION_REPORT)), N''),
                       ISNULL(LTRIM(RTRIM(TAGVALUE_AFTER_INSPECTION_REPORT)), N''), ISNULL(StationName, N'')
                FROM {spcTable}", commandTimeout: _settings.QueryTimeoutSeconds);
            _layout = new Layout(
                lines.GroupBy(r => r.Card, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key,
                    g => g.OrderBy(r => r.Id).Select(r => new LayoutRow(r.Id, r.SerialNo.Trim(), r.Desc, r.Tag, r.Station, r.StationNo)).ToList(),
                    StringComparer.OrdinalIgnoreCase),
                spc.GroupBy(r => r.Card, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key,
                    g => g.OrderBy(r => r.Id).Select(r => new SpcRow(r.Id, r.SerialNo.Trim(), r.Desc, r.Spec, r.Gauge, r.Method,
                        r.Code, r.Before.Length > 0 ? r.Before : r.Code, r.After.Length > 0 ? r.After : r.Code, r.Station)).ToList(),
                    StringComparer.OrdinalIgnoreCase));
            _layoutLoadedUtc = DateTime.UtcNow;
            return _layout;
        }
        finally
        {
            _layoutLock.Release();
        }
    }

    private MachineShopHistoryCard? Card(Layout layout, string name) =>
        _hc.Cards.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase) && layout.Cards.ContainsKey(c.Name));

    public async Task<bool> HasCardAsync(string name) => Card(await LayoutAsync(), name) != null;
    public bool HasCell(string cell) => _hc.Cells.Contains(cell);

    // getStationNumber: the card's PDI station.
    private static int PdiStation(Layout layout, string card) =>
        layout.Cards[card].FirstOrDefault(r =>
            r.Description.Contains("PDI", StringComparison.OrdinalIgnoreCase)
            && !r.Description.Contains("Intermediate PDI", StringComparison.OrdinalIgnoreCase)
            && r.StationName.Contains("PDI", StringComparison.OrdinalIgnoreCase))?.Station ?? 0;

    public async Task<MachineShopHistoryCardOptions> GetOptionsAsync()
    {
        var layout = await LayoutAsync();
        return new MachineShopHistoryCardOptions
        {
            Cards = _hc.Cards.Where(c => layout.Cards.ContainsKey(c.Name))
                .Select(c => new MachineShopHistoryCardOption(c.Name, PdiStation(layout, c.Name).ToString(), c.Spc != null)).ToList(),
            Cells = _hc.Cells,
            MaxRows = _hc.MaxRows
        };
    }

    // getBarcodeList: barcode given -> its rows at the PDI station (SQL_searchBarcode, any time / cell);
    // otherwise the rows of the cell at the PDI station between from and to, newest first (SQL_getBarcode).
    public async Task<MachineShopHistoryCardBarcodes> GetBarcodesAsync(string cardName, string cell, DateTime from, DateTime to, string? barcode)
    {
        var layoutTables = await LayoutAsync();
        var card = Card(layoutTables, cardName)!;
        var station = PdiStation(layoutTables, card.Name).ToString();
        var result = new MachineShopHistoryCardBarcodes { Card = card.Name, PdiStation = station, MaxRows = _hc.MaxRows };
        var p = new DynamicParameters();
        p.Add("Station", station, DbType.AnsiString, size: 5);   // Station_Number is char(5)
        p.Add("Take", _hc.MaxRows + 1);
        string where, order;
        if (!string.IsNullOrWhiteSpace(barcode))
        {
            result.Search = true;
            p.Add("Barcodes", BarcodeCandidates(barcode.Trim()));
            where = "d.Barcode_1 IN @Barcodes";
            order = "d.[DateTime]";
        }
        else
        {
            p.Add("Cell", cell, DbType.AnsiString);
            p.Add("From", from, DbType.DateTime);
            p.Add("To", to, DbType.DateTime);
            where = "d.Cell_Number = @Cell AND d.[DateTime] BETWEEN @From AND @To";
            order = "d.[DateTime] DESC";
        }
        var sql = $@"
            SELECT TOP (@Take) d.[DateTime], ISNULL(d.Barcode_1, '') AS Barcode, ISNULL(d.Barcode_2, '') AS Barcode2, ISNULL(RTRIM(d.Cell_Number), '') AS Cell
            FROM {Source()} d WITH (NOLOCK)
            WHERE d.Station_Number = @Station AND {where}
            ORDER BY {order}";
        await using var conn = new SqlConnection(_connectionString);
        var rows = (await conn.QueryAsync<(DateTime DateTime, string Barcode, string Barcode2, string Cell)>(
            sql, p, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
        result.Truncated = rows.Count > _hc.MaxRows;
        result.Rows = rows.Take(_hc.MaxRows).Select(r => new MachineShopHistoryCardBarcode(r.DateTime, r.Barcode.Trim(), r.Barcode2.Trim(), r.Cell)).ToList();
        return result;
    }

    // A barcode typed without spaces: also try it as 5-4-6 (ThingWorx formatBarcode, old barcodes such as
    // "34C16 J173 01846") and 5-5-5 (current barcodes such as "34C17 FK292 06103").
    private static List<string> BarcodeCandidates(string barcode)
    {
        var list = new List<string> { barcode };
        if (!barcode.Contains(' '))
        {
            if (barcode.Length > 9) list.Add($"{barcode[..5]} {barcode[5..9]} {barcode[9..]}");
            if (barcode.Length > 10) list.Add($"{barcode[..5]} {barcode[5..10]} {barcode[10..]}");
            if (barcode.Length > 15) list.Add($"{barcode[..5]} {barcode[5..10]} {barcode[10..15]} {barcode[15..]}");
        }
        return list.Distinct().ToList();
    }

    public async Task<MachineShopHistoryCardData> GetCardAsync(string cardName, string barcode, string cell)
    {
        var layoutTables = await LayoutAsync();
        var card = Card(layoutTables, cardName)!;
        var layout = layoutTables.Cards[card.Name];
        var pdiStation = PdiStation(layoutTables, card.Name);
        var columns = await ColumnsAsync();
        var ok = _settings.Pdi.OkStatus;
        var nok = _settings.Pdi.NokStatus;

        await using var conn = new SqlConnection(_connectionString);

        // Barcodes to match: the barcode on MatchColumns; Crank Case adds the derived RH barcode and the
        // Barcode_3 / _4 of the barcode's row at the Related station (SQL_getMachineShopDatabarcode3).
        var match = new List<(string Column, string Value)>();
        foreach (var c in card.MatchColumns) match.Add((Checked(c), barcode));
        if (card.DerivedBarcode is { } derived && barcode.Length >= derived.Position)
        {
            var i = derived.Position - 1;
            match.Add((Checked(derived.Column), barcode[..i] + derived.Char + barcode[(i + 1)..]));
        }
        if (card.Related is { } related && related.Columns.Count > 0)
        {
            var cols = related.Columns.Select(Checked).ToList();
            var rp = new DynamicParameters();
            rp.Add("Barcode", barcode);
            rp.Add("Station", related.Station, DbType.AnsiString, size: 5);
            rp.Add("Card", related.HistoryCardNumber, DbType.AnsiString);
            var row = (await conn.QueryAsync($@"
                SELECT TOP 1 {string.Join(", ", cols.Select(c => $"ISNULL(d.[{c}], '') AS [{c}]"))}
                FROM {Source()} d WITH (NOLOCK)
                WHERE d.Barcode_1 = @Barcode AND d.Station_Number = @Station AND d.History_Card_Number = @Card
                ORDER BY d.[DateTime] DESC", rp, commandTimeout: _settings.QueryTimeoutSeconds)).FirstOrDefault() as IDictionary<string, object>;
            if (row != null)
                foreach (var c in cols)
                    if (Text(row[c]) is { Length: > 0 } v) match.Add((c, v));
        }

        // Latest row of the barcode at every station of the card, only the columns the card shows.
        var stations = layout.Select(r => r.Station).Where(s => s != 0).Distinct().ToList();
        var wanted = layout.Select(r => r.Tag)
            .Concat(card.HideWhenOk.Select(h => h.StatusColumn))
            .Concat(new[] { "DateTime", "Cell_Number", "OverallStation_Status" })
            .Where(c => SafeName.IsMatch(c) && columns.Contains(c))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var p = new DynamicParameters();
        var names = new List<string>();
        for (var i = 0; i < stations.Count; i++)
        {
            names.Add($"@s{i}");
            p.Add($"s{i}", stations[i].ToString(), DbType.AnsiString, size: 5);
        }
        var or = new List<string>();
        for (var i = 0; i < match.Count; i++)
        {
            or.Add($"d.[{match[i].Column}] = @m{i}");
            p.Add($"m{i}", match[i].Value);
        }
        var byStation = new Dictionary<int, IDictionary<string, object>>();
        if (stations.Count > 0 && or.Count > 0)
        {
            var sql = $@"
                SELECT * FROM (
                    SELECT RTRIM(d.Station_Number) AS [_Station], {string.Join(", ", wanted.Select(c => $"d.[{c}]"))},
                           ROW_NUMBER() OVER (PARTITION BY d.Station_Number ORDER BY d.[DateTime] DESC) AS [_Rn]
                    FROM {Source()} d WITH (NOLOCK)
                    WHERE d.Station_Number IN ({string.Join(", ", names)}) AND ({string.Join(" OR ", or)})
                ) x WHERE x.[_Rn] = 1";
            foreach (IDictionary<string, object> row in await conn.QueryAsync(sql, p, commandTimeout: _settings.QueryTimeoutSeconds))
                if (int.TryParse(Text(row["_Station"]), out var s)) byStation[s] = row;
        }

        string Value(IDictionary<string, object>? row, string column) =>
            row == null || !row.TryGetValue(column, out var v) ? "" : Text(v);
        bool IsOk(string value) => string.Equals(value, ok, StringComparison.OrdinalIgnoreCase);

        byStation.TryGetValue(pdiStation, out var pdiRow);
        var pdiStatus = Value(pdiRow, "OverallStation_Status");
        var reworkShown = string.Equals(pdiStatus, nok, StringComparison.OrdinalIgnoreCase);
        var when = pdiRow?["DateTime"] as DateTime?
            ?? byStation.Values.Select(r => r["DateTime"] as DateTime?).Where(d => d != null).Max();
        var partCell = Value(pdiRow, "Cell_Number");

        var result = new MachineShopHistoryCardData
        {
            Card = card.Name, Barcode = barcode, Cell = partCell.Length > 0 ? partCell : cell,
            PdiStation = pdiStation.ToString(), DateTime = when, Shift = when is { } w ? ShiftOf(w) : "",
            PdiStatus = pdiStatus, UpdatedAt = DateTime.Now
        };
        foreach (var r in layout)
        {
            if (r.StationName.Contains("Rework", StringComparison.OrdinalIgnoreCase) && !reworkShown) continue;
            byStation.TryGetValue(r.Station, out var row);
            if (card.HideWhenOk.Any(h => h.Station == r.Station && h.Columns.Contains(r.Tag, StringComparer.OrdinalIgnoreCase)
                                         && IsOk(Value(row, h.StatusColumn)))) continue;
            var value = r.Station == 0 ? "" : Value(row, r.Tag);
            result.Lines.Add(new MachineShopHistoryCardLine(r.SerialNo.Length == 0, r.SerialNo, r.Description, "", value, ""));
        }

        if (card.Spc != null)
            result.Spc = await GetSpcAsync(conn, layoutTables, card, barcode, result.Cell, pdiStation);
        return result;
    }

    // getHistoryCardDataTable2. SPC station heading (code empty or OPERATOR): previous / next barcode of the
    // station's latest job (PocSpcHCD) and "barcode: operator / reading time" for the three barcodes. Data row:
    // the reading of the barcode (TAGVALUE_CURRENT code), the previous one (_BEFORE_) and the next one (_AFTER_) -
    // a number for ValueMethods, otherwise OK (reading <> 0) / NOK.
    private async Task<List<MachineShopHistoryCardSpcLine>> GetSpcAsync(SqlConnection conn, Layout layoutTables, MachineShopHistoryCard card,
        string barcode, string cell, int pdiStation)
    {
        var spc = card.Spc!;
        var lines = new List<MachineShopHistoryCardSpcLine>();
        if (!layoutTables.Spc.TryGetValue(card.Name, out var rows) || !SafeDatabase.IsMatch(spc.Database)) return lines;
        var db = $"[{spc.Database}].[dbo]";
        var codes = rows.Where(r => r.Code.Length > 0 && !IsOperator(r.Code))
            .SelectMany(r => new[] { r.Code, r.BeforeCode, r.AfterCode }).Where(c => c.Length > 0).Distinct().ToList();
        var readings = new Dictionary<string, Dictionary<string, double>>();
        var operators = new Dictionary<string, string>();

        async Task<Dictionary<string, double>> ReadingsOf(string qr)
        {
            if (readings.TryGetValue(qr, out var cached)) return cached;
            var found = new Dictionary<string, double>(StringComparer.Ordinal);
            if (codes.Count > 0)
                foreach (var (code, reading) in await conn.QueryAsync<(string Code, double Reading)>($@"
                    SELECT x.PartParaCode, x.Reading FROM (
                        SELECT r.PartParaCode, ISNULL(r.Reading, 0) AS Reading,
                               ROW_NUMBER() OVER (PARTITION BY r.PartParaCode ORDER BY r.ReadingDate DESC, r.ReadingSerialNo DESC) AS rn
                        FROM {db}.[JobReading] r WITH (NOLOCK)
                        WHERE r.QRCode = @Qr AND r.PartParaCode IN @Codes) x
                    WHERE x.rn = 1", new { Qr = qr, Codes = codes }, commandTimeout: _settings.QueryTimeoutSeconds))
                    found[code] = reading;
            return readings[qr] = found;
        }

        async Task<string> OperatorOf(string qr)
        {
            if (operators.TryGetValue(qr, out var cached)) return cached;
            var op = await conn.QueryFirstOrDefaultAsync<string>($@"
                SELECT TOP 1 LTRIM(RTRIM(r.OPERATOR)) FROM {db}.[JobReading] r WITH (NOLOCK)
                WHERE r.QRCode = @Qr AND ISNULL(r.OPERATOR, '') <> ''", new { Qr = qr }, commandTimeout: _settings.QueryTimeoutSeconds);
            DateTime? time = spc.TimeParaCodes.Count == 0 ? null : await conn.QueryFirstOrDefaultAsync<DateTime?>($@"
                SELECT MIN(TRY_CONVERT(datetime, CONVERT(char(8), r.ReadingDate, 112) + ' ' + LTRIM(r.ReadingTime)))
                FROM {db}.[JobReading] r WITH (NOLOCK)
                WHERE r.QRCode = @Qr AND r.PartParaCode IN @Codes", new { Qr = qr, Codes = spc.TimeParaCodes }, commandTimeout: _settings.QueryTimeoutSeconds);
            return operators[qr] = op != null && time != null
                ? $"{op} / {time:yyyy-MM-dd HH:mm:ss}"
                : "OPERATOR ID NOT FOUND / TIMESTAMP NOT FOUND";
        }

        string Reading(Dictionary<string, double> found, SpcRow r, string code)
        {
            if (!found.TryGetValue(code, out var v)) return "";
            var numeric = spc.ValueMethods.Any(m => string.Equals(m.Trim(), r.Method.Trim(), StringComparison.OrdinalIgnoreCase));
            return numeric ? v.ToString(CultureInfo.InvariantCulture) : v != 0 ? _settings.Pdi.OkStatus : _settings.Pdi.NokStatus;
        }

        string? prev = null, next = null;
        var current = await ReadingsOf(barcode);
        foreach (var r in rows)
        {
            if (r.Code.Length == 0 || IsOperator(r.Code))
            {
                var op = spc.Operations.FirstOrDefault(o => string.Equals(o.Station.Trim(), r.StationName.Trim(), StringComparison.OrdinalIgnoreCase)
                                                            && (o.BarcodePrefix.Length == 0 || barcode.StartsWith(o.BarcodePrefix, StringComparison.OrdinalIgnoreCase)));
                (prev, next) = op == null || op.ProcessCodes.Count == 0 || cell.Length == 0
                    ? (null, null)
                    : await PrevNextAsync(conn, db, op.ProcessCodes, "%" + cell, barcode, pdiStation);
                lines.Add(new MachineShopHistoryCardSpcLine(true, "", r.Description, "", "", "",
                    $"{barcode}: {await OperatorOf(barcode)}",
                    prev == null ? _hc.NotFoundText : $"{prev}: {await OperatorOf(prev)}",
                    next == null ? _hc.NotFoundText : $"{next}: {await OperatorOf(next)}"));
                continue;
            }
            lines.Add(new MachineShopHistoryCardSpcLine(false, r.SerialNo, r.Description, r.Specification, r.Gauge, r.Method,
                Reading(current, r, r.Code),
                prev == null ? "" : Reading(await ReadingsOf(prev), r, r.BeforeCode),
                next == null ? "" : Reading(await ReadingsOf(next), r, r.AfterCode)));
        }
        return lines;
    }

    private static bool IsOperator(string code) => string.Equals(code, "OPERATOR", StringComparison.OrdinalIgnoreCase);

    // PocSpcHCD: the latest 2 jobs of the operation on the cell's line. If the barcode was measured in a job,
    // previous / next = the neighbouring QR codes of that job; otherwise previous = the highest barcode below
    // it that passed the PDI station and was measured in the job, next = the QR code after that one.
    private async Task<(string? Prev, string? Next)> PrevNextAsync(SqlConnection conn, string db, List<string> processCodes,
        string cellPattern, string barcode, int pdiStation)
    {
        var t = _settings.QueryTimeoutSeconds;
        var jobs = (await conn.QueryAsync<double>($@"
            SELECT x.JobSerialno FROM (
                SELECT DISTINCT TOP 2 j.JobSerialno, j.JobStartDate, j.ProcessCode FROM {db}.[Job] j WITH (NOLOCK)
                WHERE j.ProcessCode IN @Codes AND j.LineName LIKE @Cell
                ORDER BY j.JobStartDate DESC) x", new { Codes = processCodes, Cell = cellPattern }, commandTimeout: t)).ToList();
        string? prev = null, next = null;
        foreach (var job in jobs)
        {
            var count = await conn.ExecuteScalarAsync<int>($@"
                SELECT COUNT(DISTINCT r.QRCode) FROM {db}.[JobReading] r WITH (NOLOCK)
                WHERE r.QRCode = @Qr AND r.JobSerialno = @Job", new { Qr = barcode, Job = job }, commandTimeout: t);
            if (count != 1) continue;
            prev = await conn.QueryFirstOrDefaultAsync<string>($@"
                SELECT TOP 1 r.QRCode FROM {db}.[JobReading] r WITH (NOLOCK)
                WHERE r.QRCode < @Qr AND r.JobSerialno = @Job ORDER BY r.QRCode DESC", new { Qr = barcode, Job = job }, commandTimeout: t);
            next = await NextAsync(conn, db, barcode, job);
            break;
        }
        if (string.IsNullOrEmpty(prev))
        {
            prev = null;
            foreach (var job in jobs)
            {
                var p = new DynamicParameters(new { Qr = barcode, Job = job });
                p.Add("Station", pdiStation.ToString(), DbType.AnsiString, size: 5);
                prev = await conn.QueryFirstOrDefaultAsync<string>($@"
                    SELECT TOP 1 m.Barcode_1 FROM {Source()} m WITH (NOLOCK)
                    WHERE m.Station_Number = @Station AND m.Barcode_1 < @Qr
                      AND m.Barcode_1 COLLATE DATABASE_DEFAULT IN (
                          SELECT DISTINCT r.QRCode COLLATE DATABASE_DEFAULT FROM {db}.[JobReading] r WITH (NOLOCK)
                          WHERE r.JobSerialno = @Job AND r.QRCode < @Qr)
                    ORDER BY m.Barcode_1 DESC", p, commandTimeout: t);
                if (string.IsNullOrEmpty(prev)) { prev = null; continue; }
                next = await NextAsync(conn, db, prev, job);
                break;
            }
        }
        return (prev, string.IsNullOrEmpty(next) ? null : next);
    }

    private Task<string?> NextAsync(SqlConnection conn, string db, string qr, double job) =>
        conn.QueryFirstOrDefaultAsync<string>($@"
            SELECT TOP 1 r.QRCode FROM {db}.[JobReading] r WITH (NOLOCK)
            WHERE r.QRCode > @Qr AND r.JobSerialno = @Job ORDER BY r.QRCode ASC", new { Qr = qr, Job = job },
            commandTimeout: _settings.QueryTimeoutSeconds);

    // Shift (ShiftConfiguration) whose window on the production day or the day before contains t.
    private string ShiftOf(DateTime t)
    {
        foreach (var day in new[] { t.Date, t.Date.AddDays(-1) })
            foreach (var shift in _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key))
            {
                var (start, end) = _pdi.ShiftWindow(day, shift);
                if (t >= start && t < end) return shift;
            }
        return "";
    }

    // Columns of the source table, so layout TagValues that are not columns (e.g. "NA") show an empty value.
    private async Task<HashSet<string>> ColumnsAsync()
    {
        if (_columns != null) return _columns;
        await using var conn = new SqlConnection(_connectionString);
        var names = await conn.QueryAsync<string>($@"
            SELECT COLUMN_NAME FROM [{Checked(_settings.Database)}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @Table",
            new { Table = _settings.Table }, commandTimeout: _settings.QueryTimeoutSeconds);
        return _columns = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
    }

    private static string Text(object? v) => v switch
    {
        null or DBNull => "",
        DateTime d => d.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString()?.Trim() ?? ""
    };

    private string Source() => $"[{Checked(_settings.Database)}].[dbo].[{Checked(_settings.Table)}]";

    private static string Checked(string name) =>
        SafeName.IsMatch(name) ? name : throw new InvalidOperationException($"Invalid column/table name '{name}' in MachineShop config.");
}
