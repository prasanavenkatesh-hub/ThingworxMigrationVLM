namespace ControlTower.Models;

public record MachineShopPdiPartInfo(string Id, string Name, string HourlyName, string Station);

// GET /api/machineshop/pdi/hourly: both grids of the Hourly Screen for one date + shift.
public class MachineShopPdiHourly
{
    public string Date { get; set; } = "";
    public string Shift { get; set; } = "";
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    // One label per hour column ("07:15 - 08:14"); "-" for a column the shift does not use.
    public List<string> Hours { get; set; } = new();
    public List<MachineShopPdiHourlyRow> Rows { get; set; } = new();
    public List<MachineShopPdiSummaryRow> Summary { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}

public class MachineShopPdiHourlyRow
{
    public string PartId { get; set; } = "";
    public string Name { get; set; } = "";
    // Rows per hour column; null for a column the shift does not use.
    public List<int?> Counts { get; set; } = new();
    public int Total { get; set; }
}

public class MachineShopPdiSummaryRow
{
    public string PartId { get; set; } = "";
    public string Name { get; set; } = "";
    public int Total { get; set; }
    public int Pass { get; set; }
    public int Fail { get; set; }
}

// GET /api/machineshop/pdi/rejections: rejection reasons of one part for one date + shift.
public class MachineShopPdiRejections
{
    public string PartId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Date { get; set; } = "";
    public string Shift { get; set; } = "";
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public List<MachineShopPdiReason> Reasons { get; set; } = new();
}

public record MachineShopPdiReason(string Reason, int Count);

// GET /api/machineshop/pdi/part: a part tab (e.g. Crankcase) for one production day - Produced / OK / NOK
// per cell for each shift, and the day totals.
public class MachineShopPdiPartDay
{
    public string PartId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Date { get; set; } = "";
    public List<string> Cells { get; set; } = new();
    // The tab has a Report button (MachineShop:Pdi:Report:Parts).
    public bool Report { get; set; }
    // Side names (Crankshaft: LH, RH); empty when the cells are not split.
    public List<string> Sides { get; set; } = new();
    // Grid column labels, same order as the Counts lists: "CELL 1", or "CELL 1 LH", "CELL 1 RH", ... with sides.
    public List<string> Columns { get; set; } = new();
    public List<MachineShopPdiShiftCounts> Shifts { get; set; } = new();
    public MachineShopPdiCounts Total { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}

// GET /api/machineshop/pdi/summary: the PDI Summary tab for one production day - Produced / OK / NOK per
// part (Counts lists in Parts order) for each shift, and the day totals (pies).
public class MachineShopPdiSummaryDay
{
    public string Title { get; set; } = "";
    public string Date { get; set; } = "";
    public List<MachineShopPdiSummaryPart> Parts { get; set; } = new();
    public List<MachineShopPdiShiftCounts> Shifts { get; set; } = new();
    public MachineShopPdiCounts Total { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}

// GET /api/machineshop/pdi/report: rows of one cell of a part's station (PDI Report pop-up).
public class MachineShopPdiReport
{
    public string PartId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Cell { get; set; } = "";
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public List<string> Shifts { get; set; } = new();
    public List<string> Statuses { get; set; } = new();
    public List<MachineShopPdiReportRow> Rows { get; set; } = new();
    // More rows matched than MaxRows; Rows holds the first MaxRows.
    public bool Truncated { get; set; }
    public int MaxRows { get; set; }
}

public record MachineShopPdiReportRow(DateTime Timestamp, string Barcode, string Status, string Remarks, string OperatorId);

// Name = grid column title, Title = pie label.
public record MachineShopPdiSummaryPart(string Id, string Name, string Title, string Station);

public class MachineShopPdiShiftCounts
{
    public string Shift { get; set; } = "";
    // "[12:15am - 07:14am]", as the ThingWorx grid labels the shift.
    public string Range { get; set; } = "";
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    // The shift running now (its rows are highlighted).
    public bool Current { get; set; }
    public MachineShopPdiCounts Counts { get; set; } = new();
}

// One value per column (same order as Columns) + the row total; with sides also one total per side.
public class MachineShopPdiCounts
{
    public List<int> Produced { get; set; } = new();
    public List<int> Ok { get; set; } = new();
    public List<int> Nok { get; set; } = new();
    public int ProducedTotal { get; set; }
    public int OkTotal { get; set; }
    public int NokTotal { get; set; }
    public List<int> ProducedBySide { get; set; } = new();
    public List<int> OkBySide { get; set; } = new();
    public List<int> NokBySide { get; set; } = new();
}
