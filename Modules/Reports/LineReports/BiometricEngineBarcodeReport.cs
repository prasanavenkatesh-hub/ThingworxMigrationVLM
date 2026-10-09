namespace ControlTower.Models
{
    public class BiometricEngineBarcodeReport
    {
        public string? StationID { get; set; }
        public string? StationNumber { get; set; }
        public string? StationName { get; set; }
        public string? StationType { get; set; }
        public DateTime? PunchDateTime { get; set; }
        public string? Shift { get; set; }
        public string? EmployeeID { get; set; }
        public string? EngineNoOrBarcode { get; set; }
    }
}