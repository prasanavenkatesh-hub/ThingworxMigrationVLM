namespace ControlTower.Services;

// PokaYoke "Poka Yoke Station Status" screens (port of the ThingWorx VallamPokaYoke project).
// Read-only: live checkpoint status from the station tables listed in the tag master.
// Config: "PokaYoke" section (RefreshSeconds, QueryTimeoutSeconds, Lines) + SharedDataConnection.
public static class PokaYokeModule
{
    public static IServiceCollection AddPokaYokeModule(this IServiceCollection services)
    {
        services.AddSingleton<PokaYokeStatusService>();
        return services;
    }
}
