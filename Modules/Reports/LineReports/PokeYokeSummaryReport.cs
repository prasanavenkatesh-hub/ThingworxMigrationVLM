namespace ControlTower.Models
{
    public class PokeYokeSummaryReport
    {
        public int NoOfEngines { get; set; }
        public string StationDescription { get; set; } = "";
        public string StationNumber { get; set; } = "";
        public string StartingEngineNumber { get; set; } = "";
        public string EndingEngineNumber { get; set; } = "";
        public DateTime StartingDatetime { get; set; }
        public DateTime EndingDatetime { get; set; }
        public int DurationSeconds { get; set; }
    }
}
