using System;

namespace ControlTower.Models
{
    public class CylinderHeadLeakReport
    {
        public string? Location { get; set; }
        public string? AssemblyLine { get; set; }
        public DateTime? Date { get; set; }
        public string? Shift { get; set; }
        public string? StationNumber { get; set; }
        public string? Cell { get; set; }
        public int OkQty { get; set; }
        public int NotOkQty { get; set; }
        public int ActualQty { get; set; }
    }
}
