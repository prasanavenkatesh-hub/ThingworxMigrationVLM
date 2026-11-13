using ControlTower.Models;

namespace ControlTower.Services;

// One filter of an Engine Station report.
//   Key              - JSON key used by the frontend (request "filters" and the /filters response)
//   Parameter        - the stored procedure parameter (source: EngineAssemblyConfigRepository)
//   MaxLength        - the parameter's NVARCHAR length in characters (-1 = NVARCHAR(MAX)); a longer
//                      comma-joined value is rejected with 400 instead of being silently truncated
//   FilterDataColumn - the ..._FilterData proc column that feeds this filter's options
//                      (null = not offered by /filters, e.g. engine numbers come from /engine-numbers)
public sealed record EngineStationFilterDef(string Key, string Parameter, int MaxLength, string? FilterDataColumn);

// Whitelist of the three Engine Station reports. Procedure and table names come only from here and
// from the canonical Lines / Modes below - request text is never concatenated into a SQL name.
public sealed class EngineStationReportDef
{
    public required string Key { get; init; }                 // route segment {report}
    public required string ProcPrefix { get; init; }          // + "{line}_{mode}" / "{line}_FilterData"
    public required IReadOnlyDictionary<string, string> MasterTables { get; init; } // line -> table
    public required bool DateIsText { get; init; }            // master table DATE is NVARCHAR (Test Bed)
    public required Type RowType { get; init; }
    public required IReadOnlyList<EngineStationFilterDef> Filters { get; init; }
    public string? NoticeSection { get; init; }               // EngineStationReports:<section>:<line>

    public string DataProcedure(string line, string mode) => $"dbo.{ProcPrefix}{line}_{mode}";
    public string FilterDataProcedure(string line) => $"dbo.{ProcPrefix}{line}_FilterData";
}

public static class EngineStationReportDefinitions
{
    public static readonly string[] Lines = { "EA01", "EA02" };
    public static readonly string[] Modes = { "OverAll", "Distinct", "Duplicates" };

    private const int Max = -1;

    // Parameter lists and order as EngineAssemblyConfigRepository.GetEngineTestBedReportData.
    // All filter parameters are NVARCHAR(MAX) (Sql/Get_EngineTestBed_EA0x_*.sql).
    public static readonly EngineStationReportDef TestBed = new()
    {
        Key = "engine-testbed",
        ProcPrefix = "Get_EngineTestBed_",
        MasterTables = new Dictionary<string, string>
        {
            ["EA01"] = "Engine_TestBed_Master_EA01",
            ["EA02"] = "Engine_TestBed_Master_EA02"
        },
        DateIsText = true,
        RowType = typeof(EngineStationTestBedRow),
        Filters = new EngineStationFilterDef[]
        {
            new("shiftCode", "@ShiftCode", Max, "ShiftCode"),
            new("modelCode", "@ModelCode", Max, "ModelCode"),
            new("engineNumber", "@EngineNumber", Max, null),
            new("defectDetails", "@DefectDetails", Max, "DefectDetails"),
            new("reworkDetails", "@ReworkDetails", Max, "ReworkDetails"),
            new("testingResult", "@TestingResult", Max, "TestingResult"),
            new("bedNo", "@BedNo", Max, "BedNo"),
            new("noOfTimes", "@NoOfTimes", Max, "NoOfTimes"),
            new("lhDbValue", "@LhDbValue", Max, "LhDbValue"),
            new("rhDbValue", "@RhDbValue", Max, "RhDbValue")
        }
    };

    // Parameter lists and order as EngineAssemblyConfigRepository.GetLeakStationData. Lengths are the
    // procs' NVARCHAR(n) declarations (Sql/Get_EngineLeak_Report_EA0x_*.sql, same on both lines).
    // Filter-data columns: LeakValue1 = LEAK_PA, LeakMachine = Leak2, LeakValue2 = Leak3.
    public static readonly EngineStationReportDef Leak = new()
    {
        Key = "leak-station",
        ProcPrefix = "Get_EngineLeak_Report_",
        MasterTables = new Dictionary<string, string>
        {
            ["EA01"] = "Engine_Leak_Master_EA01",
            ["EA02"] = "Engine_Leak_Master_EA02"
        },
        DateIsText = false,
        RowType = typeof(EngineStationLeakRow),
        NoticeSection = "LeakNotice",
        Filters = new EngineStationFilterDef[]
        {
            new("shiftCode", "@ShiftCode", 100, "ShiftCode"),
            new("modelCode", "@ModelCode", 500, "ModelCode"),
            new("engineNumber", "@EngineNumber", Max, null),
            new("station", "@Station", 500, "Station"),
            new("defectWise", "@DefectWise", 1000, "DefectWise"),
            new("reworkDetails", "@ReworkDetails", 2000, "ReworkDetails"),
            new("result", "@Result", 100, "Result"),
            new("leak1_Status", "@Leak1_Status", 100, "Leak1_Status"),
            new("leakValue1", "@LeakValue1", 200, "LeakValue1"),
            new("leakValue2", "@LeakValue2", 200, "LeakValue2"),
            new("leakMachine", "@LeakMachine", 500, "LeakMachine"),
            new("modelShortCode", "@ModelShortCode", 500, "ModelShortCode")
        }
    };

    // Parameter lists and order as EngineAssemblyConfigRepository.GetPDIStationReportData.
    // All filter parameters are NVARCHAR(MAX) (Sql/Get_PDI_Report_EA0x_*.sql).
    public static readonly EngineStationReportDef Pdi = new()
    {
        Key = "pdi-station",
        ProcPrefix = "Get_PDI_Report_",
        MasterTables = new Dictionary<string, string>
        {
            ["EA01"] = "PDI_Report_Master_EA01",
            ["EA02"] = "PDI_Report_Master_EA02"
        },
        DateIsText = false,
        RowType = typeof(EngineStationPdiRow),
        Filters = new EngineStationFilterDef[]
        {
            new("shiftCode", "@ShiftCode", Max, "ShiftCode"),
            new("modelCode", "@ModelCode", Max, "ModelCode"),
            new("engineNumber", "@EngineNumber", Max, null),
            new("pdiDefect", "@PDIDefect", Max, "PDIDefect"),
            new("reworkDetails", "@ReworkDetails", Max, "ReworkDetails"),
            new("pdiResult", "@PDIResult", Max, "PDIResult"),
            new("leakValuePA", "@LeakValuePA", Max, "LeakValuePA")
        }
    };

    public static readonly IReadOnlyDictionary<string, EngineStationReportDef> All =
        new Dictionary<string, EngineStationReportDef>(StringComparer.OrdinalIgnoreCase)
        {
            [TestBed.Key] = TestBed,
            [Leak.Key] = Leak,
            [Pdi.Key] = Pdi
        };

    public static EngineStationReportDef? Find(string? report) =>
        report != null && All.TryGetValue(report, out var def) ? def : null;

    // Canonical spelling of a whitelisted line / mode (case-insensitive), or null.
    public static string? CanonicalLine(string? line) =>
        Lines.FirstOrDefault(l => l.Equals(line?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static string? CanonicalMode(string? mode) =>
        Modes.FirstOrDefault(m => m.Equals(mode?.Trim(), StringComparison.OrdinalIgnoreCase));
}
