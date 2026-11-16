namespace ControlTower.Models;

// Machine Shop > Part Parameter Config (ThingWorx RE_PartParameter_Configuration_MU): machine tabs + page settings.
public record MachineShopPartParamTab(string Name, bool HasSource);

public class MachineShopPartParamOptions
{
    public List<MachineShopPartParamTab> Machines { get; set; } = new();
    public MachineShopPartParamPageSettings? Settings { get; set; }
    // Why Settings is missing (e.g. the ControlTowerVLM tables are not there).
    public string SettingsError { get; set; } = "";
    public List<int> SampleSizes { get; set; } = new();
    // False in a view-only copy (App:WritesEnabled): the settings are shown but cannot be changed.
    public bool WritesEnabled { get; set; }
    // Machines with a Gauging Report layout (Report Configuration button enabled on their tab).
    public List<string> ReportMachines { get; set; } = new();
}

// Report Configuration (ThingWorx RE_Gauging_ReportConfi_MU): one layout row of the machine's Gauging Report.
public record MachineShopReportTemplateRow(int Id, int? SNo, string ProcessCode, string? PartParaDescription,
    string? Specification, string? GaugeNumber, bool? CriticalParameter, bool Show);

// Body of PUT report-config: the Show flag of each row (rows left out are not changed).
public class MachineShopReportTemplateUpdate
{
    public string Machine { get; set; } = "";
    public List<MachineShopReportTemplateShow> Rows { get; set; } = new();
}

public class MachineShopReportTemplateShow
{
    public int Id { get; set; }
    public bool Show { get; set; }
}

// NonCritical = ThingWorx RE_Crank_case_TH.noncritcal, SampleSize = RE_CrankCase_Helper_DB_TH.SampleSizefromConfiguration.
public class MachineShopPartParamPageSettings
{
    public bool NonCritical { get; set; }
    public int SampleSize { get; set; }
}

// Body of PUT settings: only the fields that are set are saved.
public class MachineShopPartParamSettingsUpdate
{
    public bool? NonCritical { get; set; }
    public int? SampleSize { get; set; }
}

public record MachineShopPartParamRow(string PartParaCode, string PartParaDescription, bool? CriticalParameter, DateTime? UpdatedDate,
    bool? Operator, bool? Spc, bool? Inspector, bool? ProductParameter);

// Create (ThingWorx partParam_create_popup_MU) / Edit (RE_partParam_Edit_popup_MU) body. Create uses Machine, PartParaCode,
// PartParaDescription, CriticalParameter, UpdatedDate; Edit also Operator, Inspector, Spc (ProductParameter is not editable,
// as in ThingWorx). UpdatedDate = yyyy-MM-dd (ThingWorx date-only picker), empty = today.
public class MachineShopPartParamInput
{
    public string Machine { get; set; } = "";
    public string PartParaCode { get; set; } = "";
    public string PartParaDescription { get; set; } = "";
    public bool CriticalParameter { get; set; }
    public bool Operator { get; set; }
    public bool Inspector { get; set; }
    public bool Spc { get; set; }
    public string? UpdatedDate { get; set; }
}

public enum MachineShopPartParamWriteStatus { Ok, ViewOnly, NoSource, Duplicate, NotFound, NoPermission }

public record MachineShopPartParamWriteResult(MachineShopPartParamWriteStatus Status, string Message);

public class MachineShopPartParamList
{
    public string Machine { get; set; } = "";
    public bool HasSource { get; set; }
    public List<MachineShopPartParamRow> Rows { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}

// SPC control-chart constants of one sample size (MS_SPCSampleSize; ThingWorx RE_SampleSizeInfo_DT).
public class MachineShopSpcConstants
{
    public int SampleSize { get; set; }
    public double A2 { get; set; }
    public double D2 { get; set; }
    public double D3 { get; set; }
    public double D4 { get; set; }
}
