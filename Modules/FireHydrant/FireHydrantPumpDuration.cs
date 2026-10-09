namespace ControlTower.Models;

// One row per individual pump run session for the Duration report's raw session list.
// EndTime/Duration are null for a session still in progress (pump still running).
public class FireHydrantPumpDurationDto
{
    public string Pump { get; set; } = "";
    public DateTime StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public TimeSpan? Duration { get; set; }
}
