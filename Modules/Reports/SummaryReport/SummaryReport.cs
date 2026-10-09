using System;
using System.Collections.Generic;

namespace ControlTower.Models
{
    // One grouped row from dbo.usp_GetSummaryReport (Power BI business rules). Every quantity is
    // COUNT(DISTINCT engine) within its group, so the page sums groups like the DAX measures did.
    // Columns a result set doesn't return stay null (e.g. Machine for PDI, HourBucket for Daily).
    public class SummaryReportRow
    {
        public DateTime? ProductionDate { get; set; }
        public string? Shift { get; set; }
        public string? HourBucket { get; set; }
        public string? ModelShortCode { get; set; }
        public string? ModelCode { get; set; }
        public string? Machine { get; set; }
        public int? OkQty { get; set; }
        public int? NokQty { get; set; }
        public int? BypassedQty { get; set; }
        public int? NaQty { get; set; }
        public int? EmptyQty { get; set; }
        public int? ActualQty { get; set; }
        public int? ReworkQty { get; set; }
    }

    public class SummaryReportData
    {
        public string Line { get; set; } = "";
        public string Stage { get; set; } = "";
        public DateTime GeneratedAt { get; set; }
        // Leak: Count table. PDI / Testing: all attempts.
        public List<SummaryReportRow> Daily { get; set; } = new();
        // Leak only: OK / NOK / Bypassed / NA / Empty (Power BI Status table).
        public List<SummaryReportRow> Status { get; set; } = new();
        public List<SummaryReportRow> Hourly { get; set; } = new();
        // PDI / Testing only: one row per engine per production day, OK wins.
        public List<SummaryReportRow> Latest { get; set; } = new();
        // EA01 PDI / Testing only: distinct engines per month (Power BI "Monthly" tables).
        public List<SummaryReportRow> Range { get; set; } = new();
        // Leak only: ML-47 rework (Torque_Status = 'OK' at ML-Rework).
        public List<SummaryReportRow> Rework { get; set; } = new();
    }
}
