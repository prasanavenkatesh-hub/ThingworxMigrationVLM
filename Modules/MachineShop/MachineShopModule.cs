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
        return services;
    }
}
