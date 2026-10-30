namespace ControlTower.Models;

// "MachineShop" section of appsettings.json. The source table is read through SharedDataConnection
// as [Database].[dbo].[Table].
public class MachineShopSettings
{
    public string Database { get; set; } = "RE_VL_MachineShop";
    public string Table { get; set; } = "MachineShopData";
    public int QueryTimeoutSeconds { get; set; } = 60;
    public MachineShopPdiSettings Pdi { get; set; } = new();
    public MachineShopHistoryCardSettings HistoryCard { get; set; } = new();
}

// Machine Shop > PDI Dashboard (port of the ThingWorx MS_PDI_HourlyData_TH / MS_PDI_SummaryPage_TH services).
public class MachineShopPdiSettings
{
    // Hour columns of the hourly grid (ThingWorx Hour_1..Hour_8); the last one runs to the end of the shift.
    public int HourColumns { get; set; } = 8;
    public string OkStatus { get; set; } = "OK";
    public string NokStatus { get; set; } = "NOK";
    // Columns holding the rejection reason of an NOK row (ThingWorx <Part>_NOK_Reason_Details).
    public List<string> RejectionReasonColumns { get; set; } = new();
    // A row only counts as a rejection when this column is not NULL (ThingWorx counted Barcode_1).
    public string RejectionCountColumn { get; set; } = "Barcode_1";
    // Column holding the machining cell of a row (part tabs: one column per cell).
    public string CellColumn { get; set; } = "Cell_Number";
    public List<MachineShopPdiPart> Parts { get; set; } = new();
    public MachineShopPdiSummarySettings Summary { get; set; } = new();
    public MachineShopPdiReportSettings Report { get; set; } = new();
}

// PDI Report pop-up (ThingWorx RE_MS_PDI_Report_MU -> MS_PDI_CoverLH_TH.generateReport / getReportData): the rows of
// one cell of a part's station over a range of calendar days, filtered by shift and status.
public class MachineShopPdiReportSettings
{
    // Part ids with a Report button (ThingWorx: Cover LH only).
    public List<string> Parts { get; set; } = new();
    // Rows returned at most (ThingWorx getReportData maxItems 5000); the page says when the list was cut.
    public int MaxRows { get; set; } = 5000;
    // Longest date range in days (not in ThingWorx; keeps one request from scanning months of rows).
    public int MaxDays { get; set; } = 31;
    public string BarcodeColumn { get; set; } = "Barcode_1";
    // Remarks of an NOK row = these columns joined with ": " (ThingWorx Checkpoints_4 + ': ' + Checkpoints_5).
    public List<string> RemarkColumns { get; set; } = new();
    public string OperatorColumn { get; set; } = "Oper_ID";
}

// PDI Summary tab (ThingWorx MS_PDI_Summary_MU / MS_PDI_SummaryPage_TH): one column + one pie per part, in
// this order (Parts ids); each part is counted on its Station, as the Hourly Screen.
public class MachineShopPdiSummarySettings
{
    public string Title { get; set; } = "MS PDI SUMMARY";
    public List<string> Parts { get; set; } = new();
}

public class MachineShopPdiPart
{
    public string Id { get; set; } = "";
    // Name in the hourly grid (ThingWorx get_HourlyData), e.g. "Cyl Head".
    public string HourlyName { get; set; } = "";
    // Name in the summary grid and on the rejection buttons (MS_PDI_Overall_Data), e.g. "Cylinder Head".
    public string Name { get; set; } = "";
    // Column title on the PDI Summary tab (MS_PDI_Summary_MU), e.g. "Cyl Head & Cam Ladder". Empty = Name.
    public string SummaryName { get; set; } = "";
    // MachineShopData.Station_Number of the part's PDI station.
    public string Station { get; set; } = "";
    // Part tab (e.g. Crankcase): heading and the cells shown as columns (CellColumn values). A part without
    // Cells has no part tab yet.
    public string Title { get; set; } = "";
    public List<string> Cells { get; set; } = new();
    // Station_Number read by the part tab when it differs from Station (Crankshaft: the tab reads 42, the
    // hourly grid 38 - as the ThingWorx MS_PDI_Crankshaft_TH / MS_PDI_HourlyData_TH queries). Empty = Station.
    public string TabStation { get; set; } = "";
    // Part tab with each cell split into sides (Crankshaft LH / RH): a row belongs to a side when that side's
    // column is not empty (ThingWorx Cell_Crankshaft_Count: Barcode_1 = LH, Barcode_2 = RH). Empty = no split.
    public List<MachineShopPdiSide> Sides { get; set; } = new();
}

public class MachineShopPdiSide
{
    public string Name { get; set; } = "";
    public string Column { get; set; } = "";
}

// Machine Shop > History Card (port of the ThingWorx QF_MachineShopBarcode_MU / QF_MachineShop_HistoryCardMU
// mashups and RE_GeneologyDB_Thing). The card layouts (ThingWorx data tables RE_MSConfigurationDT /
// SPCMSconfiguration_DT) are the tables LineTable / SpcTable in LayoutDatabase; this section holds the per-card
// rules that ThingWorx hard-coded.
public class MachineShopHistoryCardSettings
{
    // Card layout tables on the SharedDataConnection server (Modules/MachineShop/Sql/HistoryCard_*.sql).
    public string LayoutDatabase { get; set; } = "ControlTowerVLM";
    public string LineTable { get; set; } = "RE_MSConfiguration";
    public string SpcTable { get; set; } = "SPCMSconfiguration";
    // Minutes the layouts are cached; edits to the tables show up after this.
    public int LayoutCacheMinutes { get; set; } = 5;
    // Barcode list cap (ThingWorx SQL_getBarcode maxItems).
    public int MaxRows { get; set; } = 500;
    public List<string> Cells { get; set; } = new();
    // Shown for a previous / next SPC barcode that was not found (ThingWorx PocSpcHCD).
    public string NotFoundText { get; set; } = "BARCODE NOT FOUND";
    // Cards in dropdown order; Name = the layout's card name (ThingWorx CardDisplayName).
    public List<MachineShopHistoryCard> Cards { get; set; } = new();
}

public class MachineShopHistoryCard
{
    public string Name { get; set; } = "";
    // Columns a station row is matched on (barcode equals any of them).
    public List<string> MatchColumns { get; set; } = new() { "Barcode_1" };
    // Crank Case: the RH barcode = the LH barcode with the character at Position (1-based) replaced by Char,
    // matched on Column (ThingWorx: barcode.replace(barcode.slice(2, 3), "D") on Barcode_2).
    public MachineShopHistoryCardDerived? DerivedBarcode { get; set; }
    // Crank Case: extra barcodes (Barcode_3 / Barcode_4) read from the Station row of the barcode.
    public MachineShopHistoryCardRelated? Related { get; set; }
    // Rows hidden when a status column of their station is OK (ThingWorx removed them by row offset).
    public List<MachineShopHistoryCardHide> HideWhenOk { get; set; } = new();
    // Cover LH / RH: the SPC table (ThingWorx getHistoryCardDataTable2).
    public MachineShopHistoryCardSpc? Spc { get; set; }
}

public class MachineShopHistoryCardDerived
{
    public string Column { get; set; } = "Barcode_2";
    public int Position { get; set; } = 3;
    public string Char { get; set; } = "D";
}

public class MachineShopHistoryCardRelated
{
    public string Station { get; set; } = "";
    public string HistoryCardNumber { get; set; } = "";
    public List<string> Columns { get; set; } = new();
}

public class MachineShopHistoryCardHide
{
    public int Station { get; set; }
    public string StatusColumn { get; set; } = "";
    public List<string> Columns { get; set; } = new();
}

public class MachineShopHistoryCardSpc
{
    // SPC database on the SharedDataConnection server (tables Job, JobReading).
    public string Database { get; set; } = "";
    // Job.ProcessCode values per SPC station heading, used to find the previous / next barcode. The first
    // entry whose Station matches (and whose BarcodePrefix, if any, starts the barcode) is used.
    public List<MachineShopHistoryCardSpcOperation> Operations { get; set; } = new();
    // JobReading.PartParaCode values whose reading time is shown as the operator time (SQL_GetDateJobReading).
    public List<string> TimeParaCodes { get; set; } = new();
    // Checking methods whose reading is shown as a number; any other method shows OK / NOK.
    public List<string> ValueMethods { get; set; } = new() { "Air gauge", "Flatness Instrument" };
}

public class MachineShopHistoryCardSpcOperation
{
    public string Station { get; set; } = "";
    public string BarcodePrefix { get; set; } = "";
    public List<string> ProcessCodes { get; set; } = new();
}
