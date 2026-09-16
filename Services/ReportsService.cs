using ControlTower.Models;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;

namespace ControlTower.Services
{
    public class ReportsService : IReportsService
    {
        private readonly IConfiguration _configuration;
        private readonly string _connectionString;
        private readonly string _mainlineConnectionString;
        private readonly string _pokeYokeFilterConnectionString;
        private readonly string _pokeYokeDataConnectionString;

        public ReportsService(IConfiguration configuration)
        {
            _configuration = configuration;
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? "";
            _mainlineConnectionString = configuration.GetConnectionString("MainlineConnection") ?? "";
            _pokeYokeFilterConnectionString = configuration.GetConnectionString("PokeYokeFilterConnection") ?? "";
            _pokeYokeDataConnectionString = configuration.GetConnectionString("PokeYokeDataConnection") ?? "";
        }

        private static (string Name, DateTime Start) ResolveShiftStart(DateTime eventDateTime, IConfigurationSection shiftsSection)
        {
            var time = eventDateTime.TimeOfDay;
            foreach (var shift in shiftsSection.GetChildren())
            {
                var start = TimeSpan.Parse(shift["Start"] ?? "00:00:00");
                var end = TimeSpan.Parse(shift["End"] ?? "23:59:59");

                if (start <= end)
                {
                    if (time >= start && time <= end)
                        return (shift.Key, eventDateTime.Date + start);
                }
                else if (time >= start || time <= end)
                {
                    var shiftDate = time >= start ? eventDateTime.Date : eventDateTime.Date.AddDays(-1);
                    return (shift.Key, shiftDate + start);
                }
            }
            return ("", eventDateTime.Date);
        }

        public async Task<IEnumerable<BiometricReport>> GetBiometricShiftwiseReportAsync(string line, string? historyCard, string startDate, string endDate)
        {
            using (var connection = new SqlConnection(_pokeYokeDataConnectionString))
            {
                var parameters = new DynamicParameters();
                parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? sd : (object)startDate);
                parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? ed : (object)endDate);
                parameters.Add("@Line", line);
                
                string historyCardFilter = "";
                if (!string.IsNullOrEmpty(historyCard) && historyCard != "ALL")
                {
                    historyCardFilter = " AND s.HistoryCard = @HistoryCard ";
                    parameters.Add("@HistoryCard", historyCard);
                }

                string sql = $@"
                    WITH CombinedBiometrics AS (
                        -- Historical
                        SELECT [Station_No], [Station_Name] AS Station_Number, [EmployeeId], [ShiftName], [BioMetricDate] AS PunchDateTime
                        FROM [HISTORYCARDLINE02].[EHC].[BioMetric_Historical]
                        WHERE [BioMetricDate] BETWEEN @StartDate AND @EndDate
                        
                        UNION ALL
                        
                        -- Current Shift
                        SELECT [Station_No], [Station_Name] AS Station_Number, [EmployeeId], [ShiftName], [LastPunchDateTime] AS PunchDateTime
                        FROM [HISTORYCARDLINE02].[EHC].[BioMetric_CurrentShift]
                        WHERE [LastPunchDateTime] BETWEEN @StartDate AND @EndDate

                        UNION ALL
                        
                        -- Pre Shift
                        SELECT [Station_No], [Station_Name] AS Station_Number, [EmployeeId], [ShiftName], [PunchDateTime]
                        FROM [HISTORYCARDLINE02].[EHC].[BioMetric_PreShift]
                        WHERE [PunchDateTime] BETWEEN @StartDate AND @EndDate
                    )
                    SELECT 
                        b.Station_No AS StationID,
                        b.Station_Number AS StationNumber,
                        s.StationName,
                        s.StationType,
                        b.PunchDateTime,
                        b.ShiftName AS Shift,
                        b.EmployeeId AS EmployeeID,
                        '' AS EmployeeName
                    FROM CombinedBiometrics b
                    INNER JOIN [HISTORYCARDLINE02].[EHC].[Vallam_StationMaster] s 
                        ON s.UnifiedStationName = b.Station_Number 
                        AND s.Line = @Line 
                        {historyCardFilter}
                        AND s.ToDate > GETDATE()
                    ORDER BY b.Station_No ASC
                ";

                var result = await connection.QueryAsync<BiometricReport>(
                    sql,
                    parameters,
                    commandType: CommandType.Text
                );

                return result;
            }
        }

        public async Task<IEnumerable<MainLineCycleTimeReport>> GetMainLineCycleTimeReportAsync(string startDate, string endDate)
        {
            using (var connection = new SqlConnection(_mainlineConnectionString))
            {
                var parameters = new DynamicParameters();
                parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? sd : (object)startDate);
                parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? ed : (object)endDate);

                string sql = @"
                    SELECT 
                        Date_Time,
                        ST1_CycleTime, ST2_CycleTime, ST3_CycleTime, ST4_CycleTime, ST5_CycleTime, ST6_CycleTime, ST7_CycleTime, ST8_CycleTime, ST9_CycleTime, ST10_CycleTime,
                        ST11_CycleTime, ST12_CycleTime, ST13_CycleTime, ST14_CycleTime, ST15_CycleTime, ST16_CycleTime, ST17_CycleTime, ST18_CycleTime, ST19_CycleTime, ST20_CycleTime,
                        ST21_CycleTime, ST22_CycleTime, ST23_CycleTime, ST24_CycleTime, ST25_CycleTime, ST26_CycleTime, ST27_CycleTime, ST28_CycleTime, ST29_CycleTime, ST30_CycleTime,
                        ST31_CycleTime, ST32_CycleTime, ST33_CycleTime, ST34_CycleTime, ST35_CycleTime, ST36_CycleTime, ST37_CycleTime, ST38_CycleTime, ST39_CycleTime, ST40_CycleTime,
                        ST41_CycleTime, ST42_CycleTime, ST43_CycleTime, ST44_CycleTime, ST45_CycleTime, ST46_CycleTime, ST47_CycleTime, ST48_CycleTime, ST49_CycleTime, ST50_CycleTime,
                        ST51_CycleTime, ST52_CycleTime, ST53_CycleTime, ST54_CycleTime, Max_CycleTime, Max_STN_Name
                    FROM STN_CycleTime
                    WHERE Date_Time >= @StartDate AND Date_Time <= @EndDate
                    ORDER BY Date_Time DESC";

                var result = await connection.QueryAsync<MainLineCycleTimeReport>(
                    sql,
                    parameters,
                    commandType: CommandType.Text
                );

                return result;
            }
        }

        public async Task<IEnumerable<string>> GetPokeYokeHistoryCardsAsync(string line)
        {
            using (var connection = new SqlConnection(_pokeYokeFilterConnectionString))
            {
                var parameters = new DynamicParameters();
                parameters.Add("@Line", line);

                string sql = "select distinct HistoryCard from ehc.Vallam_StationMaster where line = @Line";

                var result = await connection.QueryAsync<string>(
                    sql,
                    parameters,
                    commandType: CommandType.Text
                );

                return result;
            }
        }
        public async Task<IEnumerable<string>> GetPokeYokeStationsAsync(string line, string historyCard)
        {
            using (var connection = new SqlConnection(_pokeYokeFilterConnectionString))
            {
                var parameters = new DynamicParameters();
                parameters.Add("@Line", line);
                parameters.Add("@HistoryCard", historyCard);

                string sql = "select distinct UnifiedStationName from ehc.Vallam_StationMaster where line = @Line and HistoryCard = @HistoryCard";

                var result = await connection.QueryAsync<string>(
                    sql,
                    parameters,
                    commandType: CommandType.Text
                );

                return result;
            }
        }

        public async Task<IEnumerable<PokeYokeReport>> GetPokeYokeReportAsync(string line, string historyCard, string? station, string? startDate, string? endDate, string? engineNo = null)
        {
            var allReports = new List<PokeYokeReport>();
            bool isEngMode = !string.IsNullOrWhiteSpace(engineNo);

            List<dynamic> tags;
            using (var connection = new SqlConnection(_pokeYokeFilterConnectionString))
            {
                var parameters = new DynamicParameters();
                parameters.Add("@Line", line);
                parameters.Add("@HistoryCard", historyCard);

                string sql = @"
                    SELECT Description, StationNumber, DatabaseName, DbName, TagName
                    FROM ehc.Vallam_TagMaster
                    WHERE Line = @Line 
                    AND HistoryCard = @HistoryCard 
                    AND PokeYokeCheckPoints = 'YES'
                    AND ToDate > GETDATE()";

                if (!isEngMode && !string.IsNullOrWhiteSpace(station))
                {
                    var stationList = station.Split(',').Select(s => s.Trim()).ToList();
                    sql += " AND StationNumber IN @Stations";
                    parameters.Add("@Stations", stationList);
                }

                tags = (await connection.QueryAsync(sql, parameters, commandType: CommandType.Text)).ToList();
            }

            var parsedTags = tags.Select(t => new {
                DatabaseName = (string)(t.DatabaseName ?? ""),
                DbName = (string)(t.DbName ?? ""),
                StationNumber = (string)(t.StationNumber ?? ""),
                Description = (string)(t.Description ?? ""),
                TagName = (string)(t.TagName ?? "")
            }).ToList();

            var groupedTags = parsedTags.GroupBy(t => new { 
                t.DatabaseName, 
                t.DbName 
            });

            foreach (var group in groupedTags)
            {
                string databaseName = group.Key.DatabaseName.Replace("[", "").Replace("]", "").TrimEnd('.');
                string dbName = group.Key.DbName.Replace("[", "").Replace("]", "").Replace("dbo.", "");

                var unionQueries = new List<string>();
                var activeStations = new HashSet<string>();

                var stationGroups = group.GroupBy(t => new { t.StationNumber, t.Description });

                foreach (var stnGroup in stationGroups)
                {
                    string currentStation = stnGroup.Key.StationNumber;
                    string safeStation = currentStation.Replace("'", "''");
                    
                    string currentDescription = stnGroup.Key.Description;
                    string safeDescription = currentDescription.Replace("'", "''");

                    activeStations.Add($"'{safeStation}'");

                    var conditions = new List<string>();
                    foreach (var tag in stnGroup)
                    {
                        string tagName = tag.TagName;
                        string lowerTag = tagName.ToLower();

                        if (lowerTag.Contains("barcode"))
                        {
                            conditions.Add($"([{tagName}] IS NULL OR LTRIM(RTRIM([{tagName}])) = '' OR [{tagName}] = 'null')");
                        }
                        else
                        {
                            conditions.Add($"[{tagName}] = 'BYPASSED'");
                        }
                    }

                    if (conditions.Any())
                    {
                        string combinedTags = string.Join(" OR ", conditions);
                        unionQueries.Add($"SELECT '{safeDescription}' as [Description] WHERE Stn_Number = '{safeStation}' AND ({combinedTags})");
                    }
                }

                if (!unionQueries.Any())
                {
                    continue; // Skip if no valid tags in this DB
                }

                string crossApplySql = string.Join(" UNION ALL ", unionQueries);
                string inStations = string.Join(",", activeStations);

                using (var connection = new SqlConnection(_pokeYokeDataConnectionString))
                {
                    var parameters = new DynamicParameters();

                    string sql = $@"
                        SELECT [Date_Time], [Stn_Number], [Engine_Number], v.[Description]
                        FROM [{databaseName}].[dbo].[{dbName}]
                        CROSS APPLY (
                            {crossApplySql}
                        ) v
                        WHERE Stn_Number IN ({inStations})";

                    if (isEngMode)
                    {
                        sql += " AND Engine_Number = @EngineNo";
                        parameters.Add("@EngineNo", engineNo);
                    }
                    else
                    {
                        sql += " AND Date_Time BETWEEN @StartDate AND @EndDate";
                        parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? (object)sd : (object?)startDate);
                        parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? (object)ed : (object?)endDate);
                    }

                    try
                    {
                        var result = await connection.QueryAsync<PokeYokeReport>(
                            sql,
                            parameters,
                            commandType: CommandType.Text
                        );
                        allReports.AddRange(result);
                    }
                    catch (Exception ex)
                    {
                        // Safely ignore queries on tables that might be missing the column or don't exist
                        Console.WriteLine($"Error querying {databaseName}.{dbName} for grouped tags: {ex.Message}");
                    }
                }
            }

            return allReports.OrderByDescending(r => r.Date_Time);
        }

        public async Task<IEnumerable<PokeYokeSummaryReport>> GetPokeYokeSummaryReportAsync(string line, string historyCard, string? station, string? startDate, string? endDate)
        {
            var allReports = new List<PokeYokeSummaryReport>();

            List<dynamic> tags;
            using (var connection = new SqlConnection(_pokeYokeFilterConnectionString))
            {
                var parameters = new DynamicParameters();
                parameters.Add("@Line", line);
                parameters.Add("@HistoryCard", historyCard);

                string sql = @"
                    SELECT Description, StationNumber, DatabaseName, DbName, TagName
                    FROM ehc.Vallam_TagMaster
                    WHERE Line = @Line 
                    AND HistoryCard = @HistoryCard 
                    AND PokeYokeCheckPoints = 'YES'
                    AND ToDate > GETDATE()";

                if (!string.IsNullOrWhiteSpace(station))
                {
                    var stationList = station.Split(',').Select(s => s.Trim()).ToList();
                    sql += " AND StationNumber IN @Stations";
                    parameters.Add("@Stations", stationList);
                }

                tags = (await connection.QueryAsync(sql, parameters, commandType: CommandType.Text)).ToList();
            }

            var parsedTags = tags.Select(t => new {
                DatabaseName = (string)(t.DatabaseName ?? ""),
                DbName = (string)(t.DbName ?? ""),
                StationNumber = (string)(t.StationNumber ?? ""),
                Description = (string)(t.Description ?? ""),
                TagName = (string)(t.TagName ?? "")
            }).ToList();

            var groupedTags = parsedTags.GroupBy(t => new { t.DatabaseName, t.DbName });

            foreach (var group in groupedTags)
            {
                string databaseName = group.Key.DatabaseName.Replace("[", "").Replace("]", "").TrimEnd('.');
                string dbName = group.Key.DbName.Replace("[", "").Replace("]", "").Replace("dbo.", "");

                var unionQueries = new List<string>();
                var activeStations = new HashSet<string>();

                var stationGroups = group.GroupBy(t => new { t.StationNumber, t.Description });

                foreach (var stnGroup in stationGroups)
                {
                    string currentStation = stnGroup.Key.StationNumber;
                    string safeStation = currentStation.Replace("'", "''");
                    
                    string currentDescription = stnGroup.Key.Description;
                    string safeDescription = currentDescription.Replace("'", "''");

                    activeStations.Add($"'{safeStation}'");

                    var conditions = new List<string>();
                    foreach (var tag in stnGroup)
                    {
                        string tagName = tag.TagName;
                        string lowerTag = tagName.ToLower();

                        if (lowerTag.Contains("barcode"))
                        {
                            conditions.Add($"([{tagName}] IS NULL OR LTRIM(RTRIM([{tagName}])) = '' OR [{tagName}] = 'null')");
                        }
                        else
                        {
                            conditions.Add($"[{tagName}] = 'BYPASSED'");
                        }
                    }

                    if (conditions.Any())
                    {
                        string combinedTags = string.Join(" OR ", conditions);
                        unionQueries.Add($"SELECT '{safeDescription}' as [Description], CASE WHEN ({combinedTags}) THEN 1 ELSE 0 END as [IsFailure]");
                    }
                }

                if (!unionQueries.Any())
                {
                    continue; // Skip if no valid tags in this DB
                }

                string crossApplySql = string.Join(" UNION ALL ", unionQueries);
                string inStations = string.Join(",", activeStations);

                using (var connection = new SqlConnection(_pokeYokeDataConnectionString))
                {
                    var parameters = new DynamicParameters();

                    string sql = $@"
                        WITH RawData AS (
                            SELECT [Date_Time], [Stn_Number], [Engine_Number], v.[Description], v.[IsFailure]
                            FROM [{databaseName}].[dbo].[{dbName}]
                            CROSS APPLY (
                                {crossApplySql}
                            ) v
                            WHERE Stn_Number IN ({inStations})
                            AND Date_Time BETWEEN @StartDate AND @EndDate
                        ),
                        IslandPrep AS (
                            SELECT *,
                                ROW_NUMBER() OVER(PARTITION BY [Stn_Number], [Description] ORDER BY [Date_Time]) as seq_all,
                                ROW_NUMBER() OVER(PARTITION BY [Stn_Number], [Description], [IsFailure] ORDER BY [Date_Time]) as seq_fail
                            FROM RawData
                        ),
                        Islands AS (
                            SELECT *, (seq_all - seq_fail) as IslandId,
                            FIRST_VALUE(Engine_Number) OVER(PARTITION BY [Stn_Number], [Description], (seq_all - seq_fail) ORDER BY [Date_Time] ASC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as StartEng,
                            FIRST_VALUE(Engine_Number) OVER(PARTITION BY [Stn_Number], [Description], (seq_all - seq_fail) ORDER BY [Date_Time] DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as EndEng
                            FROM IslandPrep
                            WHERE IsFailure = 1
                        )
                        SELECT 
                            [Stn_Number] as StationNumber, 
                            [Description] as StationDescription, 
                            MIN([Date_Time]) as StartingDatetime, 
                            MAX([Date_Time]) as EndingDatetime, 
                            MAX(StartEng) as StartingEngineNumber, 
                            MAX(EndEng) as EndingEngineNumber, 
                            COUNT(*) as NoOfEngines,
                            DATEDIFF(SECOND, MIN([Date_Time]), MAX([Date_Time])) as DurationSeconds
                        FROM Islands
                        GROUP BY [Stn_Number], [Description], IslandId";

                    parameters.Add("@StartDate", DateTime.TryParse(startDate, out var sd) ? (object)sd : (object?)startDate);
                    parameters.Add("@EndDate", DateTime.TryParse(endDate, out var ed) ? (object)ed : (object?)endDate);

                    try
                    {
                        var result = await connection.QueryAsync<PokeYokeSummaryReport>(
                            sql, 
                            parameters,
                            commandTimeout: 120
                        );
                        allReports.AddRange(result);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error querying {databaseName}.{dbName} for gaps and islands: {ex.Message}");
                    }
                }
            }

            return allReports.OrderByDescending(r => r.StartingDatetime);
        }

        public async Task<IEnumerable<BiometricEngineBarcodeReport>> GetBiometricEngineBarcodeReportAsync(string line, string historyCard, string value)
        {
            var results = new List<BiometricEngineBarcodeReport>();

            using var connection = new SqlConnection(_pokeYokeDataConnectionString);

            // Step 1 + 5: resolve stations (+ name/type) for this Line/HC
            var stationParams = new DynamicParameters();
            stationParams.Add("@Line", line);
            stationParams.Add("@HistoryCard", historyCard);

            string stationSql = @"
                SELECT UnifiedStationName, DatabaseName, DbName, StationName, StationType
                FROM [HISTORYCARDLINE02].[EHC].[Vallam_StationMaster]
                WHERE Line = @Line AND HistoryCard = @HistoryCard AND ToDate > GETDATE()";

            var stations = (await connection.QueryAsync(stationSql, stationParams)).ToList();
            if (!stations.Any()) return results;

            var stationMeta = stations.ToDictionary(
                s => (string)s.UnifiedStationName,
                s => ((string)(s.StationName ?? ""), (string)(s.StationType ?? "")));

            var groups = stations.GroupBy(s => new
            {
                DatabaseName = ((string)s.DatabaseName).Replace("[", "").Replace("]", "").TrimEnd('.'),
                DbName = ((string)s.DbName).Replace("[", "").Replace("]", "").Replace("dbo.", "")
            });

            var shiftsSection = _configuration.GetSection("ShiftConfiguration:Shifts");

            foreach (var group in groups)
            {
                var stationNames = group.Select(s => (string)s.UnifiedStationName).Distinct().ToList();

                var dataParams = new DynamicParameters();
                dataParams.Add("@Value", value);
                var stnPlaceholders = new List<string>();
                for (int i = 0; i < stationNames.Count; i++)
                {
                    stnPlaceholders.Add($"@Stn{i}");
                    dataParams.Add($"@Stn{i}", stationNames[i]);
                }

                string eventSql = $@"
                    SELECT Date_Time, Stn_Number
                    FROM [{group.Key.DatabaseName}].[dbo].[{group.Key.DbName}]
                    WHERE Stn_Number IN ({string.Join(",", stnPlaceholders)})
                    AND (Engine_Number = @Value OR Barcode_1 = @Value OR Barcode_2 = @Value OR Barcode_3 = @Value)";

                List<dynamic> events;
                try
                {
                    events = (await connection.QueryAsync(eventSql, dataParams)).ToList();
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error querying {group.Key.DatabaseName}.{group.Key.DbName} for engine/barcode: {ex.Message}");
                    continue;
                }

                foreach (var ev in events)
                {
                    DateTime eventTime = ev.Date_Time;
                    string stnNumber = (string)ev.Stn_Number;
                    var (shiftName, shiftStart) = ResolveShiftStart(eventTime, shiftsSection);
                    var (stationName, stationType) = stationMeta.TryGetValue(stnNumber, out var meta) ? meta : ("", "");

                    var bioParams = new DynamicParameters();
                    bioParams.Add("@ShiftStart", shiftStart);
                    bioParams.Add("@EventDateTime", eventTime);
                    bioParams.Add("@Station", stnNumber);

                    // Reuses the same Historical/CurrentShift/PreShift UNION ALL shape as the Biometric Shiftwise report,
                    // bounded to [shift start, event time] instead of an arbitrary date range.
                    string bioSql = @"
                        WITH CombinedBiometrics AS (
                            SELECT [Station_No], [Station_Name] AS Station_Number, [EmployeeId], [ShiftName], [BioMetricDate] AS PunchDateTime
                            FROM [HISTORYCARDLINE02].[EHC].[BioMetric_Historical]
                            WHERE [Station_Name] = @Station AND [BioMetricDate] BETWEEN @ShiftStart AND @EventDateTime

                            UNION ALL

                            SELECT [Station_No], [Station_Name] AS Station_Number, [EmployeeId], [ShiftName], [LastPunchDateTime] AS PunchDateTime
                            FROM [HISTORYCARDLINE02].[EHC].[BioMetric_CurrentShift]
                            WHERE [Station_Name] = @Station AND [LastPunchDateTime] BETWEEN @ShiftStart AND @EventDateTime

                            UNION ALL

                            SELECT [Station_No], [Station_Name] AS Station_Number, [EmployeeId], [ShiftName], [PunchDateTime]
                            FROM [HISTORYCARDLINE02].[EHC].[BioMetric_PreShift]
                            WHERE [Station_Name] = @Station AND [PunchDateTime] BETWEEN @ShiftStart AND @EventDateTime
                        )
                        SELECT [Station_No], Station_Number, [EmployeeId], [ShiftName], PunchDateTime
                        FROM CombinedBiometrics
                        ORDER BY PunchDateTime DESC";

                    try
                    {
                        var bioRows = await connection.QueryAsync(bioSql, bioParams);
                        foreach (var row in bioRows)
                        {
                            results.Add(new BiometricEngineBarcodeReport
                            {
                                StationID = row.Station_No?.ToString(),
                                StationNumber = row.Station_Number?.ToString(),
                                StationName = stationName,
                                StationType = stationType,
                                PunchDateTime = row.PunchDateTime,
                                Shift = row.ShiftName?.ToString(),
                                EmployeeID = row.EmployeeId?.ToString(),
                                EngineNoOrBarcode = value
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error querying biometric data for station {stnNumber}: {ex.Message}");
                    }
                }
            }

            return results.OrderByDescending(r => r.PunchDateTime);
        }
    }
}
