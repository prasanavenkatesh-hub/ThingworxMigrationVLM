namespace ControlTower.Services;

// All report screens under the sidebar's "Reports" menu.
//   LineReports        - Biometric Shiftwise / Engine No & Barcode, Main Line Cycle Time, Poke Yoke
//                        (shared ReportsService; Main/PokeYoke connection strings + ShiftConfiguration)
//   QHold, CylinderHeadLeak, CategorywiseRework, SummaryReport
//                      - ported from Power BI; each a thin wrapper over its own stored procedure
//                        (connection strings: QHold, CylinderHeadLeak, Rework{Line}, Summary{Line})
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
        return services;
    }
}
