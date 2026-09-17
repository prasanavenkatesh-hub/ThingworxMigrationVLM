namespace ControlTower.Models;

// One row per pump in the Count report's per-pump summary for a date range. StartCount/
// EndCount are the pump's cumulative running-count value as of the start/end of the range
// (last-observation-carried-forward from PumpRunningCount); RunCount = EndCount - StartCount
// is how many times the pump actually ran during that window.
public class PumpCountSummaryDto
{
    public string Pump { get; set; } = "";
    public long StartCount { get; set; }
    public long EndCount { get; set; }
    public long RunCount { get; set; }
}
