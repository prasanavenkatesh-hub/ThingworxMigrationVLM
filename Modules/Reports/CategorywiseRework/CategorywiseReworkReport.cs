using System;

namespace ControlTower.Models
{
    public class CategorywiseReworkReport
    {
        public string? Station { get; set; }
        public DateTime? DateTime { get; set; }
        public DateTime? ProductionDate { get; set; }
        public string? Shift { get; set; }
        public string? EngineNumber { get; set; }
        public string? RejectedStation { get; set; }
        public string? Correction { get; set; }
        public string? ModelCode { get; set; }
        public string? ModelCodeDescription { get; set; }
        public string? StationStatus { get; set; }
        public string? Description { get; set; }
        public string? Category { get; set; }
    }
}
