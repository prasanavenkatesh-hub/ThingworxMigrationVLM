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
