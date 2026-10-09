using System;

namespace ControlTower.Models
{
    public class QHoldReport
    {
        public DateTime? Date { get; set; }
        public string? EngineNumber { get; set; }
        public string? Model { get; set; }
        public string? QHoldStation { get; set; }
        public string? UserId { get; set; }
        public string? Result { get; set; }
        public string? RejectionDetails { get; set; }
        public string? RootCause { get; set; }
        public string? ReworkDetails { get; set; }
        public string? Category { get; set; }
        public string? Supplier { get; set; }
        public DateTime? ReworkDate { get; set; }
        public string? RecheckStatus { get; set; }
        public string? ReworkedBy { get; set; }
        public string? VerifiedBy { get; set; }
        public string? Barcode1 { get; set; }
        public string? Shift { get; set; }
    }
}
