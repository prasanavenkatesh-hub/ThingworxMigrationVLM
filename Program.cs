using ControlTower.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddScoped<IReportsService, ReportsService>();

builder.Services.AddSingleton<FireHydrantStateStore>();
builder.Services.AddSingleton<FireHydrantAlertRepository>();
builder.Services.AddSingleton<FireHydrantAlertMonitor>();
builder.Services.AddSingleton<FireHydrantPumpCountRepository>();
builder.Services.AddSingleton<FireHydrantPumpCountLogger>();
builder.Services.AddSingleton<FireHydrantPumpDurationRepository>();
builder.Services.AddSingleton<FireHydrantPumpDurationLogger>();
builder.Services.AddHostedService<FireHydrantMqttBackgroundService>();

// LPG Gas Leak Yard - ported from the standalone GasSentry project. Registered as both a
// singleton (GasLeakController injects it directly to publish valve commands) and a hosted
// service (so its background MQTT loop runs), same dual-registration pattern the original
// project used for its MqttClientService.
builder.Services.AddSingleton<GasLeakStateStore>();
builder.Services.AddSingleton<GasLeakAlertRepository>();
builder.Services.AddSingleton<GasLeakAlertMonitor>();
builder.Services.AddSingleton<GasLeakMqttBackgroundService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<GasLeakMqttBackgroundService>());

// Enable CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll",
        builder =>
        {
            builder.AllowAnyOrigin()
                   .AllowAnyMethod()
                   .AllowAnyHeader();
        });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");

app.UseDefaultFiles(); // Serve index.html by default
app.UseStaticFiles();  // Serve files from wwwroot

app.UseAuthorization();

app.MapControllers();

app.Run();
