using System.Globalization;
using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > Gauge Inspection Report (read-only). Port of the ThingWorx mashup RE_Gauging_Report_MU and its Thing
// RE_GaugingReport_DB_TH:
//   getAllProcessCode (Process Code dropdown, from the report layout)          -> GetProcessCodesAsync
//   getTemplateData + getBatchNumberByGroup / ConNonConCheck / QueryByAllFilter -> GetDataAsync
// Rows = the report layout ([TemplateDatabase].[dbo].[TemplateTable], Show = 1; Inspector = QF codes, Operator = the
// rest; Critical / Non Critical by the layout's CriticalParameter flag). Columns = one per part (QR code + operator)
// with a reading in the window, in order of their first reading. Cell = one value per row and part.
// Differences from ThingWorx (agreed 2026-11-17, README lists them):
//   - Readings are matched to the layout by parameter code (the layout's full description = one of the parameter's
//     PartParameter descriptions) and every reading taken is shown. ThingWorx inner-joined CriticalPartParameter by
//     description, so parameters without a CriticalPartParameter row (e.g. 6 of the 23 QF-2OCMM1 rows) always showed "-".
//   - THIS SHIFT / TODAY / CUSTOM use ShiftConfiguration (ThingWorx: A 00:00-07:00, B 07:00-15:30, C 15:30 - 00:00 of
//     the same day, so C was always empty; CUSTOM = calendar day). CUSTOM = the production day of the chosen date.
//   - A reading's job is matched on JobSerialno + LineName (job numbers repeat across cells).
//   - One column per QR code + operator (ThingWorx made one per user name and Users holds some codes twice), no 36
//     column limit; a part measured twice for a parameter shows the latest reading (ThingWorx: the first).
//   - OK / Not OK only for go / no-go parameters (LSL / USL = AttributeLsl / AttributeUsl): ThingWorx showed any reading
//     of 1 / 0 as OK / Not OK, and counted a Not OK (0, inside -1.5 .. 1.5) as conforming.
//   - Readings outside LSL / USL and Not OK are flagged (red on screen) - our addition.
//   - Built per request (ThingWorx used a shared data table and Thing properties, so two users overwrote each other).
public class MachineShopGaugeReportService
{
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_\- ]{1,128}$", RegexOptions.Compiled);
    public const string RoleInspector = "INSPECTOR";
    public const string RoleOperator = "OPERATOR";
    public const string RangeShift = "shift";
    public const string RangeToday = "today";
    public const string RangeCustom = "custom";

    private readonly MachineShopSettings _settings;
    private readonly MachineShopGaugeReportSettings _gr;
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly MachineShopPdiService _pdi;

    public MachineShopGaugeReportService(IConfiguration configuration, MachineShopPdiService pdi)
    {
        _configuration = configuration;
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _gr = _settings.GaugeReport;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _pdi = pdi;
    }

    private List<string> ShiftNames() =>
        _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren().Select(s => s.Key).ToList();

    private List<string> CellNames() => Enumerable.Range(1, Math.Max(1, _gr.CellCount)).Select(n => $"CELL{n}").ToList();

    public MachineShopGirMachine? FindMachine(string? name) =>
        _gr.Machines.FirstOrDefault(m => string.Equals(m.Name, name?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static bool HasSource(MachineShopGirMachine m) => !string.IsNullOrWhiteSpace(m.Database);

    public bool IsCell(string? cell) => CellNames().Contains(cell ?? "", StringComparer.OrdinalIgnoreCase);

    public MachineShopGirOptions GetOptions() => new()
    {
        Machines = _gr.Machines.Select(m => new MachineShopGirMachineInfo(m.Name, HasSource(m))).ToList(),
        Cells = CellNames(),
        PageSize = Math.Max(1, _gr.PageSize)
    };

    private static string Checked(string name) =>
        SafeName.IsMatch(name) ? name : throw new InvalidOperationException($"Invalid database / table name '{name}'.");

    private string Template() => $"[{Checked(_gr.TemplateDatabase.Trim())}].[dbo].[{Checked(_gr.TemplateTable.Trim())}]";

    private static bool SqlLike(string value, string pattern)
    {
        var regex = "^" + Regex.Escape(pattern).Replace("%", ".*").Replace("_", ".") + "$";
        return Regex.IsMatch(value, regex, RegexOptions.IgnoreCase);
    }

    private bool RoleMatches(string processCode, string role) =>
        SqlLike(processCode.Trim(), _gr.InspectorProcessPattern) == (role == RoleInspector);

    private static bool CriticalMatches(bool? critical, bool wantCritical, bool wantNonCritical) =>
        (critical == true && wantCritical) || (critical != true && wantNonCritical);

    // Production day window: first shift start .. last shift end.
    private (DateTime Start, DateTime End) DayWindow(DateTime day)
    {
        var shifts = ShiftNames();
        return (_pdi.ShiftWindow(day, shifts[0]).Start, _pdi.ShiftWindow(day, shifts[^1]).End);
    }

    public DateTime ProductionDay(DateTime now) => now >= DayWindow(now.Date).Start ? now.Date : now.Date.AddDays(-1);

    // ---- Process Code dropdown (ThingWorx getAllProcessCode): layout codes with Show = 1 for the role / criticality ----
    public async Task<List<string>> GetProcessCodesAsync(string machineName, string role, bool critical, bool nonCritical)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        await using var conn = new SqlConnection(_connectionString);
        var rows = await conn.QueryAsync<(string ProcessCode, bool? Critical)>($@"
SELECT ProcessCode, CriticalParameter FROM {Template()} WHERE Machine = @machine AND Show = 1",
            new { machine = machine.Name }, commandTimeout: _settings.QueryTimeoutSeconds);
        return rows.Where(r => !string.IsNullOrWhiteSpace(r.ProcessCode) && RoleMatches(r.ProcessCode, role)
                               && CriticalMatches(r.Critical, critical, nonCritical))
            .Select(r => r.ProcessCode.Trim()).Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.Ordinal).ToList();
    }

    private record LayoutRow(int SerialNo, int? SNo, string ProcessCode, string? PartParaDescription, string? ParaDescription,
        string? Specification, string? GaugeNumber, bool? CriticalParameter);

    private record ReadingRow(string ProcessCode, string PartParaCode, string QrCode, string Operator, DateTime ReadTime,
        double Reading, double? Lsl, double? Usl);

    // Window of the report and the "Current Shift" text.
    public (DateTime From, DateTime To, string Shift) Window(string range, DateTime? date, DateTime now)
    {
        if (range == RangeCustom)
        {
            var (s, e) = DayWindow(date!.Value.Date);
            return (s, e, "N/A");
        }
        var day = ProductionDay(now);
        if (range == RangeToday)
        {
            var (s, e) = DayWindow(day);
            return (s, e, "N/A");
        }
        foreach (var shift in ShiftNames())
        {
            var (s, e) = _pdi.ShiftWindow(day, shift);
            if (now >= s && now < e) return (s, e, shift);
        }
        var (ds, de) = DayWindow(day);
        return (ds, de, "N/A");
    }

    private static string Normalize(string? text) =>
        Regex.Replace(text ?? "", @"\s+", " ").Trim().ToUpperInvariant();

    public async Task<MachineShopGirData> GetDataAsync(string machineName, string cell, string role, bool critical, bool nonCritical,
        bool conforming, bool nonConforming, IReadOnlyList<string> processCodes, string range, DateTime? date)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        var now = DateTime.Now;
        var (from, to, shift) = Window(range, date, now);
        var result = new MachineShopGirData
        {
            Machine = machine.Name, HasSource = HasSource(machine), Cell = cell, Role = role, Shift = shift,
            From = DateTime.SpecifyKind(from, DateTimeKind.Unspecified), To = DateTime.SpecifyKind(to, DateTimeKind.Unspecified)
        };
        if (processCodes.Count == 0) return result;

        await using var conn = new SqlConnection(_connectionString);
        // Layout rows, in the order of the selected process codes (ThingWorx getTemplateData), S.No numbered 1..n.
        var layout = (await conn.QueryAsync<LayoutRow>($@"
SELECT SerialNo, SNo, ProcessCode, PartParaDescription, ParaDescription, Specification, GaugeNumber, CriticalParameter
FROM {Template()} WHERE Machine = @machine AND Show = 1 AND ProcessCode IN @processCodes",
            new { machine = machine.Name, processCodes }, commandTimeout: _settings.QueryTimeoutSeconds))
            .Where(r => RoleMatches(r.ProcessCode, role) && CriticalMatches(r.CriticalParameter, critical, nonCritical))
            .OrderBy(r => processCodes.ToList().FindIndex(c => string.Equals(c, r.ProcessCode.Trim(), StringComparison.OrdinalIgnoreCase)))
            .ThenBy(r => r.SerialNo).ToList();
        if (layout.Count == 0) return result;

        var readings = new List<ReadingRow>();
        var users = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var descByCode = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var queryTo = to < now ? to : now;
        if (result.HasSource && from < queryTo)
        {
            var db = $"[{Checked(machine.Database.Trim())}].[dbo]";
            var codes = layout.Select(r => r.ProcessCode.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var cellPattern = string.Format(CultureInfo.InvariantCulture, _gr.CellLinePattern, Regex.Match(cell, @"\d+").Value);
            readings = (await conn.QueryAsync<ReadingRow>($@"
SELECT j.ProcessCode, r.PartParaCode, r.QRCode AS QrCode, r.OPERATOR AS Operator,
       (CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME)) AS ReadTime, r.Reading,
       p.LSLValue AS Lsl, p.USLValue AS Usl
FROM {db}.[JobReading] r
JOIN {db}.[Job] j ON j.JobSerialno = r.JobSerialno AND j.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT
OUTER APPLY (SELECT TOP 1 jp.LSLValue, jp.USLValue FROM {db}.[JobParameter] jp
             WHERE jp.JobSerialno = r.JobSerialno
               AND jp.PartParaCode COLLATE DATABASE_DEFAULT = r.PartParaCode COLLATE DATABASE_DEFAULT
               AND jp.LineName COLLATE DATABASE_DEFAULT = r.LineName COLLATE DATABASE_DEFAULT) p
WHERE r.ReadingDate >= @dayFrom AND r.ReadingDate <= @dayTo
  AND (CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME)) >= @from
  AND (CAST(r.ReadingDate AS DATETIME) + CAST(r.ReadingTime AS DATETIME)) < @to
  AND r.Reading IS NOT NULL AND ISNULL(r.QRCode, '') <> ''
  AND j.ProcessCode IN @codes AND r.LineName LIKE @cellPattern;",
                new { dayFrom = from.Date, dayTo = queryTo.Date, from, to = queryTo, codes, cellPattern },
                commandTimeout: _settings.QueryTimeoutSeconds)).ToList();

            if (readings.Count > 0)
            {
                var partCodes = readings.Select(r => r.PartParaCode).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                foreach (var (code, desc) in await conn.QueryAsync<(string Code, string Desc)>($@"
SELECT PartParaCode, PartParaDescription FROM {db}.[PartParameter] WHERE PartParaCode IN @partCodes",
                             new { partCodes }, commandTimeout: _settings.QueryTimeoutSeconds))
                {
                    if (!descByCode.TryGetValue(Normalize(desc), out var set))
                        descByCode[Normalize(desc)] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    set.Add(code.Trim());
                }
                var ops = readings.Select(r => r.Operator).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                foreach (var (code, name) in await conn.QueryAsync<(string Code, string Name)>($@"
SELECT UserCode, MAX(UserName) FROM {db}.[Users] WHERE UserCode IN @ops GROUP BY UserCode",
                             new { ops }, commandTimeout: _settings.QueryTimeoutSeconds))
                    users[code.Trim()] = name?.Trim() ?? "";
            }
        }

        // Conformance of each reading; Conformance filter (ThingWorx ConNonConCheck).
        bool IsAttribute(ReadingRow r) => r.Lsl == _gr.AttributeLsl && r.Usl == _gr.AttributeUsl;
        bool Conforms(ReadingRow r) => IsAttribute(r)
            ? r.Reading == 1
            : (r.Lsl == null || r.Reading >= r.Lsl) && (r.Usl == null || r.Reading <= r.Usl);
        var kept = readings.Where(r => Conforms(r) ? conforming : nonConforming)
            .GroupBy(r => (Process: r.ProcessCode.Trim().ToUpperInvariant(), Code: r.PartParaCode.Trim().ToUpperInvariant()))
            .ToDictionary(g => g.Key, g => g.ToList());

        // Readings per layout row: same process code, a parameter whose description is the row's full description.
        var rowReadings = layout.Select(row =>
        {
            var list = new List<ReadingRow>();
            if (descByCode.TryGetValue(Normalize(row.ParaDescription), out var partCodes))
                foreach (var code in partCodes)
                    if (kept.TryGetValue((row.ProcessCode.Trim().ToUpperInvariant(), code.ToUpperInvariant()), out var hit))
                        list.AddRange(hit);
            return list;
        }).ToList();

        // Columns: parts with a matched reading, in order of their first reading.
        var components = rowReadings.SelectMany(l => l)
            .GroupBy(r => (Qr: r.QrCode.Trim(), Op: r.Operator.Trim()))
            .Select(g => new MachineShopGirComponent
            {
                QrCode = g.Key.Qr, Operator = g.Key.Op, UserName = users.GetValueOrDefault(g.Key.Op),
                FirstReading = DateTime.SpecifyKind(g.Min(r => r.ReadTime), DateTimeKind.Unspecified)
            })
            .OrderBy(c => c.FirstReading).ThenBy(c => c.QrCode, StringComparer.Ordinal).ToList();
        result.ComponentsTotal = components.Count;
        result.Components = components.Take(Math.Max(1, _gr.MaxComponents)).ToList();

        for (var i = 0; i < layout.Count; i++)
        {
            var row = layout[i];
            var byPart = rowReadings[i].GroupBy(r => (r.QrCode.Trim(), r.Operator.Trim()))
                .ToDictionary(g => g.Key, g => g.OrderBy(r => r.ReadTime).Last());
            result.Rows.Add(new MachineShopGirRow
            {
                SNo = i + 1, ProcessCode = row.ProcessCode.Trim(),
                Description = (row.PartParaDescription ?? row.ParaDescription ?? "").Trim(),
                Specification = row.Specification?.Trim(), GaugeNumber = row.GaugeNumber?.Trim(),
                Critical = row.CriticalParameter == true,
                Values = result.Components.Select(c =>
                {
                    if (!byPart.TryGetValue((c.QrCode, c.Operator), out var r)) return null;
                    return new MachineShopGirValue
                    {
                        Text = IsAttribute(r) ? (r.Reading == 1 ? "OK" : "Not OK") : r.Reading.ToString("0.#####", CultureInfo.InvariantCulture),
                        Nok = !Conforms(r)
                    };
                }).ToList()
            });
        }
        return result;
    }
}
