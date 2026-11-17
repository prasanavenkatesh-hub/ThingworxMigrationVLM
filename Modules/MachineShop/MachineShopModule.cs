namespace ControlTower.Services;

// Machine Shop screens (sidebar Machine Shop > PDI Dashboard ...). Read-only apart from Part Parameter Config.
// PDI Dashboard: MachineShopPdiService (+ MachineShopController, api/machineshop/pdi/...).
// History Card: MachineShopHistoryCardService (api/machineshop/historycard/..., layouts in ControlTowerVLM RE_MSConfiguration / SPCMSconfiguration).
// Config: "MachineShop" section (Database, Table, Pdi) + ShiftConfiguration + SharedDataConnection.
// Part Parameter Config: MachineShopPartParamService (api/machineshop/partparam/..., list / Create / Edit / Delete of the
// plant CriticalPartParameter tables - the only writes outside ControlTowerVLM; its two settings in ControlTowerVLM
// MS_PartParamSettings / MS_SPCSampleSize). The module's own records go to ControlTowerVLM with an MS_ table prefix.
// Online Control Charts: MachineShopControlChartsService (CELL + OPERATION views) and MachineShopControlChartsSpcService
// (SPC LIVE + SPC MONTHLY), api/machineshop/controlcharts/..., read-only.
// Gauge Inspection Data: MachineShopGaugeInspectionService, api/machineshop/gaugeinspection/..., read-only.
// Gauge Inspection Report: MachineShopGaugeReportService (+ MachineShopGaugeReportController, api/machineshop/gaugereport/...),
// port of ThingWorx RE_Gauging_Report_MU / RE_GaugingReport_DB_TH, read-only; layout = ControlTowerVLM MS_GaugeReportTemplate.
// Leak Test: LeakTestService (+ LeakTestController, api/machineshop/leaktest/...), port of the ThingWorx Thing
// RE_MS_LeakTest_TH, read-only counts from [MachineShop:Database].[dbo].[MachineShopData] (merged from Prasanna's copy
// 2026-11-16; its IMemoryCache is registered by ReportsModule).
public static class MachineShopModule
{
    public static IServiceCollection AddMachineShopModule(this IServiceCollection services)
    {
        services.AddSingleton<MachineShopPdiService>();
        services.AddSingleton<MachineShopHistoryCardService>();
        services.AddSingleton<MachineShopPartParamService>();
        services.AddSingleton<MachineShopControlChartsService>();
        services.AddSingleton<MachineShopControlChartsSpcService>();
        services.AddSingleton<MachineShopGaugeInspectionService>();
        services.AddSingleton<LeakTestService>();
        services.AddSingleton<MachineShopGaugeReportService>();
        return services;
    }
}
