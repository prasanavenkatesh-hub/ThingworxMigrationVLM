namespace ControlTower.Services;

// All report screens under the sidebar's "Reports" menu.
//   LineReports        - Biometric Shiftwise / Engine No & Barcode, Main Line Cycle Time, Poke Yoke
//                        (shared ReportsService; Main/PokeYoke connection strings + ShiftConfiguration)
//   QHold, CylinderHeadLeak, CategorywiseRework, SummaryReport
//                      - ported from Power BI; each a thin wrapper over its own stored procedure
//                        (connection strings: QHold, CylinderHeadLeak, Rework{Line}, Summary{Line})
//   RejectionSummary   - Main Line + Sub Assembly rejections (Power BI port); dbo.usp_GetRejectionSummaryReport
//                        per line (connection strings RejectionSummary{Line}; EA01 not configured yet)
//   EbRtmReports       - EB-RTM Reports (port of ThingWorx RE_EMSRTMReports_MU); reads the EB-RTM
//                        logging tables (SharedDataConnection + EbRtm:Database, meters from EbRtm:Meters)
public static class ReportsModule
{
    public static IServiceCollection AddReportsModule(this IServiceCollection services)
    {
        services.AddMemoryCache(); // SummaryReportService's 60s result cache

        services.AddScoped<IReportsService, ReportsService>();
        services.AddScoped<QHoldReportService>();
        services.AddScoped<CylinderHeadLeakReportService>();
        services.AddScoped<CategorywiseReworkReportService>();
        services.AddScoped<SummaryReportService>();
        services.AddScoped<RejectionSummaryReportService>();
        services.AddScoped<EbRtmReportService>();
        return services;
    }
}
