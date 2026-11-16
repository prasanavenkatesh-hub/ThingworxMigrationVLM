using Dapper;
using Microsoft.Data.SqlClient;

namespace ControlTower.Services;

// Writes/reads [ControlTowerVLM].[dbo].[EbCAlerts] via SharedDataConnection (database name from
// appsettings EbRtm:Database). Table script: Modules/EbRtm/Sql/EbCAlerts.sql. One row per alert,
// the same columns as ThingWorx's RE_EMRTMAlerts_ST stream.
public class EbRtmAlertRepository
{
    private readonly string _connectionString;
    private readonly string _database; // EbRtm:Database (appsettings.json)
    private readonly bool _writesEnabled; // TEMPORARY: AppWriteMode (view-only copies)

    public EbRtmAlertRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("SharedDataConnection") ?? "";
        _database = config["EbRtm:Database"] ?? "ControlTowerVLM";
        _writesEnabled = AppWriteMode.IsEnabled(config); // TEMPORARY: AppWriteMode (view-only copies)
    }

    public class NewAlert
    {
        public DateTime AlertTime { get; set; }
        public int SourceId { get; set; }
        public int MeterId { get; set; }
        public string Device { get; set; } = "";
        public string MeterModel { get; set; } = "";
        public string Category { get; set; } = "";
        public string Title { get; set; } = "";
        public string Description { get; set; } = "";
        public int Type { get; set; }
        public double? ActualValue { get; set; }
    }

    public async Task InsertAsync(NewAlert alert)
    {
        if (!_writesEnabled) return; // TEMPORARY: AppWriteMode (view-only copies)
        var sql = $@"
            INSERT INTO [{_database}].[dbo].[EbCAlerts]
                ([AlertTime], [SourceId], [MeterId], [Device], [MeterModel], [Category], [Title], [Description], [Type], [ActualValue])
            VALUES
                (@AlertTime, @SourceId, @MeterId, @Device, @MeterModel, @Category, @Title, @Description, @Type, @ActualValue)";
        using var conn = new SqlConnection(_connectionString);
        await conn.ExecuteAsync(sql, alert);
    }

    // Title of the newest alert of a category for a meter (null if none) - seeds monitor state after a restart.
    public async Task<string?> GetLastTitleAsync(int sourceId, string category)
    {
        var sql = $@"
            SELECT TOP 1 [Title] FROM [{_database}].[dbo].[EbCAlerts]
            WHERE [SourceId] = @SourceId AND [Category] = @Category
            ORDER BY [AlertTime] DESC, [Id] DESC";
        using var conn = new SqlConnection(_connectionString);
        return await conn.QuerySingleOrDefaultAsync<string?>(sql, new { SourceId = sourceId, Category = category });
    }
}
