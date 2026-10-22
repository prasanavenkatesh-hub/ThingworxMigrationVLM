namespace ControlTower.Services;

// appsettings "PokaYoke" section. One entry under Lines per screen (key = the API's {line}).
public class PokaYokeSettings
{
    public int RefreshSeconds { get; set; } = 60;
    public int QueryTimeoutSeconds { get; set; } = 60;
    // Station-table queries run at the same time during one refresh.
    public int MaxParallelQueries { get; set; } = 4;
    public Dictionary<string, PokaYokeLineSettings> Lines { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public class PokaYokeLineSettings
{
    // Line value in the tag master (e.g. "JEA1", "JEA2").
    public string Line { get; set; } = "";
    // Tag master table: database + "Schema.Table".
    public string TagMasterDatabase { get; set; } = "";
    public string TagMasterTable { get; set; } = "EHC.Vallam_TagMaster";
    // Only these history cards (empty = all), e.g. "14 CrankShaft" for the Crankshaft screen.
    public List<string> IncludedHistoryCards { get; set; } = new();
    public List<string> ExcludedHistoryCards { get; set; } = new();
    public List<string> ExcludedStations { get; set; } = new();
    // Stations left out of the line total (the summary donut / HC table).
    public List<string> SummaryExcludedStations { get; set; } = new();
    // Tag-master station number -> station number reported (e.g. "SA-21E_New" -> "SA-21E").
    public Dictionary<string, string> StationAliases { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    // Checkpoint values that count as Manual Inspection / that are skipped (besides empty).
    public List<string> MiValues { get; set; } = new() { "BYPASSED" };
    public List<string> IgnoredValues { get; set; } = new() { "NA" };
    public List<PokaYokeSourceSettings> Sources { get; set; } = new();
    // Screens with several identical cells (Crankshaft): null for the line screens.
    public PokaYokeCellSettings? Cells { get; set; }
}

// Crankshaft (port of getPokeYokeLiveStatusForIndivisualStationForJEA1_CrankSaft): every tag of a
// station listed in StationNames is read once per cell - the source's StationColumn is the cell
// column (Cell_Number) and its value one of Values - and reported as station "C<cell>-<name>"
// (e.g. tag-master station 33 in cell 1 -> "C1-OP-10").
public class PokaYokeCellSettings
{
    public List<string> Values { get; set; } = new();
    // Tag-master station number -> station name on the screen ("33" -> "OP-10").
    public Dictionary<string, string> StationNames { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

// How to read the latest record of a group of station tables (port of the ThingWorx
// getPokeYokevalue / getPokeYokevalue_Other / report_getPokeYokevalue_OtherByDateGearTrainJEA1
// calls). Tables are "Database.Table" (schema dbo) or "Database.Schema.Table". Only listed tables
// are ever queried.
public class PokaYokeSourceSettings
{
    public List<string> Tables { get; set; } = new();
    // Column holding the station number; null = one table per station (no station filter).
    public string? StationColumn { get; set; }
    // Only the latest record with StatusColumn = StatusOkValue is read; null = latest record.
    public string? StatusColumn { get; set; }
    public string StatusOkValue { get; set; } = "OK";
    public string OrderByColumn { get; set; } = "id";
    // Search only the newest N rows (OrderByColumn must be a numeric id); null = whole table.
    // A station with no OK record in that window shows no value.
    public long? ScanLastRows { get; set; }
    // Overrides the line's MiValues for these tables (gear train: "OFF").
    public List<string>? MiValues { get; set; }
}
