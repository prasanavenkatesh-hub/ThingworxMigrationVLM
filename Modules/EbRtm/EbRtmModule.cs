namespace ControlTower.Services;

// EB (Electricity Board) 33KV Real Time Monitoring - own MQTT connection/state, deliberately kept
// separate from Fire Hydrant/Gas Leak's services and DB tables.
// Config: "EbRtm" section (Database, MaxDemandLimitKva, LogIntervalMinutes, Mqtt topic) + shared
// "Mqtt" broker + "ShiftConfiguration" (energy consumption per shift).
public static class EbRtmModule
{
    public static IServiceCollection AddEbRtmModule(this IServiceCollection services)
    {
        services.AddSingleton<EbRtmStateStore>();
        services.AddSingleton<EbRtmReadingRepository>();
        services.AddSingleton<EbRtmReadingLogger>();
        services.AddSingleton<EbRtmPowerFailureRepository>();
        services.AddSingleton<EbRtmPowerFailureMonitor>();
        services.AddSingleton<EbRtmEnergyCalculator>();
        services.AddHostedService<EbRtmMqttBackgroundService>();
        return services;
    }
}
