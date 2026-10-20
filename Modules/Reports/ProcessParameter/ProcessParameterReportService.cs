using System.Data;
using System.Text;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Process/Product Parameter Report EA2 (port of Process_Product_Parameter_Report_1.pbix). Read-only,
// parameterised SELECTs (no stored procedure: the column list changes with the Dynamic Columns choice)
// over SharedDataConnection with the database names from ProcessParameterReport:MainlineDatabase /
// QHoldDatabase. Only column names from ProcessParameterColumns are put into the SQL text.
//   ML  - STN_data rows (ML-06 excluded, as in Power BI's query)
//   QH  - QHold_PDI_DB rows
//   DUP - ML-01 rows of engines loaded at ML-01 more than once (DuplicateCount = ML-01 rows of the engine, whole table)
// Rows are paged with keyset-style OFFSET over (Date_Time, ID) on the Date_Time index; the full row
// is read only for the page.
public class ProcessParameterReportService
{
    public static readonly string[] Sections = { "ML", "QH", "DUP" };

    private readonly string _connectionString;
    private readonly string _mainlineDb;
    private readonly string _qholdDb;
    private readonly int _commandTimeout;

    public ProcessParameterReportService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("SharedDataConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:SharedDataConnection is not configured.");
        var section = configuration.GetSection("ProcessParameterReport");
        _mainlineDb = section["MainlineDatabase"] ?? "RE_Vallam_J1EA2_Mainline_DB";
        _qholdDb = section["QHoldDatabase"] ?? "RE_Vallam_J1EA2_QHold_PDI_DB";
        _commandTimeout = section.GetValue("CommandTimeoutSeconds", 120);
    }

    // Shift as Power BI's [Shift Column]: B 07:15:00-15:44:59, A 00:15:01-07:14:59, otherwise C
    // (DAX TIME() drops fractions, so 00:15:00.5 is still C).
    private static string ShiftSql(string col)
    {
        var t = "CAST(" + col + " AS TIME)";
        return "CASE WHEN " + t + " >= '07:15:00' AND " + t + " < '15:45:00' THEN 'B' " +
               "WHEN " + t + " >= '00:15:01' AND " + t + " < '07:15:00' THEN 'A' ELSE 'C' END";
    }

    // The same shift as a WHERE condition (cheaper than comparing the CASE).
    private static string ShiftWhere(string col, string shift)
    {
        var t = "CAST(" + col + " AS TIME)";
        return shift switch
        {
            "B" => "(" + t + " >= '07:15:00' AND " + t + " < '15:45:00')",
            "A" => "(" + t + " >= '00:15:01' AND " + t + " < '07:15:00')",
            _ => "(" + t + " < '00:15:01' OR " + t + " >= '15:45:00')"
        };
    }

    private sealed record Source(string Table, string StationCol, string StatusCol, string? FixedWhere);

    private Source SourceFor(string section) => section == "QH"
        ? new Source("[" + _qholdDb + "].[dbo].[QHold_PDI_DB]", "Station_Number", "Station_Status", null)
        : new Source("[" + _mainlineDb + "].[dbo].[STN_data]", "Stn_Number", "Stn_Status",
            section == "DUP" ? "s.Stn_Number = 'ML-01' AND s.Engine_Number NOT IN ('EMPTY PALLET', '', ' ')" : "s.Stn_Number <> 'ML-06'");

    // WHERE for alias s. Station is left out when includeStation is false (Station dropdown / pie query).
    private static string Where(ProcessParameterFilter f, Source src, DynamicParameters p, bool includeStation)
    {
        var w = new List<string> { "s.Date_Time >= @FromDate", "s.Date_Time < @ToExclusive" };
        p.Add("@FromDate", f.FromDate.Date, DbType.DateTime);
        p.Add("@ToExclusive", f.ToDate.Date.AddDays(1), DbType.DateTime);
        if (src.FixedWhere != null) w.Add(src.FixedWhere);
        if (!string.IsNullOrEmpty(f.Shift)) w.Add(ShiftWhere("s.Date_Time", f.Shift));   // A / B / C validated by the controller
        if (f.Hour != null) { w.Add("DATEPART(HOUR, s.Date_Time) = @Hour"); p.Add("@Hour", f.Hour); }
        if (!string.IsNullOrEmpty(f.Engine))
        {
            var esc = f.Engine.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]");
            w.Add("s.Engine_Number LIKE @Engine");
            p.Add("@Engine", "%" + esc + "%");
        }
        if (!string.IsNullOrEmpty(f.Status)) { w.Add("s." + src.StatusCol + " = @Status"); p.Add("@Status", f.Status); }
        if (includeStation && !string.IsNullOrEmpty(f.Station) && f.Section != "DUP")
        {
            w.Add("s." + src.StationCol + " = @Station");
            p.Add("@Station", f.Station);
        }
        return string.Join(" AND ", w);
    }

    private const string DupApply =
        " CROSS APPLY (SELECT COUNT(*) AS DuplicateCount FROM [{DB}].[dbo].[STN_data] d" +
        " WHERE d.Engine_Number = s.Engine_Number AND d.Stn_Number = 'ML-01') c";

    private string DupJoin() => DupApply.Replace("{DB}", _mainlineDb);

    // Columns of a page / export (after the fixed Date_Time, Shift, Engine_Number, Station).
    private static List<ProcessParameterColumn> ValidColumns(ProcessParameterFilter f)
    {
        var allowed = f.Section == "QH" ? ProcessParameterColumns.QHold : ProcessParameterColumns.Mainline;
        return f.Columns
            .Select(c => allowed.FirstOrDefault(a => a.Column == c))
            .Where(c => c != null)
            .GroupBy(c => c!.Column).Select(g => g.First()!)
            .ToList();
    }

    private string SelectList(ProcessParameterFilter f, Source src, IEnumerable<ProcessParameterColumn> cols)
    {
        var sb = new StringBuilder("s.Date_Time, " + ShiftSql("s.Date_Time") + " AS Shift, s.Engine_Number");
        if (f.Section == "DUP")
        {
            sb.Append(", s.Barcode_2, c.DuplicateCount");
            return sb.ToString();
        }
        sb.Append(", s." + src.StationCol + " AS Station");
        foreach (var c in cols) sb.Append(", s.[" + c.Column + "]");
        return sb.ToString();
    }

    private string OrderBy(ProcessParameterFilter f) => f.Section == "DUP" ? "s.Engine_Number, s.Date_Time, s.ID" : "s.Date_Time, s.ID";

    public async Task<ProcessParameterData> GetPageAsync(ProcessParameterFilter f, int page, int pageSize)
    {
        var src = SourceFor(f.Section);
        var cols = ValidColumns(f);
        using var connection = new SqlConnection(_connectionString);

        // 1. Rows per station / status (Rows card, Status pie, Station dropdown)
        var gp = new DynamicParameters();
        var groupSql = f.Section == "DUP"
            ? "SELECT s.Stn_Number AS Station, s.Stn_Status AS Status, COUNT(*) AS Rows FROM " + src.Table + " s" + DupJoin() +
              " WHERE " + Where(f, src, gp, false) + " AND c.DuplicateCount > 1 GROUP BY s.Stn_Number, s.Stn_Status"
            : "SELECT s." + src.StationCol + " AS Station, s." + src.StatusCol + " AS Status, COUNT(*) AS Rows FROM " + src.Table + " s" +
              " WHERE " + Where(f, src, gp, false) + " GROUP BY s." + src.StationCol + ", s." + src.StatusCol;
        var groups = (await connection.QueryAsync<ProcessParameterGroup>(groupSql, gp, commandTimeout: _commandTimeout)).ToList();

        // 2. One page: page keys from the Date_Time index first, then the full rows for just those keys
        var pp = new DynamicParameters();
        var where = Where(f, src, pp, true);
        pp.Add("@Skip", (page - 1) * pageSize);
        pp.Add("@Take", pageSize);
        string pageSql;
        if (f.Section == "DUP")
        {
            pageSql = "SELECT " + SelectList(f, src, cols) + " FROM " + src.Table + " s" + DupJoin() +
                      " WHERE " + where + " AND c.DuplicateCount > 1 ORDER BY " + OrderBy(f) +
                      " OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY";
        }
        else
        {
            pageSql = "WITH K AS (SELECT s.ID FROM " + src.Table + " s WHERE " + where +
                      " ORDER BY " + OrderBy(f) + " OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY) " +
                      "SELECT " + SelectList(f, src, cols) + " FROM K JOIN " + src.Table + " s ON s.ID = K.ID ORDER BY " + OrderBy(f);
        }
        var rows = (await connection.QueryAsync(pageSql, pp, commandTimeout: _commandTimeout))
            .Select(r => new Dictionary<string, object?>((IDictionary<string, object?>)r))
            .ToList();

        return new ProcessParameterData { Section = f.Section, Groups = groups, Page = page, PageSize = pageSize, Rows = rows };
    }

    // Streams the filtered rows (at most maxRows) as CSV - opens in Excel. Text is cleaned of control
    // characters (some barcode fields hold raw scanner bytes).
    public async Task WriteCsvAsync(ProcessParameterFilter f, int maxRows, Stream output, CancellationToken ct)
    {
        var src = SourceFor(f.Section);
        var cols = ValidColumns(f);
        var p = new DynamicParameters();
        var where = Where(f, src, p, true);
        p.Add("@Max", maxRows);
        var sql = "SELECT TOP (@Max) " + SelectList(f, src, cols) + " FROM " + src.Table + " s" +
                  (f.Section == "DUP" ? DupJoin() : "") +
                  " WHERE " + where + (f.Section == "DUP" ? " AND c.DuplicateCount > 1" : "") +
                  " ORDER BY " + OrderBy(f);

        var headers = new List<string> { "Date_Time", "Shift", "Engine_Number" };
        if (f.Section == "DUP") headers.AddRange(new[] { "Barcode_2", "DuplicateCount" });
        else { headers.Add("Station"); headers.AddRange(cols.Select(c => c.Name)); }

        await using var writer = new StreamWriter(output, new UTF8Encoding(true), 65536, leaveOpen: true);
        await writer.WriteLineAsync(string.Join(",", headers.Select(Csv)));

        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(ct);
        using var reader = await connection.ExecuteReaderAsync(new CommandDefinition(sql, p, commandTimeout: _commandTimeout, cancellationToken: ct));
        var line = new StringBuilder();
        while (await reader.ReadAsync(ct))
        {
            line.Clear();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                if (i > 0) line.Append(',');
                var v = reader.IsDBNull(i) ? null : reader.GetValue(i);
                line.Append(Csv(v is DateTime dt ? dt.ToString("yyyy-MM-dd HH:mm:ss") : v?.ToString() ?? ""));
            }
            await writer.WriteLineAsync(line.ToString());
        }
        await writer.FlushAsync();
    }

    private static string Csv(string value)
    {
        var clean = new string(value.Where(ch => !char.IsControl(ch)).ToArray());
        return clean.IndexOfAny(new[] { ',', '"' }) >= 0 ? "\"" + clean.Replace("\"", "\"\"") + "\"" : clean;
    }
}
