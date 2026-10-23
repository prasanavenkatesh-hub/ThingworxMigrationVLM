namespace ControlTower.Models;

// One row of result sets 1-3 of dbo.usp_GetSubAssemblyReport: counts per production day / shift /
// station (/ crankshaft cell or OP-60 DIPV_10_Status in SubGroup).
public class SubAssemblyCountRow
{
    public DateTime ProductionDate { get; set; }
    public string? Shift { get; set; }
    public string? Station { get; set; }
    public string? SubGroup { get; set; }
    public int OkQty { get; set; }
    public int NokQty { get; set; }
    public int IncompleteQty { get; set; }
    public int NotAcceptedQty { get; set; }
    public int ActualQty { get; set; }
}

// One row of result set 4 (Rework_DB entries).
public class SubAssemblyReworkRow
{
    public DateTime ProductionDate { get; set; }
    public string? Shift { get; set; }
    public string? Station { get; set; }
    public int OkQty { get; set; }
    public int NokQty { get; set; }
    public int DistinctEngines { get; set; }
}

// One row of result set 5: a reworked engine per shift / station, so the page can count distinct
// engines over the whole range (set 4's DistinctEngines is per production day / shift).
public class SubAssemblyReworkEngineRow
{
    public string? Shift { get; set; }
    public string? Station { get; set; }
    public string? Engine { get; set; }
}

public class SubAssemblyReportData
{
    public string SubAssembly { get; set; } = "";
    // Straight Pass table rows: each part's latest result per status (Power BI "<X>_SA" tables).
    public List<SubAssemblyCountRow> Assy { get; set; } = new();
    // Each part's first attempt (Power BI "<X>_StraightPass" tables) -> Straight Pass % / Rejection %.
    public List<SubAssemblyCountRow> StraightPass { get; set; } = new();
    public List<SubAssemblyCountRow> Bypassed { get; set; } = new();
    public List<SubAssemblyReworkRow> Rework { get; set; } = new();
    // Null when the deployed proc predates result set 5 (the page then sums the per-shift counts).
    public List<SubAssemblyReworkEngineRow>? ReworkEngines { get; set; }
}
