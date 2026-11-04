namespace ControlTower.Services;

// Machine Shop screens (sidebar Machine Shop > PDI Dashboard ...). Read-only.
// PDI Dashboard: MachineShopPdiService (+ MachineShopController, api/machineshop/pdi/...).
// History Card: MachineShopHistoryCardService (api/machineshop/historycard/..., layouts in ControlTowerVLM RE_MSConfiguration / SPCMSconfiguration).
// Leak Test: LeakTestService (+ LeakTestController, api/machineshop/leaktest/...), port of the ThingWorx Thing
// RE_MS_LeakTest_TH, read-only counts from [MachineShop:Database].[dbo].[MachineShopData].
// Config: "MachineShop" section (Database, Table, Pdi, HistoryCard, LeakTest) + ShiftConfiguration + SharedDataConnection.
// Records the module writes, if any, go to ControlTowerVLM with an MS_ table prefix.
public static class MachineShopModule
{
    public static IServiceCollection AddMachineShopModule(this IServiceCollection services)
    {
        services.AddSingleton<MachineShopPdiService>();
        services.AddSingleton<MachineShopHistoryCardService>();
        services.AddMemoryCache(); // LeakTestService result cache (idempotent if another module added it)
        services.AddSingleton<LeakTestService>();
        return services;
    }
}
