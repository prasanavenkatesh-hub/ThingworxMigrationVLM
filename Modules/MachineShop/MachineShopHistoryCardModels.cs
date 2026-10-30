namespace ControlTower.Models;

// Machine Shop > History Card. Main screen (ThingWorx QF_MachineShopBarcode_MU): cards, cells, barcode list.
public record MachineShopHistoryCardOption(string Name, string PdiStation, bool Spc);

public class MachineShopHistoryCardOptions
{
    public List<MachineShopHistoryCardOption> Cards { get; set; } = new();
    public List<string> Cells { get; set; } = new();
    public int MaxRows { get; set; }
}

public record MachineShopHistoryCardBarcode(DateTime DateTime, string Barcode, string Barcode2, string Cell);

public class MachineShopHistoryCardBarcodes
{
    public string Card { get; set; } = "";
    public string PdiStation { get; set; } = "";
    // Barcode search (station only) or the cell + time range list.
    public bool Search { get; set; }
    public List<MachineShopHistoryCardBarcode> Rows { get; set; } = new();
    public bool Truncated { get; set; }
    public int MaxRows { get; set; }
}

// History card (ThingWorx QF_MachineShop_HistoryCardMU): Table 1 = station lines, Table 2 = SPC lines.
public class MachineShopHistoryCardData
{
    public string Card { get; set; } = "";
    public string Barcode { get; set; } = "";
    public string Cell { get; set; } = "";
    public string PdiStation { get; set; } = "";
    public DateTime? DateTime { get; set; }
    public string Shift { get; set; } = "";
    public string PdiStatus { get; set; } = "";
    public List<MachineShopHistoryCardLine> Lines { get; set; } = new();
    public List<MachineShopHistoryCardSpcLine>? Spc { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// Heading = a station heading row (ThingWorx ColumnType 3), otherwise a data row (ColumnType 4).
public record MachineShopHistoryCardLine(bool Heading, string SerialNo, string Description, string Specification, string Value, string Remarks);

public record MachineShopHistoryCardSpcLine(bool Heading, string SerialNo, string Description, string Specification,
    string Gauge, string Method, string Current, string Previous, string Next);
