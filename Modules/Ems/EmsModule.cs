namespace ControlTower.Services;

// EMS Renewable: live solar (MQTT, 2 feeder meters) with a daily 00:15 baseline + hourly chart
// point logged to the DB, and the manually entered monthly "Other Power Source" figures.
// Config: "Ems" section (Database, Mqtt.SolarTopic) + shared "Mqtt" broker.
public static class EmsModule
{
    public static IServiceCollection AddEmsModule(this IServiceCollection services)
    {
        services.AddSingleton<EmsSolarStateStore>();
        services.AddSingleton<EmsSolarDataRepository>();
        services.AddSingleton<EmsOtherPowerSourceRepository>();
        services.AddHostedService<EmsSolarMqttBackgroundService>();
        return services;
    }
}
