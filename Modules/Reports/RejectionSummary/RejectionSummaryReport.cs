namespace ControlTower.Models;

// One row of dbo.usp_GetRejectionSummaryReport. Main Line rows fill the engine columns, Sub Assembly
// rows fill the SA columns; Date, Shift and ReworkDetails are common to both.
public class RejectionSummaryRow
{
    public DateTime? Date { get; set; }
    public string? Shift { get; set; }
    public string? ReworkDetails { get; set; }

    // Main Line (STN_data rejections + ML-Rework entry)
    public string? EngineNumber { get; set; }
    public string? Model { get; set; }
    public string? RejectionStation { get; set; }
    public string? RejectionDetails { get; set; }
    public string? RootCause { get; set; }
    public string? Category { get; set; }
    public string? Supplier { get; set; }
    public string? ReloadStation { get; set; }
    public DateTime? ReworkDate { get; set; }
    public string? ReworkedBy { get; set; }
    public string? VerifiedBy { get; set; }

    // Sub Assembly (Rework_DB at SA-Rework / CC-Rework)
    public string? StationNo { get; set; }
    public string? SaSerialNo { get; set; }
    public string? Defect { get; set; }
    public string? NoOfTime { get; set; }
    public string? TorqueStatus { get; set; }
    public string? ProdEmpId { get; set; }
    public string? QcEmpId { get; set; }
}

public class RejectionSummaryData
{
    public string Line { get; set; } = "";
    public string Section { get; set; } = "";
    // False when the line has no connection string yet (EA01 today) - the page says "no data yet".
    public bool Available { get; set; }
    public List<RejectionSummaryRow> Rows { get; set; } = new();
}
