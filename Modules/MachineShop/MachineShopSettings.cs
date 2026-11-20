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
    public MachineShopPartParamSettings PartParamConfig { get; set; } = new();
    public MachineShopControlChartsSettings ControlCharts { get; set; } = new();
    public MachineShopGaugeInspectionSettings GaugeInspection { get; set; } = new();
}

// Machine Shop > Gauge Inspection Data (port of the ThingWorx QF_OnlineInspection_MU and its Thing
// "QF_Online _Inspection _DB_TH"): parts checked per shift and process code against a fixed plan.
public class MachineShopGaugeInspectionSettings
{
    // Tabs in this order (ThingWorx RE_Machine_name_DT). Source: "JobReading" = [Database].[dbo].[JobReading] + [Job]
    // (ThingWorx getReportDataView{OPE,INSP}CoverLH), "CheckSheet" = the views OperatorCheckSheet / InspectorCheckSheet
    // in Database (ThingWorx getReportDataView{OPE,INSP}, Crank Case LH); empty = no data (as ThingWorx).
    public List<MachineShopGidMachine> Machines { get; set; } = new();
    public string OperatorCheckSheet { get; set; } = "OPERATOR_CheckSheet";
    public string InspectorCheckSheet { get; set; } = "INSPECTOR_CheckSheet";
    // Process codes LIKE this pattern are inspector operations (ThingWorx startsWith('QF')): Inspector columns,
    // counted by distinct BatchNo; all other codes are operator operations counted by distinct QRCode.
    public string InspectorProcessPattern { get; set; } = "QF%";
    // Machines whose JobReading / Job carry the cell in LineName (JobReading sources only).
    public List<string> CellMachines { get; set; } = new();
    public int CellCount { get; set; } = 6;
    public string CellLinePattern { get; set; } = "%Cell-{0}";
    // Parts to check per shift (ThingWorx getOnlineInspData OP/INShift{A,B,C}ShOutOf: 7 / 8 / 8 and 2 / 2 / 2).
    public Dictionary<string, int> OperatorPlan { get; set; } = new();
    public Dictionary<string, int> InspectorPlan { get; set; } = new();
    // Process Code dropdown = codes read in the last ProcessCodeDays days (fallback: every Job.ProcessCode), without
    // ExcludeProcessCodes; cached ProcessCodeCacheMinutes. ThingWorx used fixed 2022 / 2024 windows.
    public int ProcessCodeDays { get; set; } = 30;
    public int ProcessCodeCacheMinutes { get; set; } = 10;
    public List<string> ExcludeProcessCodes { get; set; } = new();
    // CUSTOM: longest range in days and the default From = today - CustomDefaultDaysBack.
    public int MaxRangeDays { get; set; } = 31;
    public int CustomDefaultDaysBack { get; set; } = 1;
}

public class MachineShopGidMachine
{
    public string Name { get; set; } = "";
    public string Database { get; set; } = "";
    public string Source { get; set; } = "";
}

// Machine Shop > Online Control Charts (port of the ThingWorx RE_Crank_case_Dashboard_MU "CELL LEVEL DASHBOARD" and
// RE_Crank_case_TH / RE_CrankCase_Helper_DB_TH). Each machine with a Database reads [Database].[dbo].[JobReading],
// [Job], [PartParameter], [JobParameter] and [CriticalPartParameter] there.
public class MachineShopControlChartsSettings
{
    // Tabs in this order (ThingWorx RE_Machine_name_DT as shown on the CELL screen); Database empty = no data
    // (ThingWorx only computed Crank Case LH and Cover LH).
    public List<MachineShopPartParamMachine> Machines { get; set; } = new();
    // The Inspector component list only keeps readings whose OPERATOR is a UserCode of this table
    // (ThingWorx joined [VVL-ProQMS-J1-CrankCase RH].[dbo].[Users] for every machine).
    public string UsersDatabase { get; set; } = "VVL-ProQMS-J1-CrankCase RH";
    public string UsersTable { get; set; } = "Users";
    // Inspector readings = Job.MachineNo LIKE this pattern (ThingWorx '%QF%': the final-inspection machines).
    public string InspectorMachinePattern { get; set; } = "%QF%";
    // Default date of the CUSTOM picker = today - this many days (ThingWorx: -2).
    public int CustomDefaultDaysBack { get; set; } = 2;
    // Machines whose JobReading / Job / JobParameter carry the machining cell in LineName (ThingWorx: Cover LH only).
    // OPERATION and SPC MONTHLY need it; other machines show "no cell data" there.
    public List<string> CellMachines { get; set; } = new();
    // LineName LIKE this pattern ({0} = cell number) selects a cell (ThingWorx '%1' / '%Cell-1').
    public string CellLinePattern { get; set; } = "%Cell-{0}";
    public MachineShopOccOperationSettings Operation { get; set; } = new();
    public MachineShopOccSpcSettings Spc { get; set; } = new();
}

// OPERATION view (ThingWorx RE_CellLevel_Dashboard_MU / RE_cell_Loader_MU, RE_Crank_case_TH.getCellCoverLHPercentageByDate).
public class MachineShopOccOperationSettings
{
    // CELL 1 .. CELL n columns.
    public int CellCount { get; set; } = 4;
    // Job.ProcessCode LIKE these patterns = Operator / Inspector readings (ThingWorx 'OPN%' / 'QF%').
    public string OperatorProcessPattern { get; set; } = "OPN%";
    public string InspectorProcessPattern { get; set; } = "QF%";
    // Process-code chips per card (ThingWorx OPN1..OPN8).
    public int MaxProcessCodes { get; set; } = 8;
}

// SPC LIVE / SPC MONTHLY views (ThingWorx QualityFunction_MU / QualityFunctionMonthly_MU, RE_CrankCase_Helper_DB_TH,
// RE_MS_SPCMonthlyHelper_TH). Read-only: the SPC MONTHLY sub-groups are picked from the readings on every request
// instead of being logged to a stream (ThingWorx RE_MS_RandomXValues_Stream).
public class MachineShopOccSpcSettings
{
    // Cell dropdown CELL1 .. CELLn (ThingWorx RE_GaugingReport_DB_TH.cell: CELL1 .. CELL6).
    public int CellCount { get; set; } = 6;
    // Process-code dropdown per role (ThingWorx LIKE 'OPN*' / 'QF_*'; '[_]' = a literal underscore in SQL LIKE).
    public string OperatorProcessPattern { get; set; } = "OPN%";
    public string InspectorProcessPattern { get; set; } = "QF[_]%";
    // SPC MONTHLY: readings per shift sub-group (ThingWorx store7RandomValuesCoverLH: 7; fewer readings = no sub-group).
    public int SubgroupSize { get; set; } = 7;
    // SPC MONTHLY / Report: longest range in days (ThingWorx QualityDateRangeLimit: 31).
    public int MaxRangeDays { get; set; } = 31;
    // SPC MONTHLY default From = today - this many days (ThingWorx getMonthBefore: 30).
    public int MonthlyDefaultDays { get; set; } = 30;
    // Nelson rules (Remarks) look at the sub-groups before each one; the readings of this many days before From are
    // read for that (ThingWorx used up to 14 earlier stream entries).
    public int RuleLookbackDays { get; set; } = 14;
    // SPC LIVE sample size when the Part Parameter Config Sample Size is not set (ThingWorx SampleSizefromConfiguration).
    public int DefaultSampleSize { get; set; } = 7;
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

// Machine Shop > Part Parameter Config (port of the ThingWorx RE_PartParameter_Configuration_MU mashup and its
// Things RE_CrankCase_Helper_DB_TH / RE_Crank_case_TH). Each machine's critical part parameters
// ([Machine.Database].[dbo].[Table]: list, Create / Edit / Delete) + the two page settings (SettingsTable) and the
// Sample Size list (SampleSizeTable) in SettingsDatabase (Modules/MachineShop/Sql/PartParamConfig_Tables.sql).
public class MachineShopPartParamSettings
{
    public string Table { get; set; } = "CriticalPartParameter";
    public string SettingsDatabase { get; set; } = "ControlTowerVLM";
    public string SettingsTable { get; set; } = "MS_PartParamSettings";
    public string SampleSizeTable { get; set; } = "MS_SPCSampleSize";
    // Report Configuration: Gauging Report layout + Show flag per machine (copy of the ThingWorx data tables
    // RE_GaugeReport_TemplateDT / RE_GaugeReportTemplate_CoverLH_DT), in SettingsDatabase
    // (Modules/MachineShop/Sql/PartParamConfig_ReportTemplate.sql).
    public string ReportTemplateTable { get; set; } = "MS_GaugeReportTemplate";
    // Tabs in this order (ThingWorx data table RE_Machine_name_DT); Database empty = no parameter table.
    public List<MachineShopPartParamMachine> Machines { get; set; } = new();
    // Flags a new parameter gets (the Create pop-up only asks for code, description, critical, date). ThingWorx
    // set Operator = Inspector = 1 for Cover LH only and left them NULL elsewhere. PROVISIONAL: confirm.
    public MachineShopPartParamCreateDefaults CreateDefaults { get; set; } = new();
}

public class MachineShopPartParamCreateDefaults
{
    public bool Operator { get; set; } = true;
    public bool Inspector { get; set; } = true;
    public bool Spc { get; set; }
    public bool ProductParameter { get; set; }
}

public class MachineShopPartParamMachine
{
    public string Name { get; set; } = "";
    public string Database { get; set; } = "";
}
