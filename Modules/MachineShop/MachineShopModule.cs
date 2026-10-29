namespace ControlTower.Services;

// Machine Shop screens (sidebar Machine Shop > PDI Dashboard ...). Read-only.
// PDI Dashboard > Hourly Screen: MachineShopPdiService (+ MachineShopController, api/machineshop/pdi/...).
// Config: "MachineShop" section (Database, Table, Pdi) + ShiftConfiguration + SharedDataConnection.
// Records the module writes, if any, go to ControlTowerVLM with an MS_ table prefix.
public static class MachineShopModule
{
    public static IServiceCollection AddMachineShopModule(this IServiceCollection services)
    {
        services.AddSingleton<MachineShopPdiService>();
        return services;
    }
}
