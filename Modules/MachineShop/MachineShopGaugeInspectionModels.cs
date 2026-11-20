namespace ControlTower.Models;

// Machine Shop > Gauge Inspection Data (ThingWorx QF_OnlineInspection_MU / "QF_Online _Inspection _DB_TH").

public record MachineShopGidMachineInfo(string Name, bool HasSource, bool HasCells);

public class MachineShopGidOptions
{
    public List<MachineShopGidMachineInfo> Machines { get; set; } = new();
    public List<string> Cells { get; set; } = new();
    public List<string> Shifts { get; set; } = new();
    public int MaxRangeDays { get; set; }
    public int CustomDefaultDaysBack { get; set; }
}

// One grid row (ThingWorx data shape RE_MS_GaugeInspectionData_DS). Actuals are null for a shift that has not
// started yet; the Cumulative row has no Date / Shift.
public class MachineShopGidRow
{
    public DateTime? Date { get; set; }
    public string? Shift { get; set; }
    public string Operation { get; set; } = "";
    public bool Inspector { get; set; }
    // The shift has ended (Actual is final); false for the running shift and shifts not started.
    public bool Finished { get; set; }
    public int OperatorPlan { get; set; }
    public int? OperatorActual { get; set; }
    public int InspectorPlan { get; set; }
    public int? InspectorActual { get; set; }
}

public class MachineShopGidData
{
    public string Machine { get; set; } = "";
    public bool HasSource { get; set; }
    public bool HasCells { get; set; }
    public string? Cell { get; set; }
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public List<MachineShopGidRow> Rows { get; set; } = new();
    public MachineShopGidRow? Cumulative { get; set; }
}
