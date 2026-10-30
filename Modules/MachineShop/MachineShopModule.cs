namespace ControlTower.Services;

// Machine Shop screens. Leak Test: port of the ThingWorx Thing RE_MS_LeakTest_TH, read-only counts
// from [MachineShop:Database].[dbo].[MachineShopData] (SharedDataConnection).
// Config: "MachineShop" section (Database, LeakTest:Components / LeakBuckets / MaxRangeDays / QueryTimeoutSeconds).
public static class MachineShopModule
{
    public static IServiceCollection AddMachineShopModule(this IServiceCollection services)
    {
        services.AddMemoryCache(); // LeakTestService result cache (idempotent if another module added it)
        services.AddSingleton<LeakTestService>();
        return services;
    }
}
