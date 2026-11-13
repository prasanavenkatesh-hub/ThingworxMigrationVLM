using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ControlTower.Models;

// Engine Station reports (Leak Station / PDI Station / Engine Test Bed) - port of the
// "ThingWorx Migration Quality Reports Merge" MVC app (EngineAssemblyAPIController). Row properties
// are the stored procedures' column aliases (Modules/Reports/EngineStation/Sql/*.sql); Dapper maps
// them case-insensitively and the API serialises them camelCase.

// dbo.Get_EngineTestBed_EA0x_{OverAll|Distinct|Duplicates}. Every column of
// Engine_TestBed_Master_EA0x is NVARCHAR (DATE included: ISO text "yyyy-MM-dd HH:mm:ss").
// ReworkCount is only returned by the Distinct / Duplicates procs (null in OverAll, as in the source).
public class EngineStationTestBedRow
{
    public string? Date { get; set; }
    public string? ShiftCode { get; set; }
    public string? EngineNumber { get; set; }
    public string? ModelCode { get; set; }
    public string? BedNo { get; set; }
    public string? LhDbValue { get; set; }
    public string? RhDbValue { get; set; }
    public string? NoOfTimes { get; set; }
    public string? UserId { get; set; }
    public string? TestingResult { get; set; }
    public string? NotOkBedNo { get; set; }
    public string? DefectDetails { get; set; }
    public string? RootCause { get; set; }
    public string? ReworkDetails { get; set; }
    public string? ReworkTorqueStatus { get; set; }
    public string? PartReplaceDetails { get; set; }
    public string? ReworkOilFillingValue { get; set; }
    public string? Category { get; set; }
    public string? Supplier { get; set; }
    public string? ReworkReloadBedNo { get; set; }
    public string? ReworkCount { get; set; }
    public string? ReworkUserId { get; set; }
    public string? VerifiedQFUserId { get; set; }
}

// dbo.Get_EngineLeak_Report_EA0x_{OverAll|Distinct|Duplicates}. DATE / REWORK_DATE are DATETIME
// columns; they are sent as "yyyy-MM-dd HH:mm:ss" like the Test Bed text dates.
public class EngineStationLeakRow
{
    [JsonConverter(typeof(EngineStationDateTimeJsonConverter))]
    public DateTime? Date { get; set; }
    public string? ShiftCode { get; set; }
    public string? EngineNumber { get; set; }
    public string? ModelShortCode { get; set; }
    public string? ModelCode { get; set; }
    public string? Station { get; set; }
    public string? LeakPa { get; set; }
    public string? Result { get; set; }
    public string? Leak1_Status { get; set; }
    public string? ReworkResult { get; set; }
    public string? LeakDescription { get; set; }
    public string? RootCause { get; set; }
    public string? ReworkDetails { get; set; }
    public string? LeakReworkTorqueStatus { get; set; }
    public string? PartReplaceDetails { get; set; }
    public string? ThrottleBody { get; set; }
    public string? Category { get; set; }
    public string? SupplierGrouping { get; set; }
    public string? ReworkOilFillingValue { get; set; }
    [JsonConverter(typeof(EngineStationDateTimeJsonConverter))]
    public DateTime? ReworkDate { get; set; }
    public string? ReworkShift { get; set; }
    public string? RetestLeakPa { get; set; }
    public string? ReworkedBy { get; set; }
    public string? VerifiedBy { get; set; }
}

// dbo.Get_PDI_Report_EA0x_{OverAll|Distinct|Duplicates}. UserId = the procs' "USERID" alias.
// RootCause is not returned by the EA01 Distinct / Duplicates procs (null there).
public class EngineStationPdiRow
{
    [JsonConverter(typeof(EngineStationDateTimeJsonConverter))]
    public DateTime? Date { get; set; }
    public string? ShiftCode { get; set; }
    public string? EngineNumber { get; set; }
    public string? ModelCode { get; set; }
    public string? PDIStation { get; set; }
    public string? UserId { get; set; }
    public string? PDIResult { get; set; }
    public string? LeakValuePA { get; set; }
    public string? PDIDefect { get; set; }
    public string? RootCause { get; set; }
    public string? ReworkDetails { get; set; }
    public string? ReworkTorqueStatus { get; set; }
    public string? PartReplaceDetails { get; set; }
    public string? ReworkOilFillingValue { get; set; }
    public string? Category { get; set; }
    public string? Supplier { get; set; }
    [JsonConverter(typeof(EngineStationDateTimeJsonConverter))]
    public DateTime? ReworkDate { get; set; }
    public string? ReworkUserId { get; set; }
    public string? VerifiedQFUserId { get; set; }
}

// POST /api/reports/{report}/data body. From / To = JS toISOString() (UTC); Filters = filter key ->
// selected values (each value is sent to the proc comma-joined, NULL when nothing is selected).
public class EngineStationRequest
{
    public string? Line { get; set; }
    public string? Mode { get; set; }
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public Dictionary<string, List<string?>?>? Filters { get; set; }
}

public class EngineStationReportData
{
    public string Report { get; set; } = "";
    public string Line { get; set; } = "";
    public string Mode { get; set; } = "";
    public string Procedure { get; set; } = "";
    public string? Notice { get; set; }
    public int RowCount { get; set; }
    public long DurationMs { get; set; }
    public IReadOnlyList<object> Rows { get; set; } = Array.Empty<object>();
}

public class EngineStationFilterOptions
{
    public string Report { get; set; } = "";
    public string Line { get; set; } = "";
    public Dictionary<string, List<string>> Filters { get; set; } = new();

    // engine-testbed only: Bed Wise column map (EngineStationReports:BedWise).
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? Beds { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? BedWiseLine { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Notice { get; set; }
}

public class EngineStationEngineNumbers
{
    public string Report { get; set; } = "";
    public string Line { get; set; } = "";
    public List<string> EngineNumbers { get; set; } = new();
}

// DATETIME columns -> "yyyy-MM-dd HH:mm:ss" (server-local time, same text as the Test Bed DATE column).
public class EngineStationDateTimeJsonConverter : JsonConverter<DateTime?>
{
    private const string Format = "yyyy-MM-dd HH:mm:ss";

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        var s = reader.GetString();
        return string.IsNullOrWhiteSpace(s) ? null : DateTime.Parse(s, CultureInfo.InvariantCulture);
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value == null) writer.WriteNullValue();
        else writer.WriteStringValue(value.Value.ToString(Format, CultureInfo.InvariantCulture));
    }
}
