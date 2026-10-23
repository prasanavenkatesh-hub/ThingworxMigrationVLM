namespace ControlTower.Models;

// Filters of the Process/Product Parameter Report (all optional except the dates).
public class ProcessParameterFilter
{
    public string Section { get; set; } = "ML";        // ML = Vallam - MainLine, QH = Vallam - QHold, DUP = Duplicate of MainLine
    public DateTime FromDate { get; set; }              // calendar dates, both inclusive (Power BI "Date" column)
    public DateTime ToDate { get; set; }
    public string? Shift { get; set; }                  // A | B | C
    public int? Hour { get; set; }                      // Time Range "07-08" -> 7, "24-01" -> 0
    public string? Station { get; set; }
    public string? Engine { get; set; }                 // contains
    public string? Status { get; set; }
    public List<string> Columns { get; set; } = new();  // whitelisted source columns to return
}

// Row count per station / status for the filters (station filter not applied, so the page can build
// the Station dropdown and the Rows card / Status pie from one query).
public class ProcessParameterGroup
{
    public string? Station { get; set; }
    public string? Status { get; set; }
    public int Rows { get; set; }
}

public class ProcessParameterData
{
    public string Section { get; set; } = "";
    public List<ProcessParameterGroup> Groups { get; set; } = new();
    public int Page { get; set; }
    public int PageSize { get; set; }
    // One page of rows: Date_Time, Shift, Engine_Number, Station + the requested columns
    // (Duplicate: Date_Time, Shift, Engine_Number, Barcode_2, Station_Status, DuplicateCount).
    public List<Dictionary<string, object?>> Rows { get; set; } = new();
}
