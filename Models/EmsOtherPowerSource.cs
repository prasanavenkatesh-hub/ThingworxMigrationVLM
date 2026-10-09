namespace ControlTower.Models;

public class OtherPowerSourceInput
{
    public string Month { get; set; } = ""; // "yyyy-MM" from <input type="month">
    public long ThirdPartyWind { get; set; }
    public long ThirdPartySolar { get; set; }
    public long Tneb { get; set; }
    public long Dg { get; set; }
    public long Solar { get; set; }
    public long GcpSolar { get; set; }
    public long IexRenewable { get; set; }
    public long IexNonRenewable { get; set; }
}
