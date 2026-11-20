namespace ControlTower.Models;

// Machine Shop > Online Control Charts (ThingWorx RE_Crank_case_Dashboard_MU + RE_Crank_case_Loader_MU).

public record MachineShopOccMachine(string Name, bool HasSource);

public class MachineShopOccOptions
{
    public List<MachineShopOccMachine> Machines { get; set; } = new();
    // Default date of the CUSTOM picker = today - this many days (ThingWorx expression "oneHourbackDate": -2 days).
    public int CustomDefaultDaysBack { get; set; }
}

// One component (Operator: QRCode, Inspector: BatchNo) on the card's line chart (ThingWorx onlineInsp_ChartData_DS).
public class MachineShopOccPoint
{
    public string Component { get; set; } = "";
    public DateTime ReadingDate { get; set; }
    // Parameters read for the component / parameters required x 100; null when nothing is required.
    public double? ReadingPercentage { get; set; }
}

// Critical or Non-Critical half of a card.
public class MachineShopOccSeries
{
    public double Percentage { get; set; }
    // Required parameters (CriticalPartParameter rows with the role flag) and parameters read in total.
    public int RequiredParameters { get; set; }
    public int ReadParameters { get; set; }
    public List<MachineShopOccPoint> Points { get; set; } = new();
}

// One card: Operator or Inspector (ThingWorx RE_LH_percentage_DS row).
public class MachineShopOccCard
{
    public string Name { get; set; } = "";
    public int Components { get; set; }
    public MachineShopOccSeries Critical { get; set; } = new();
    public MachineShopOccSeries NonCritical { get; set; } = new();
}

public class MachineShopOccCell
{
    public string Machine { get; set; } = "";
    public bool HasSource { get; set; }
    public string Range { get; set; } = "";
    // THIS SHIFT: the ShiftConfiguration shift running now.
    public string? Shift { get; set; }
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    // Part Parameter Config "Non Critical" switch (ThingWorx RE_Crank_case_TH.noncritcal): shows the NON CRITICAL tab.
    public bool NonCriticalTab { get; set; }
    public List<MachineShopOccCard> Cards { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}

// ---- OPERATION view (ThingWorx RE_CellLevel_Dashboard_MU, cards RE_cell_Loader_MU, RE_CELL_LH_percentage_DS) ----

// One process-code chip: share of the card's NOK readings (ThingWorx OPNn / OPNnValue).
public class MachineShopOccOpChip
{
    public string ProcessCode { get; set; } = "";
    public int NokReadings { get; set; }
    public int Share { get; set; }
}

// Critical or Non-Critical half of an Operation card.
public class MachineShopOccOpSeries
{
    // NOK readings x 100 / all readings of the role in the cell (ThingWorx cellPercentage).
    public double Percentage { get; set; }
    public int NokReadings { get; set; }
    public List<MachineShopOccOpChip> Chips { get; set; } = new();
}

public class MachineShopOccOpCard
{
    public string Name { get; set; } = "";
    public int Readings { get; set; }
    public MachineShopOccOpSeries Critical { get; set; } = new();
    public MachineShopOccOpSeries NonCritical { get; set; } = new();
}

public class MachineShopOccOpCell
{
    public string Name { get; set; } = "";
    public List<MachineShopOccOpCard> Cards { get; set; } = new();
}

public class MachineShopOccOperation
{
    public string Machine { get; set; } = "";
    public bool HasSource { get; set; }
    // false = the machine's tables have no cell (LineName) column: no per-cell data.
    public bool HasCells { get; set; }
    public string Range { get; set; } = "";
    public string? Shift { get; set; }
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public bool NonCriticalTab { get; set; }
    public List<MachineShopOccOpCell> Cells { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}

// ---- SPC LIVE / SPC MONTHLY (ThingWorx QualityFunction_MU / QualityFunctionMonthly_MU) ----

public record MachineShopOccSpcParameter(string Code, string Description);

public class MachineShopOccSpcOptions
{
    public string Machine { get; set; } = "";
    public bool HasSource { get; set; }
    public bool HasCells { get; set; }
    public List<string> Cells { get; set; } = new();
    public List<string> Roles { get; set; } = new();
    // CriticalPartParameter codes with SPC = 1 (ThingWorx PartParaDescriptionfromConfigurationPage).
    public List<MachineShopOccSpcParameter> Parameters { get; set; } = new();
    public int SubgroupSize { get; set; }
    public int MaxRangeDays { get; set; }
    public int MonthlyDefaultDays { get; set; }
}

// Control-chart figures (ThingWorx RE_MS_SPCStaticValues_DS / the QualityFunctionChartOriginal properties).
public class MachineShopOccSpcStats
{
    public int SampleSize { get; set; }
    public double? Lsl { get; set; }
    public double? Usl { get; set; }
    public double? XDoubleBar { get; set; }
    public double? RBar { get; set; }
    public double? StdDev { get; set; }
    public double? Lcl { get; set; }
    public double? Ucl { get; set; }
    public double? Lclr { get; set; }
    public double? Uclr { get; set; }
    public double? Lwl { get; set; }
    public double? Uwl { get; set; }
    public double? Cp { get; set; }
    public double? Cpk { get; set; }
}

public class MachineShopOccSpcLivePoint
{
    public DateTime Time { get; set; }
    public double Reading { get; set; }
    // CL (Median) = (JobParameter LCLXBar + UCLXBar) / 2 of the reading's job (ThingWorx Median).
    public double? Cl { get; set; }
}

public class MachineShopOccSpcLive
{
    public string Machine { get; set; } = "";
    public string Code { get; set; } = "";
    public string Description { get; set; } = "";
    public string ProcessCode { get; set; } = "";
    public string? Cell { get; set; }
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public MachineShopOccSpcStats Stats { get; set; } = new();
    public List<MachineShopOccSpcLivePoint> Points { get; set; } = new();
}

// One shift sub-group (ThingWorx RE_MS_RandomXValues_DS row).
public class MachineShopOccSpcSubgroup
{
    // Shift start (ThingWorx Date).
    public DateTime Date { get; set; }
    public string Shift { get; set; } = "";
    public double? Lsl { get; set; }
    public double? Usl { get; set; }
    public List<double> X { get; set; } = new();
    public double XBar { get; set; }
    public double Range { get; set; }
    public string Remarks { get; set; } = "";
    public bool Rule { get; set; }
}

public class MachineShopOccSpcMonthly
{
    public string Machine { get; set; } = "";
    public string Cell { get; set; } = "";
    public string Role { get; set; } = "";
    public string Code { get; set; } = "";
    public string Description { get; set; } = "";
    public string ProcessCode { get; set; } = "";
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public int Readings { get; set; }
    public MachineShopOccSpcStats Stats { get; set; } = new();
    public List<MachineShopOccSpcSubgroup> Subgroups { get; set; } = new();
}

// Report pop-up row (ThingWorx RE_SPCReport_DS).
public class MachineShopOccSpcReportRow
{
    public int SlNo { get; set; }
    public string Parameter { get; set; } = "";
    public string Description { get; set; } = "";
    public string OperationNo { get; set; } = "";
    public double? Lsl { get; set; }
    public double? Usl { get; set; }
    public double? Cp { get; set; }
    public double? Cpk { get; set; }
    public double? Lcl { get; set; }
    public double? Ucl { get; set; }
    public double XMax { get; set; }
    public double XMin { get; set; }
    public double? XBar { get; set; }
    public int NoOfReadings { get; set; }
}

public class MachineShopOccSpcReport
{
    public string Machine { get; set; } = "";
    public string Cell { get; set; } = "";
    public string Role { get; set; } = "";
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public List<MachineShopOccSpcReportRow> Rows { get; set; } = new();
}
