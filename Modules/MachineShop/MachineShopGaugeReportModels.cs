namespace ControlTower.Models;

// Machine Shop > Gauge Inspection Report (ThingWorx RE_Gauging_Report_MU / RE_GaugingReport_DB_TH).

public record MachineShopGirMachineInfo(string Name, bool HasSource);

public class MachineShopGirOptions
{
    public List<MachineShopGirMachineInfo> Machines { get; set; } = new();
    public List<string> Cells { get; set; } = new();
    public int PageSize { get; set; }
}

// One parameter row of the report layout (left part of the ThingWorx screen).
public class MachineShopGirRow
{
    public int SNo { get; set; }
    public string ProcessCode { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Specification { get; set; }
    public string? GaugeNumber { get; set; }
    public bool Critical { get; set; }
    // One value per component column (same order as Components); null = not measured ("-").
    public List<MachineShopGirValue?> Values { get; set; } = new();
}

public class MachineShopGirValue
{
    public string Text { get; set; } = "";
    public bool Nok { get; set; }
}

// One part column: QR code, operator and the time of its first reading in the window.
public class MachineShopGirComponent
{
    public string QrCode { get; set; } = "";
    public string Operator { get; set; } = "";
    public string? UserName { get; set; }
    public DateTime FirstReading { get; set; }
}

public class MachineShopGirData
{
    public string Machine { get; set; } = "";
    public bool HasSource { get; set; }
    public string Cell { get; set; } = "";
    public string Role { get; set; } = "";
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public string Shift { get; set; } = "N/A";
    public List<MachineShopGirComponent> Components { get; set; } = new();
    public int ComponentsTotal { get; set; }
    public List<MachineShopGirRow> Rows { get; set; } = new();
}
