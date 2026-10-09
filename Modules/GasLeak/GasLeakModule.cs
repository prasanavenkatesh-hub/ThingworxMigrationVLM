namespace ControlTower.Services;

// LPG Gas Leak Yard - ported from the standalone GasSentry project.
// Config: "GasLeak" section (Database, Mqtt topics) + shared "Mqtt" broker.
public static class GasLeakModule
{
    public static IServiceCollection AddGasLeakModule(this IServiceCollection services)
    {
        services.AddSingleton<GasLeakStateStore>();
        services.AddSingleton<GasLeakAlertRepository>();
        services.AddSingleton<GasLeakAlertMonitor>();
        // Registered as both a singleton (GasLeakController injects it directly to publish valve
        // commands) and a hosted service (so its background MQTT loop runs) - same dual-registration
        // pattern the original project used for its MqttClientService.
        services.AddSingleton<GasLeakMqttBackgroundService>();
        services.AddHostedService(sp => sp.GetRequiredService<GasLeakMqttBackgroundService>());
        return services;
    }
}
