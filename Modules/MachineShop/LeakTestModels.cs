namespace ControlTower.Models;

// "MachineShop:LeakTest:Components:<id>" in appsettings.json.
public class LeakTestComponentSettings
{
    public string Id { get; set; } = "";   // the config key, set by LeakTestService.FindComponent (cache key)
    public List<string> Stations { get; set; } = new();
    public int Cells { get; set; } = 2;
}

// One grid row (ThingWorx data shape RE_MS_LeakTest_DS): Shift | Description | Cell_1..n | Total.
// Percentage rows carry null where the denominator is 0 (ThingWorx showed NaN / Infinity there).
public class LeakTestGridRow
{
    public string? Shift { get; set; }
    public string Description { get; set; } = "";
    public List<double?> Cells { get; set; } = new();
    public double? Total { get; set; }
}

// OK / NOK pair of a pie (getPercentPieChart: percentages; get_OKvsNOKQty: counts).
public class LeakTestPie
{
    public double Ok { get; set; }
    public double Nok { get; set; }
}

public class LeakTestBucket
{
    public string LeakValue { get; set; } = "";
    public int Count { get; set; }
}

// RE_MS_LeakTest_SummaryTable_DS.
public class LeakTestSummaryRow
{
    public DateTime Date { get; set; }
    public int ProducedQty { get; set; }
    public int OkQty { get; set; }
    public double OkPercent { get; set; }
    public int NokQty { get; set; }
    public double NokPercent { get; set; }
}

// RE_MS_LT_PercentageTrend_DS: Date, Percentage (rounded), Qty.
public class LeakTestTrendPoint
{
    public DateTime Date { get; set; }
    public double Percentage { get; set; }
    public int Qty { get; set; }
}

public class LeakTestTrend
{
    public List<LeakTestTrendPoint> Ok { get; set; } = new();
    public List<LeakTestTrendPoint> Nok { get; set; } = new();
}

public class LeakTestData
{
    public int Cells { get; set; }
    public Dictionary<string, List<LeakTestGridRow>> Shifts { get; set; } = new();
    public List<LeakTestGridRow> Totals { get; set; } = new();
    public Dictionary<string, LeakTestPie> Pies { get; set; } = new();
    public List<LeakTestBucket> Leak { get; set; } = new();
    public List<LeakTestSummaryRow> Summary { get; set; } = new();
    public LeakTestTrend Week { get; set; } = new();
}
