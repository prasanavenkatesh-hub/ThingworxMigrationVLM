namespace ControlTower.Services;

// Fire Hydrant Monitoring: MQTT -> state store, plus DB-backed alerts / pump count / pump duration.
// Config: "FireHydrant" section (Database, Mqtt topics) + shared "Mqtt" broker.
public static class FireHydrantModule
{
    public static IServiceCollection AddFireHydrantModule(this IServiceCollection services)
    {
        services.AddSingleton<FireHydrantStateStore>();
        services.AddSingleton<FireHydrantAlertRepository>();
        services.AddSingleton<FireHydrantAlertMonitor>();
        services.AddSingleton<FireHydrantPumpCountRepository>();
        services.AddSingleton<FireHydrantPumpCountLogger>();
        services.AddSingleton<FireHydrantPumpDurationRepository>();
        services.AddSingleton<FireHydrantPumpDurationLogger>();
        services.AddHostedService<FireHydrantMqttBackgroundService>();
        return services;
    }
}
