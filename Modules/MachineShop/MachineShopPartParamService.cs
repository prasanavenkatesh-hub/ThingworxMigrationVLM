using System.Text.RegularExpressions;
using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Machine Shop > Part Parameter Config. Port of the ThingWorx mashup RE_PartParameter_Configuration_MU
// ("PART PARAMETER-CONFIGURATION PAGE") and its Things:
//   RE_Machine_name_DT (machine tabs)            -> MachineShop:PartParamConfig:Machines
//   RE_CrankCase_Helper_DB_TH.queryCiticalData   -> GetParametersAsync: SELECT * of the machine's CriticalPartParameter
//                                                   (getCriticalPartParameterData / ...CoverLH / ...CoverRH)
//   CreateCriricalParameter (insertdb...)        -> CreateAsync
//   updateCriticalPrameterData                   -> UpdateAsync
//   deleteParameter                              -> DeleteAsync
//   RE_Crank_case_TH.noncritcal (Non Critical)   -> settings row NonCritical
//   RE_CrankCase_Helper_DB_TH.SampleSizefromConfiguration + RE_SampleSizeInfo_DT (Sample Size)
//                                                -> settings row SampleSize + the SampleSizeTable list
// Differences from ThingWorx (see README):
//   - Every action uses the one table of the machine. ThingWorx listed and edited Crank Case LH in
//     [VVL-ProQMS-J1-Crank CaseLH-C1] but inserted / deleted in [VVL-ProQMS-J1-Crank CaseLH] (a 2022 copy), and its
//     Edit fell back to [VVL-ProQMS-J1-CrankCase RH] (no such table) for a code missing there.
//   - Delete works for every machine (ThingWorx had no Cover RH case); Create rejects an existing code (ThingWorx
//     did not check) and gives every machine the same CreateDefaults flags (ThingWorx: Operator / Inspector = 1
//     for Cover LH only).
//   - Machines without a parameter table (ThingWorx had no case for them, so the grid stayed empty) say so.
//   RE_GaugingReport_DB_TH.getConfigurationData / updateConfTable (Report Configuration, data tables
//   RE_GaugeReport_TemplateDT / RE_GaugeReportTemplate_CoverLH_DT)
//                                                -> GetReportTemplateAsync / SaveReportTemplateAsync on ReportTemplateTable
//   - Report Configuration works for every machine with a layout (Crank Case LH and Cover LH); ThingWorx always
//     edited RE_GaugeReport_TemplateDT (Crank Case LH), whatever tab was open.
// Writes: the plant CriticalPartParameter tables (Create / Edit / Delete - the app's only writes outside
// ControlTowerVLM; factreread needs INSERT / UPDATE / DELETE there, NoPermission until granted) and the two
// settings and the Report Configuration Show flags in ControlTowerVLM. All gated by App:WritesEnabled.
public class MachineShopPartParamService
{
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_]{1,128}$", RegexOptions.Compiled);
    // Plant database names have spaces and hyphens ("VVL-ProQMS-J1-Crank CaseLH-C1"); always used in [ ].
    private static readonly Regex SafeDatabase = new(@"^[A-Za-z0-9_\- ]{1,128}$", RegexOptions.Compiled);
    private const string NonCriticalKey = "NonCritical";
    private const string SampleSizeKey = "SampleSize";

    private readonly MachineShopSettings _settings;
    private readonly MachineShopPartParamSettings _pp;
    private readonly string _connectionString;
    private readonly bool _writesEnabled; // TEMPORARY: AppWriteMode (view-only copies)
    // Optional flag columns per table: the plant copies differ (VVL-ProQMS-J1-Crank CaseLH has no ProductParameter).
    private readonly Dictionary<string, HashSet<string>> _columns = new(StringComparer.OrdinalIgnoreCase);

    public MachineShopPartParamService(IConfiguration configuration)
    {
        _settings = configuration.GetSection("MachineShop").Get<MachineShopSettings>() ?? new MachineShopSettings();
        _pp = _settings.PartParamConfig;
        _connectionString = configuration.GetConnectionString("SharedDataConnection") ?? "";
        _writesEnabled = AppWriteMode.IsEnabled(configuration); // TEMPORARY: AppWriteMode (view-only copies)
    }

    public bool HasMachine(string name) => FindMachine(name) != null;

    private MachineShopPartParamMachine? FindMachine(string name) =>
        _pp.Machines.FirstOrDefault(m => string.Equals(m.Name, name.Trim(), StringComparison.OrdinalIgnoreCase));

    private string SettingsTable => $"[{Checked(_pp.SettingsDatabase, SafeName)}].[dbo].[{Checked(_pp.SettingsTable, SafeName)}]";
    private string SampleSizeTable => $"[{Checked(_pp.SettingsDatabase, SafeName)}].[dbo].[{Checked(_pp.SampleSizeTable, SafeName)}]";
    private string ReportTemplateTable => $"[{Checked(_pp.SettingsDatabase, SafeName)}].[dbo].[{Checked(_pp.ReportTemplateTable, SafeName)}]";

    // Machine tabs + the two settings. A missing settings table does not stop the page: the grid still works.
    public async Task<MachineShopPartParamOptions> GetOptionsAsync()
    {
        var options = new MachineShopPartParamOptions
        {
            Machines = _pp.Machines.Select(m => new MachineShopPartParamTab(m.Name, !string.IsNullOrWhiteSpace(m.Database))).ToList(),
            WritesEnabled = _writesEnabled
        };
        try
        {
            await using var conn = new SqlConnection(_connectionString);
            options.SampleSizes = (await conn.QueryAsync<int>($"SELECT SampleSize FROM {SampleSizeTable} ORDER BY SampleSize",
                commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
            options.Settings = await ReadSettingsAsync(conn);
        }
        catch (SqlException ex)
        {
            options.SettingsError = ex.Message;
        }
        try
        {
            await using var conn = new SqlConnection(_connectionString);
            var withLayout = (await conn.QueryAsync<string>($"SELECT DISTINCT Machine FROM {ReportTemplateTable}",
                commandTimeout: _settings.QueryTimeoutSeconds)).Select(m => m.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            options.ReportMachines = _pp.Machines.Where(m => withLayout.Contains(m.Name)).Select(m => m.Name).ToList();
        }
        catch (SqlException)
        {
            // No layout table: the Report Configuration button stays disabled.
        }
        return options;
    }

    // Report Configuration grid (ThingWorx getConfigurationData: the SD = 'Row' entries of the layout data table),
    // in report order.
    public async Task<List<MachineShopReportTemplateRow>> GetReportTemplateAsync(string machineName)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        await using var conn = new SqlConnection(_connectionString);
        return (await conn.QueryAsync<MachineShopReportTemplateRow>($@"
            SELECT Id, SNo, ProcessCode, PartParaDescription, Specification, GaugeNumber, CriticalParameter, Show
            FROM {ReportTemplateTable} WHERE Machine = @machine ORDER BY SNo, SerialNo",
            new { machine = machine.Name }, commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
    }

    // Report Configuration Save (ThingWorx updateConfTable). Only rows whose Show changed are written.
    // Returns the number of rows changed, or null in a view-only copy.
    public async Task<int?> SaveReportTemplateAsync(MachineShopReportTemplateUpdate update)
    {
        if (!_writesEnabled) return null; // TEMPORARY: AppWriteMode (view-only copies)
        var machine = FindMachine(update.Machine) ?? throw new ArgumentException($"Unknown machine '{update.Machine}'.");
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var changed = 0;
        foreach (var row in update.Rows)
        {
            changed += await conn.ExecuteAsync($@"
                UPDATE {ReportTemplateTable} SET Show = @show, UpdatedAt = GETDATE()
                WHERE Id = @id AND Machine = @machine AND Show <> @show",
                new { id = row.Id, show = row.Show, machine = machine.Name }, tx, _settings.QueryTimeoutSeconds);
        }
        await tx.CommitAsync();
        return changed;
    }

    // Non Critical / Sample Size for other Machine Shop screens (Online Control Charts reads Non Critical).
    public async Task<MachineShopPartParamPageSettings> GetPageSettingsAsync()
    {
        await using var conn = new SqlConnection(_connectionString);
        return await ReadSettingsAsync(conn);
    }

    private async Task<MachineShopPartParamPageSettings> ReadSettingsAsync(SqlConnection conn)
    {
        var rows = (await conn.QueryAsync<(string Key, string Value)>($"SELECT SettingKey, SettingValue FROM {SettingsTable}",
            commandTimeout: _settings.QueryTimeoutSeconds)).ToDictionary(r => r.Key.Trim(), r => r.Value?.Trim() ?? "", StringComparer.OrdinalIgnoreCase);
        return new MachineShopPartParamPageSettings
        {
            NonCritical = rows.TryGetValue(NonCriticalKey, out var nc) && bool.TryParse(nc, out var b) && b,
            SampleSize = rows.TryGetValue(SampleSizeKey, out var ss) && int.TryParse(ss, out var n) ? n : 0
        };
    }

    // SPC constants of one sample size (ThingWorx RE_SampleSizeInfo_DT row); null when the size is not in the table.
    // Online Control Charts SPC LIVE / SPC MONTHLY.
    public async Task<MachineShopSpcConstants?> GetSpcConstantsAsync(int sampleSize)
    {
        await using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<MachineShopSpcConstants>(
            $@"SELECT SampleSize, CAST(A2 AS float) AS A2, CAST(d2 AS float) AS D2, CAST(D3 AS float) AS D3, CAST(D4 AS float) AS D4
               FROM {SampleSizeTable} WHERE SampleSize = @sampleSize",
            new { sampleSize }, commandTimeout: _settings.QueryTimeoutSeconds);
    }

    public async Task<bool> IsSampleSizeAsync(int sampleSize)
    {
        await using var conn = new SqlConnection(_connectionString);
        return await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {SampleSizeTable} WHERE SampleSize = @sampleSize",
            new { sampleSize }, commandTimeout: _settings.QueryTimeoutSeconds) > 0;
    }

    // ThingWorx saved each setting as soon as it changed (toggle -> SetProperties, dropdown -> SetProperties).
    // Returns null in a view-only copy.
    public async Task<MachineShopPartParamPageSettings?> SaveSettingsAsync(MachineShopPartParamSettingsUpdate update)
    {
        if (!_writesEnabled) return null; // TEMPORARY: AppWriteMode (view-only copies)
        var values = new List<(string Key, string Value)>();
        if (update.NonCritical is bool nonCritical) values.Add((NonCriticalKey, nonCritical ? "true" : "false"));
        if (update.SampleSize is int sampleSize) values.Add((SampleSizeKey, sampleSize.ToString()));
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        foreach (var (key, value) in values)
        {
            await conn.ExecuteAsync($@"
                UPDATE {SettingsTable} SET SettingValue = @value, UpdatedDate = GETDATE() WHERE SettingKey = @key;
                IF @@ROWCOUNT = 0
                    INSERT INTO {SettingsTable} (SettingKey, SettingValue, UpdatedDate) VALUES (@key, @value, GETDATE());",
                new { key, value }, tx, _settings.QueryTimeoutSeconds);
        }
        await tx.CommitAsync();
        return await ReadSettingsAsync(conn);
    }

    // The machine's CriticalPartParameter rows. No ORDER BY, as ThingWorx (SELECT *): the rows come in table order,
    // which is the order the parameters were entered in.
    public async Task<MachineShopPartParamList> GetParametersAsync(string machineName)
    {
        var machine = FindMachine(machineName) ?? throw new ArgumentException($"Unknown machine '{machineName}'.");
        var list = new MachineShopPartParamList { Machine = machine.Name, HasSource = !string.IsNullOrWhiteSpace(machine.Database), UpdatedAt = DateTime.Now };
        if (!list.HasSource) return list;
        var table = TableOf(machine);
        await using var conn = new SqlConnection(_connectionString);
        var cols = await ColumnsAsync(conn, table);
        string Opt(string column, string alias) => cols.Contains(column) ? $"[{column}] AS {alias}" : $"CAST(NULL AS bit) AS {alias}";
        list.Rows = (await conn.QueryAsync<MachineShopPartParamRow>($@"
            SELECT ISNULL(PartParaCode, '') AS PartParaCode, ISNULL(PartParaDescription, '') AS PartParaDescription,
                   CriticalParameter, UpdatedDate, {Opt("Operator", "Operator")}, {Opt("SPC", "Spc")}, {Opt("Inspector", "Inspector")},
                   {Opt("ProductParameter", "ProductParameter")}
            FROM {table}", commandTimeout: _settings.QueryTimeoutSeconds)).ToList();
        return list;
    }

    // ThingWorx CreateCriricalParameter -> insertdb / insertdbCoverLH / insertdbCoverRH. Rejects an existing code.
    public async Task<MachineShopPartParamWriteResult> CreateAsync(MachineShopPartParamInput input, DateTime updatedDate)
    {
        if (!_writesEnabled) return ViewOnly(); // TEMPORARY: AppWriteMode (view-only copies)
        var machine = FindMachine(input.Machine);
        if (machine == null || string.IsNullOrWhiteSpace(machine.Database)) return NoSource(input.Machine);
        var table = TableOf(machine);
        var d = _pp.CreateDefaults;
        return await WriteAsync(table, "INSERT", async conn =>
        {
            var cols = await ColumnsAsync(conn, table);
            var names = new List<string> { "PartParaCode", "PartParaDescription", "CriticalParameter", "UpdatedDate" };
            var values = new List<string> { "@code", "@description", "@critical", "@updatedDate" };
            void Add(string column, string param) { if (cols.Contains(column)) { names.Add(column); values.Add(param); } }
            Add("Operator", "@operator");
            Add("Inspector", "@inspector");
            Add("SPC", "@spc");
            Add("ProductParameter", "@productParameter");
            var n = await conn.ExecuteAsync($@"
                INSERT INTO {table} ({string.Join(", ", names.Select(c => $"[{c}]"))})
                SELECT {string.Join(", ", values)}
                WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE PartParaCode = @code)",
                new
                {
                    code = input.PartParaCode, description = input.PartParaDescription, critical = input.CriticalParameter, updatedDate,
                    @operator = d.Operator, inspector = d.Inspector, spc = d.Spc, productParameter = d.ProductParameter
                }, commandTimeout: _settings.QueryTimeoutSeconds);
            return n > 0
                ? new MachineShopPartParamWriteResult(MachineShopPartParamWriteStatus.Ok, "PartPara code created successfully.")
                : new MachineShopPartParamWriteResult(MachineShopPartParamWriteStatus.Duplicate, $"PartPara code '{input.PartParaCode}' already exists for {machine.Name}.");
        });
    }

    // ThingWorx updateCriticalPrameterData -> updateCriticalParameter / ...CoverLH / ...CoverRH (the code is the key and is not changed).
    public async Task<MachineShopPartParamWriteResult> UpdateAsync(MachineShopPartParamInput input, DateTime updatedDate)
    {
        if (!_writesEnabled) return ViewOnly(); // TEMPORARY: AppWriteMode (view-only copies)
        var machine = FindMachine(input.Machine);
        if (machine == null || string.IsNullOrWhiteSpace(machine.Database)) return NoSource(input.Machine);
        var table = TableOf(machine);
        return await WriteAsync(table, "UPDATE", async conn =>
        {
            var cols = await ColumnsAsync(conn, table);
            var sets = new List<string> { "[PartParaDescription] = @description", "[CriticalParameter] = @critical", "[UpdatedDate] = @updatedDate" };
            if (cols.Contains("Operator")) sets.Add("[Operator] = @operator");
            if (cols.Contains("Inspector")) sets.Add("[Inspector] = @inspector");
            if (cols.Contains("SPC")) sets.Add("[SPC] = @spc");
            var n = await conn.ExecuteAsync($"UPDATE {table} SET {string.Join(", ", sets)} WHERE PartParaCode = @code",
                new
                {
                    code = input.PartParaCode, description = input.PartParaDescription, critical = input.CriticalParameter, updatedDate,
                    @operator = input.Operator, inspector = input.Inspector, spc = input.Spc
                }, commandTimeout: _settings.QueryTimeoutSeconds);
            return n > 0
                ? new MachineShopPartParamWriteResult(MachineShopPartParamWriteStatus.Ok, "Critical parameter successfully updated.")
                : NotFound(input.PartParaCode, machine.Name);
        });
    }

    // ThingWorx deleteParameter -> deleteParameterCrankCaseLH / deleteParameterCoverLH (every row with the code).
    public async Task<MachineShopPartParamWriteResult> DeleteAsync(string machineName, string code)
    {
        if (!_writesEnabled) return ViewOnly(); // TEMPORARY: AppWriteMode (view-only copies)
        var machine = FindMachine(machineName);
        if (machine == null || string.IsNullOrWhiteSpace(machine.Database)) return NoSource(machineName);
        var table = TableOf(machine);
        return await WriteAsync(table, "DELETE", async conn =>
        {
            var n = await conn.ExecuteAsync($"DELETE FROM {table} WHERE PartParaCode = @code", new { code }, commandTimeout: _settings.QueryTimeoutSeconds);
            return n > 0
                ? new MachineShopPartParamWriteResult(MachineShopPartParamWriteStatus.Ok, "PartPara code deleted.")
                : NotFound(code, machine.Name);
        });
    }

    // Runs one write; a permission error (229 / 230: factreread not granted yet) becomes NoPermission.
    private async Task<MachineShopPartParamWriteResult> WriteAsync(string table, string permission, Func<SqlConnection, Task<MachineShopPartParamWriteResult>> write)
    {
        await using var conn = new SqlConnection(_connectionString);
        try
        {
            return await write(conn);
        }
        catch (SqlException ex) when (ex.Number is 229 or 230)
        {
            return new MachineShopPartParamWriteResult(MachineShopPartParamWriteStatus.NoPermission,
                $"The database login has no {permission} permission on {table}. Ask the DBA to grant INSERT / UPDATE / DELETE on it.");
        }
    }

    private static MachineShopPartParamWriteResult ViewOnly() => new(MachineShopPartParamWriteStatus.ViewOnly,
        "This copy of the app is view-only (App:WritesEnabled = false).");

    private static MachineShopPartParamWriteResult NoSource(string machine) => new(MachineShopPartParamWriteStatus.NoSource,
        $"No parameter table is configured for '{machine}'.");

    private static MachineShopPartParamWriteResult NotFound(string code, string machine) => new(MachineShopPartParamWriteStatus.NotFound,
        $"PartPara code '{code}' was not found for {machine} (refresh the list).");

    private string TableOf(MachineShopPartParamMachine machine) =>
        $"[{Checked(machine.Database.Trim(), SafeDatabase)}].[dbo].[{Checked(_pp.Table, SafeName)}]";

    // Which optional flag columns the table has (cached per table).
    private async Task<HashSet<string>> ColumnsAsync(SqlConnection conn, string table)
    {
        lock (_columns)
            if (_columns.TryGetValue(table, out var known)) return known;
        var found = (await conn.QueryAsync<string>(
            "SELECT c FROM (VALUES ('Operator'), ('Inspector'), ('SPC'), ('ProductParameter')) v(c) WHERE COL_LENGTH(@table, c) IS NOT NULL",
            new { table }, commandTimeout: _settings.QueryTimeoutSeconds)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        lock (_columns) _columns[table] = found;
        return found;
    }

    private static string Checked(string name, Regex pattern) =>
        pattern.IsMatch(name) ? name : throw new InvalidOperationException($"Invalid name '{name}' in MachineShop:PartParamConfig.");
}
